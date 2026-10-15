const { v4: uuidv4 } = require('uuid');
const db = require('../database/db');
const { getSocket } = require('../presence/manager');
const { isDbFailureSimulated } = require('../failure-simulation/manager');

const run = (query, params) => new Promise((resolve, reject) => {
    db.run(query, params, function (err) {
        if (err) reject(err);
        else resolve(this);
    });
});

const get = (query, params) => new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
    });
});

const all = (query, params) => new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
    });
});

async function handleSendMessage(senderId, payload, senderWs) {
    if (isDbFailureSimulated()) {
        console.log(`[SIMULATION] DB write failed for message ${payload.clientMessageId}`);
        return;
    }

    try {
        const existingMessage = await get(`SELECT * FROM messages WHERE clientMessageId = ?`, [payload.clientMessageId]);
        const now = Date.now();
        let serverMessageId;

        if (existingMessage) {
            console.log(`[DUPLICATE] clientMessageId ${payload.clientMessageId} already exists`);
            serverMessageId = existingMessage.id;
        } else {
            serverMessageId = uuidv4();
            const ttlMs = parseInt(process.env.MESSAGE_TTL_MS || (30 * 24 * 60 * 60 * 1000));
            
            await run(`
                INSERT INTO messages (
                    id, clientMessageId, senderId, recipientId, ciphertext, iv, senderPublicKey, createdAt, expiresAt, mediaId
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                serverMessageId, payload.clientMessageId, senderId, payload.recipientId, 
                payload.ciphertext, payload.iv, JSON.stringify(payload.senderPublicKey), 
                now, now + ttlMs, payload.mediaId || null
            ]);
            console.log(`[DB] message persisted (clientMessageId: ${payload.clientMessageId})`);
        }

        senderWs.send(JSON.stringify({
            type: 'MESSAGE_ACK',
            payload: {
                clientMessageId: payload.clientMessageId,
                serverMessageId: serverMessageId,
                status: 'sent',
                serverReceivedAt: now
            }
        }));
        console.log(`[ACK] sent to ${senderId} for message ${payload.clientMessageId}`);

        const recipientWs = getSocket(payload.recipientId);
        if (recipientWs) {
            const msgRow = await get(`SELECT * FROM messages WHERE id = ?`, [serverMessageId]);
            recipientWs.send(JSON.stringify({
                type: 'DELIVER_MESSAGE',
                payload: {
                    serverMessageId: msgRow.id,
                    clientMessageId: msgRow.clientMessageId,
                    senderId: msgRow.senderId,
                    ciphertext: msgRow.ciphertext,
                    iv: msgRow.iv,
                    senderPublicKey: JSON.parse(msgRow.senderPublicKey),
                    createdAt: msgRow.createdAt,
                    mediaId: msgRow.mediaId
                }
            }));
            console.log(`[DELIVERY] message delivered to ${payload.recipientId}`);
        } else {
            console.log(`[QUEUE] Recipient ${payload.recipientId} offline. Message waiting in server queue.`);
        }

    } catch (err) {
        console.error('[MSG] Error in handleSendMessage', err);
    }
}

async function handleDeliveryAck(recipientId, payload) {
    if (isDbFailureSimulated()) return;
    try {
        const now = Date.now();
        await run(`UPDATE messages SET deliveredAt = ? WHERE id = ?`, [now, payload.serverMessageId]);
        console.log(`[RECEIPT] delivery ACK for message ${payload.serverMessageId}`);
        
        const msgRow = await get(`SELECT senderId, clientMessageId FROM messages WHERE id = ?`, [payload.serverMessageId]);
        if (msgRow) {
            const senderWs = getSocket(msgRow.senderId);
            if (senderWs) {
                senderWs.send(JSON.stringify({
                    type: 'DELIVERY_UPDATE',
                    payload: {
                        serverMessageId: payload.serverMessageId,
                        clientMessageId: msgRow.clientMessageId,
                        deliveredAt: now
                    }
                }));
            }
        }
    } catch (err) {
        console.error('[MSG] Error in handleDeliveryAck', err);
    }
}

async function handleRead(recipientId, payload) {
    if (isDbFailureSimulated()) return;
    try {
        const now = Date.now();
        await run(`UPDATE messages SET readAt = ? WHERE id = ?`, [now, payload.serverMessageId]);
        console.log(`[READ] read receipt for message ${payload.serverMessageId}`);
        
        const msgRow = await get(`SELECT senderId, clientMessageId FROM messages WHERE id = ?`, [payload.serverMessageId]);
        if (msgRow) {
            const senderWs = getSocket(msgRow.senderId);
            if (senderWs) {
                senderWs.send(JSON.stringify({
                    type: 'READ_UPDATE',
                    payload: {
                        serverMessageId: payload.serverMessageId,
                        clientMessageId: msgRow.clientMessageId,
                        readAt: now
                    }
                }));
            }
        }
    } catch (err) {
        console.error('[MSG] Error in handleRead', err);
    }
}

async function syncPending(userId, ws) {
    try {
        const pendingMessages = await all(
            `SELECT * FROM messages WHERE recipientId = ? AND deliveredAt IS NULL AND senderPublicKey IS NOT NULL AND ciphertext IS NOT NULL`,
            [userId]
        );
        console.log(`[SYNC] Syncing ${pendingMessages.length} pending messages for ${userId}`);
        for (const msg of pendingMessages) {
            let senderPubKey;
            try {
                senderPubKey = typeof msg.senderPublicKey === 'string' ? JSON.parse(msg.senderPublicKey) : msg.senderPublicKey;
            } catch (e) {
                console.error('[SYNC] Failed to parse senderPublicKey for message', msg.id, e);
                continue;
            }
            if (!senderPubKey || !msg.ciphertext) continue;

            ws.send(JSON.stringify({
                type: 'DELIVER_MESSAGE',
                payload: {
                    serverMessageId: msg.id,
                    clientMessageId: msg.clientMessageId,
                    senderId: msg.senderId,
                    ciphertext: msg.ciphertext,
                    iv: msg.iv,
                    senderPublicKey: senderPubKey,
                    createdAt: msg.createdAt,
                    mediaId: msg.mediaId
                }
            }));
        }
    } catch (err) {
        console.error('[SYNC] Error syncing pending messages', err);
    }
}

async function registerPublicKey(userId, publicKeyData) {
    try {
        const existing = await get(`SELECT * FROM users WHERE id = ?`, [userId]);
        if (existing) {
            await run(`UPDATE users SET publicKey = ?, lastSeenAt = ? WHERE id = ?`, 
                [JSON.stringify(publicKeyData), Date.now(), userId]);
        } else {
            await run(`INSERT INTO users (id, username, publicKey, createdAt, lastSeenAt) VALUES (?, ?, ?, ?, ?)`, 
                [userId, userId, JSON.stringify(publicKeyData), Date.now(), Date.now()]);
        }
        console.log(`[AUTH] Registered public key for user ${userId}`);
    } catch (err) {
        console.error('[AUTH] Error registering public key', err);
    }
}

module.exports = {
    handleSendMessage,
    handleDeliveryAck,
    handleRead,
    syncPending,
    registerPublicKey
};
