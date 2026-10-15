const { setOnline, setOffline, getSocket } = require('../presence/manager');
const messageHandler = require('../message/handler');

function handleConnection(ws) {
    let currentUser = null;

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            
            switch (data.type) {
                case 'AUTH':
                    currentUser = data.payload.userId;
                    setOnline(currentUser, ws);
                    console.log(`[WS] User ${currentUser} authenticated`);
                    
                    // Sync pending messages
                    await messageHandler.syncPending(currentUser, ws);
                    break;
                case 'SEND_MESSAGE':
                    if (!currentUser) return;
                    await messageHandler.handleSendMessage(currentUser, data.payload, ws);
                    break;
                case 'DELIVERY_ACK':
                    if (!currentUser) return;
                    await messageHandler.handleDeliveryAck(currentUser, data.payload);
                    break;
                case 'READ':
                    if (!currentUser) return;
                    await messageHandler.handleRead(currentUser, data.payload);
                    break;
                case 'SYNC_PENDING':
                    if (!currentUser) return;
                    await messageHandler.syncPending(currentUser, ws);
                    break;
                case 'REGISTER_PUBLIC_KEY':
                    if (!currentUser) return;
                    await messageHandler.registerPublicKey(currentUser, data.payload.publicKey);
                    break;
                case 'PING':
                    ws.send(JSON.stringify({ type: 'PONG' }));
                    break;
                default:
                    console.log(`[WS] Unknown event type: ${data.type}`);
            }
        } catch (err) {
            console.error('[WS] Error processing message', err);
        }
    });

    ws.on('close', () => {
        if (currentUser) {
            setOffline(currentUser);
            console.log(`[WS] User ${currentUser} disconnected`);
        }
    });

    ws.on('error', (err) => {
        console.error('[WS] WebSocket error:', err);
    });
}

module.exports = {
    handleConnection
};
