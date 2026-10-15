import { getPendingMessages } from './local-db.js';
import { sendWebSocketMessage } from './websocket.js';

let isProcessing = false;

export async function processOutbox() {
    if (isProcessing) return;
    isProcessing = true;
    
    try {
        const pending = await getPendingMessages();
        for (const msg of pending) {
            console.log(`[OUTBOX] Attempting to send message ${msg.clientMessageId}`);
            sendWebSocketMessage('SEND_MESSAGE', {
                clientMessageId: msg.clientMessageId,
                recipientId: msg.recipientId,
                ciphertext: msg.ciphertext,
                iv: msg.iv,
                senderPublicKey: msg.senderPublicKey,
                mediaId: msg.mediaId
            });
        }
    } catch (err) {
        console.error('[OUTBOX] Error processing outbox', err);
    } finally {
        isProcessing = false;
    }
}
