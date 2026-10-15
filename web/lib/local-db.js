export function getDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('mini-whatsapp', 1);

        request.onerror = (event) => reject(event.target.error);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            
            if (!db.objectStoreNames.contains('messages')) {
                db.createObjectStore('messages', { keyPath: 'clientMessageId' });
            }
            if (!db.objectStoreNames.contains('identity')) {
                db.createObjectStore('identity', { keyPath: 'userId' });
            }
        };

        request.onsuccess = (event) => resolve(event.target.result);
    });
}

export async function saveMessage(message) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('messages', 'readwrite');
        const store = tx.objectStore('messages');
        const request = store.put(message);
        
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

export async function getAllMessages() {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('messages', 'readonly');
        const store = tx.objectStore('messages');
        const request = store.getAll();
        
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
    });
}

export async function getPendingMessages() {
    const messages = await getAllMessages();
    return messages.filter(m => m.status === 'LOCAL_PENDING');
}

export async function updateMessageStatus(clientMessageId, newStatus, updates = {}) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('messages', 'readwrite');
        const store = tx.objectStore('messages');
        const getReq = store.get(clientMessageId);
        
        getReq.onsuccess = () => {
            if (getReq.result) {
                const message = { ...getReq.result, ...updates, status: newStatus };
                const putReq = store.put(message);
                putReq.onsuccess = () => resolve();
                putReq.onerror = () => reject(putReq.error);
            } else {
                resolve();
            }
        };
        getReq.onerror = () => reject(getReq.error);
    });
}

export async function saveIdentity(userId, keyPair) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('identity', 'readwrite');
        const store = tx.objectStore('identity');
        const request = store.put({ userId, keyPair });
        
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

export async function getIdentity(userId) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('identity', 'readonly');
        const store = tx.objectStore('identity');
        const request = store.get(userId);
        
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}
