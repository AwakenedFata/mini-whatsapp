'use client';
import React, { useState, useEffect, useRef } from 'react';
import { connectWebSocket, disconnectWebSocket, sendWebSocketMessage } from '../lib/websocket';
import { getIdentity, saveIdentity, getPendingMessages, updateMessageStatus, saveMessage, getAllMessages } from '../lib/local-db';
import { generateKeyPair, encryptMessage, decryptMessage } from '../lib/crypto';
import { processOutbox } from '../lib/outbox';

const USERS = ['Budi', 'Siti', 'Andi'];

export default function Home() {
    const [currentUser, setCurrentUser] = useState<string | null>(null);
    const [connectionState, setConnectionState] = useState('DISCONNECTED');
    const [messages, setMessages] = useState<any[]>([]);
    const [recipient, setRecipient] = useState<string>('Siti');
    const [input, setInput] = useState('');
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [keys, setKeys] = useState<any>(null);
    const [logs, setLogs] = useState<string[]>([]);
    const [isClientOffline, setIsClientOffline] = useState(false);

    const [serverFail, setServerFail] = useState(false);

    const logsEndRef = useRef<HTMLDivElement>(null);
    const chatEndRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const addLog = (msg: string) => {
        const time = new Date().toLocaleTimeString();
        setLogs(prev => [...prev, `${time} ${msg}`]);
    };

    useEffect(() => {
        if (logsEndRef.current) {
            logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [logs]);

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    useEffect(() => {
        if (!currentUser || isClientOffline) {
            disconnectWebSocket();
            if (isClientOffline) setConnectionState('DISCONNECTED');
            return;
        }

        const initCrypto = async () => {
            let id = await getIdentity(currentUser);
            if (!id) {
                const newKeys = await generateKeyPair();
                await saveIdentity(currentUser, newKeys);
                id = { userId: currentUser, keyPair: newKeys };
            }
            setKeys(id.keyPair);
        };

        initCrypto();
    }, [currentUser, isClientOffline]);

    useEffect(() => {
        if (keys && !isClientOffline) {
            connectWebSocket(
                process.env.NEXT_PUBLIC_WS_URL || (typeof window !== 'undefined' ? `ws://${window.location.hostname}:4000` : 'ws://localhost:4000'),
                handleWsMessage,
                (state: string) => {
                    setConnectionState(state);
                    if (state === 'CONNECTED') {
                        addLog(`[WS] Connected`);
                        // Send AUTH
                        sendWebSocketMessage('AUTH', { userId: currentUser });
                        // Register key
                        sendWebSocketMessage('REGISTER_PUBLIC_KEY', { publicKey: keys.publicKeyJwk });
                        // Sync
                        sendWebSocketMessage('SYNC_PENDING', {});
                        // Process outbox
                        processOutbox().then(() => loadMessages());
                    } else if (state === 'DISCONNECTED') {
                        addLog(`[WS] Disconnected`);
                    } else {
                        addLog(`[WS] ${state}`);
                    }
                }
            );
        }

        loadMessages();
    }, [keys, isClientOffline]);

    const loadMessages = async () => {
        const msgs = await getAllMessages();
        setMessages(msgs.sort((a: any, b: any) => a.createdAt - b.createdAt));
    };

    const handleWsMessage = async (data: any) => {
        switch (data.type) {
            case 'MESSAGE_ACK':
                addLog(`[ACK] Server ACK for ${data.payload.clientMessageId}`);
                await updateMessageStatus(data.payload.clientMessageId, 'SENT', { serverMessageId: data.payload.serverMessageId, serverReceivedAt: data.payload.serverReceivedAt });
                loadMessages();
                break;
            case 'DELIVERY_UPDATE':
                addLog(`[DELIVERY] Message ${data.payload.clientMessageId} delivered`);
                await updateMessageStatus(data.payload.clientMessageId, 'DELIVERED', { deliveredAt: data.payload.deliveredAt });
                loadMessages();
                break;
            case 'READ_UPDATE':
                addLog(`[READ] Message ${data.payload.clientMessageId} read`);
                await updateMessageStatus(data.payload.clientMessageId, 'READ', { readAt: data.payload.readAt });
                loadMessages();
                break;
            case 'DELIVER_MESSAGE':
                addLog(`[MSG] Received message from ${data.payload.senderId}`);
                if (!data.payload.senderPublicKey || !data.payload.ciphertext) {
                    addLog(`[WARN] Skipping message without public key or ciphertext`);
                    break;
                }
                try {
                    const decrypted = await decryptMessage(
                        data.payload.ciphertext,
                        data.payload.iv,
                        data.payload.senderPublicKey,
                        keys.privateKey
                    );

                    await saveMessage({
                        clientMessageId: data.payload.clientMessageId,
                        serverMessageId: data.payload.serverMessageId,
                        senderId: data.payload.senderId,
                        recipientId: currentUser,
                        text: decrypted,
                        mediaId: data.payload.mediaId || null,
                        createdAt: data.payload.createdAt,
                        status: 'RECEIVED'
                    });

                    loadMessages();

                    sendWebSocketMessage('DELIVERY_ACK', { serverMessageId: data.payload.serverMessageId });
                    addLog(`[ACK] Sent DELIVERY_ACK for ${data.payload.serverMessageId}`);
                } catch (e) {
                    console.error("Decryption failed", e);
                }
                break;
        }
    };

    const handleSend = async () => {
        const text = input.trim();
        if ((!text && !selectedFile) || !keys) return;

        const clientMessageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        setInput('');

        let uploadedMediaId: string | null = null;
        if (selectedFile) {
            setIsUploading(true);
            try {
                addLog(`[MEDIA] Uploading file ${selectedFile.name}...`);
                const formData = new FormData();
                formData.append('media', selectedFile);

                const serverUrl = process.env.NEXT_PUBLIC_MESSAGE_SERVER_URL || (typeof window !== 'undefined' ? `http://${window.location.hostname}:4000` : 'http://localhost:4000');
                const uploadRes = await fetch(`${serverUrl}/api/media/upload`, {
                    method: 'POST',
                    body: formData
                });

                if (!uploadRes.ok) {
                    addLog(`[ERROR] Failed to upload media file`);
                    setIsUploading(false);
                    return;
                }

                const uploadJson = await uploadRes.json();
                uploadedMediaId = uploadJson.mediaId;
                addLog(`[MEDIA] Uploaded with ID: ${uploadedMediaId}`);
            } catch (err) {
                console.error("Upload error", err);
                addLog(`[ERROR] Network error during media upload`);
                setIsUploading(false);
                return;
            } finally {
                setIsUploading(false);
                setSelectedFile(null);
                if (fileInputRef.current) fileInputRef.current.value = '';
            }
        }

        // Get recipient public key
        try {
            const serverUrl = process.env.NEXT_PUBLIC_MESSAGE_SERVER_URL || (typeof window !== 'undefined' ? `http://${window.location.hostname}:4000` : 'http://localhost:4000');
            const res = await fetch(`${serverUrl}/api/users/${recipient}/public-key`);
            if (!res.ok) {
                addLog(`[ERROR] Recipient public key not found. Send when they register.`);
                return;
            }
            const { publicKey } = await res.json();

            const encrypted = await encryptMessage(text, keys.privateKey, publicKey);

            const payload = {
                clientMessageId,
                recipientId: recipient,
                ciphertext: encrypted.ciphertext,
                iv: encrypted.iv,
                senderPublicKey: keys.publicKeyJwk,
                mediaId: uploadedMediaId
            };

            const localMsg = {
                senderId: currentUser,
                text,
                createdAt: Date.now(),
                status: 'LOCAL_PENDING',
                ...payload
            };

            await saveMessage(localMsg);
            loadMessages();
            addLog(`[LOCAL] Created message ${clientMessageId}`);

            if (connectionState === 'CONNECTED' && !isClientOffline) {
                sendWebSocketMessage('SEND_MESSAGE', payload);
                addLog(`[WS] Sent message ${clientMessageId}`);
            } else {
                addLog(`[WS] Offline. Message queued locally.`);
            }

        } catch (e) {
            console.error("Encryption error", e);
            addLog(`[ERROR] Failed to send message`);
        }
    };

    const handleReadMessage = async (msg: any) => {
        if (msg.status === 'RECEIVED' && !msg.readAt) {
            await updateMessageStatus(msg.clientMessageId, 'RECEIVED', { readAt: Date.now() });
            sendWebSocketMessage('READ', { serverMessageId: msg.serverMessageId });
            addLog(`[READ] Sent READ receipt for ${msg.serverMessageId}`);
            loadMessages();
        }
    };

    const toggleDbFailure = async () => {
        const newVal = !serverFail;
        setServerFail(newVal);
        await fetch(`${process.env.NEXT_PUBLIC_MESSAGE_SERVER_URL || (typeof window !== 'undefined' ? `http://${window.location.hostname}:4000` : 'http://localhost:4000')}/api/simulate-db-failure`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fail: newVal })
        });
        addLog(`[SIMULATION] Server DB Failure: ${newVal}`);
    };

    if (!currentUser) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 font-sans">
                <div className="bg-white p-8 rounded-lg shadow-md">
                    <h1 className="text-2xl font-bold mb-6 text-center text-gray-800">Mini WhatsApp</h1>
                    <h2 className="text-lg mb-4 text-gray-600">Login as:</h2>
                    <div className="flex gap-4">
                        {USERS.map(u => (
                            <button
                                key={u}
                                onClick={() => {
                                    setCurrentUser(u);
                                    const other = USERS.find(otherUser => otherUser !== u);
                                    if (other) setRecipient(other);
                                }}
                                className="px-6 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition font-medium"
                            >
                                {u}
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    const currentChatMessages = messages.filter(m =>
        (m.senderId === currentUser && m.recipientId === recipient) ||
        (m.senderId === recipient && m.recipientId === currentUser)
    );

    return (
        <div className="flex h-screen bg-gray-100 font-sans">
            {/* Chat UI */}
            <div className="flex-1 flex flex-col max-w-2xl mx-auto my-4 bg-white shadow-xl rounded-lg overflow-hidden border border-gray-200">
                <div className="bg-emerald-600 text-white p-4 flex justify-between items-center shadow-sm">
                    <div>
                        <div className="text-[11px] uppercase tracking-wider text-emerald-200 font-semibold">Chat Dengan</div>
                        <h2 className="font-bold text-xl leading-tight">{recipient}</h2>
                        <div className="text-xs opacity-85 mt-0.5">
                            {connectionState === 'CONNECTED' ? '🟢 Connected' :
                                connectionState === 'RECONNECTING' ? '🟡 Reconnecting...' : '🔴 Disconnected'}
                        </div>
                    </div>
                    <div className="text-right flex flex-col items-end">
                        <div className="text-[11px] uppercase tracking-wider text-emerald-200 font-semibold mb-1">Akun Anda</div>
                        <div className="bg-emerald-800 border border-emerald-400/30 px-3 py-1 rounded-full text-xs font-bold text-white shadow-inner">
                            {currentUser}
                        </div>
                    </div>
                </div>

                <div className="flex-1 p-4 overflow-y-auto bg-[#efeae2] relative" style={{ backgroundImage: 'url("https://web.whatsapp.com/img/bg-chat-tile-dark_a4be512e7195b6b733d9110b408f075d.png")', backgroundRepeat: 'repeat', opacity: 0.95 }}>
                    {currentChatMessages.map((msg, i) => {
                        const isMine = msg.senderId === currentUser;
                        return (
                            <div key={i} className={`mb-4 flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                                <div
                                    className={`relative px-4 py-2 max-w-xs lg:max-w-md rounded-lg shadow ${isMine ? 'bg-[#d9fdd3] rounded-tr-none' : 'bg-white rounded-tl-none'} cursor-pointer`}
                                    onClick={() => !isMine && handleReadMessage(msg)}
                                >
                                    {msg.mediaId && (
                                        <div className="mb-2 rounded overflow-hidden">
                                            <img
                                                src={`${process.env.NEXT_PUBLIC_MESSAGE_SERVER_URL || (typeof window !== 'undefined' ? `http://${window.location.hostname}:4000` : 'http://localhost:4000')}/api/media/${msg.mediaId}`}
                                                alt="Shared media"
                                                className="max-h-60 w-full object-cover rounded hover:opacity-95 transition"
                                                onLoad={() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    window.open(`${process.env.NEXT_PUBLIC_MESSAGE_SERVER_URL || (typeof window !== 'undefined' ? `http://${window.location.hostname}:4000` : 'http://localhost:4000')}/api/media/${msg.mediaId}`, '_blank');
                                                }}
                                            />
                                        </div>
                                    )}
                                    {msg.text ? <div className="text-gray-800 text-sm whitespace-pre-wrap break-words">{msg.text}</div> : null}
                                    <div className="text-[10px] text-gray-500 mt-1 flex justify-end items-center gap-1">
                                        <span>{new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                        {isMine && (
                                            <span className="ml-1 text-gray-400 text-xs">
                                                {msg.status === 'LOCAL_PENDING' && '🕒'}
                                                {msg.status === 'SENT' && '✓'}
                                                {msg.status === 'DELIVERED' && '✓✓'}
                                                {msg.status === 'READ' && <span className="text-blue-500">✓✓</span>}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                    <div ref={chatEndRef} />
                </div>

                {selectedFile && (
                    <div className="bg-gray-200 px-4 py-2 text-xs text-gray-700 flex justify-between items-center border-t border-gray-300">
                        <span className="truncate max-w-sm">File: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)</span>
                        <button
                            type="button"
                            onClick={() => {
                                setSelectedFile(null);
                                if (fileInputRef.current) fileInputRef.current.value = '';
                            }}
                            className="text-red-500 hover:text-red-700 font-bold ml-2"
                        >
                            ✕
                        </button>
                    </div>
                )}
                <div className="bg-gray-100 p-3 flex items-center gap-2">
                    <input
                        type="file"
                        ref={fileInputRef}
                        className="hidden"
                        accept="image/*"
                        onChange={e => {
                            if (e.target.files && e.target.files[0]) {
                                setSelectedFile(e.target.files[0]);
                            }
                        }}
                    />
                    <button
                        type="button"
                        title="Attach image"
                        className="text-gray-500 hover:text-gray-700 p-2 rounded-full hover:bg-gray-200 transition"
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                        </svg>
                    </button>
                    <input
                        type="text"
                        className="flex-1 rounded-full px-4 py-2 border border-gray-300 focus:outline-none focus:border-emerald-500 bg-white text-gray-800"
                        placeholder={selectedFile ? "Add a caption (optional)..." : "Type a message..."}
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && !isUploading && handleSend()}
                        disabled={isUploading}
                    />
                    <button
                        className="bg-emerald-600 text-white p-2 rounded-full w-10 h-10 flex items-center justify-center hover:bg-emerald-700 disabled:opacity-50"
                        onClick={handleSend}
                        disabled={isUploading || (!input.trim() && !selectedFile)}
                    >
                        {isUploading ? "..." : "➤"}
                    </button>
                </div>
            </div>

            {/* Developer Panel */}
            <div className="w-96 bg-gray-900 text-gray-300 flex flex-col p-4 border-l border-gray-700 h-screen overflow-hidden">
                <h3 className="text-lg font-bold text-white mb-4">Developer Panel</h3>

                <div className="mb-6 space-y-3">
                    <div>
                        <label className="text-sm text-gray-400 block mb-1">Chatting with:</label>
                        <select
                            className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white"
                            value={recipient}
                            onChange={e => setRecipient(e.target.value)}
                        >
                            {USERS.filter(u => u !== currentUser).map(u => (
                                <option key={u} value={u}>{u}</option>
                            ))}
                        </select>
                    </div>

                    <div className="bg-gray-800 p-3 rounded border border-gray-700">
                        <h4 className="text-sm font-semibold text-white mb-2">Failure Simulation</h4>
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-sm">Client Network:</span>
                            <div className="flex gap-1">
                                <button
                                    className={`px-3 py-1 rounded text-xs font-bold ${!isClientOffline ? 'bg-green-600 text-white' : 'bg-gray-700'}`}
                                    onClick={() => setIsClientOffline(false)}
                                >ONLINE</button>
                                <button
                                    className={`px-3 py-1 rounded text-xs font-bold ${isClientOffline ? 'bg-red-600 text-white' : 'bg-gray-700'}`}
                                    onClick={() => setIsClientOffline(true)}
                                >OFFLINE</button>
                            </div>
                        </div>
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-sm">Server DB Writes:</span>
                            <div className="flex gap-1">
                                <button
                                    className={`px-3 py-1 rounded text-xs font-bold ${!serverFail ? 'bg-green-600 text-white' : 'bg-gray-700'}`}
                                    onClick={() => toggleDbFailure()}
                                >NORMAL</button>
                                <button
                                    className={`px-3 py-1 rounded text-xs font-bold ${serverFail ? 'bg-red-600 text-white' : 'bg-gray-700'}`}
                                    onClick={() => toggleDbFailure()}
                                >FAIL</button>
                            </div>
                        </div>
                    </div>

                    <button
                        className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-semibold transition"
                        onClick={() => processOutbox()}
                    >
                        Force Retry Outbox
                    </button>
                </div>

                <div className="flex-1 flex flex-col bg-gray-950 rounded border border-gray-800 overflow-hidden">
                    <div className="bg-gray-800 p-2 text-xs font-bold text-gray-400 border-b border-gray-700 flex justify-between">
                        <span>Event Log</span>
                        <button onClick={() => setLogs([])} className="hover:text-white">Clear</button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 text-xs font-mono space-y-1">
                        {logs.map((log, i) => (
                            <div key={i} className={log.includes('ERROR') ? 'text-red-400' : log.includes('ACK') ? 'text-green-400' : 'text-gray-400'}>
                                {log}
                            </div>
                        ))}
                        <div ref={logsEndRef} />
                    </div>
                </div>
            </div>
        </div>
    );
}