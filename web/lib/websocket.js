let ws = null;
let reconnectInterval = 1000;
let maxReconnectInterval = 10000;
let isIntentionalDisconnect = false;
let messageQueue = [];

export function connectWebSocket(url, onMessage, onStateChange) {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        return;
    }
    
    isIntentionalDisconnect = false;
    onStateChange('CONNECTING');
    
    try {
        ws = new WebSocket(url);
        
        ws.onopen = () => {
            onStateChange('CONNECTED');
            reconnectInterval = 1000; // reset
            
            // Send pending queue
            while (messageQueue.length > 0) {
                ws.send(JSON.stringify(messageQueue.shift()));
            }
        };
        
        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                onMessage(data);
            } catch (err) {
                console.error("Error parsing WS message", err);
            }
        };
        
        ws.onclose = () => {
            if (!isIntentionalDisconnect) {
                onStateChange('RECONNECTING');
                setTimeout(() => {
                    connectWebSocket(url, onMessage, onStateChange);
                }, reconnectInterval);
                
                reconnectInterval = Math.min(reconnectInterval * 2, maxReconnectInterval);
            } else {
                onStateChange('DISCONNECTED');
            }
        };
        
        ws.onerror = (err) => {
            console.error('WebSocket error:', err);
            ws.close();
        };
    } catch (err) {
        console.error("Error creating WebSocket", err);
        onStateChange('DISCONNECTED');
    }
}

export function disconnectWebSocket() {
    isIntentionalDisconnect = true;
    if (ws) {
        ws.close();
        ws = null;
    }
}

export function sendWebSocketMessage(type, payload) {
    const msg = { type, payload };
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
    } else {
        messageQueue.push(msg);
    }
}
