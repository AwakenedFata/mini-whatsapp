const onlineUsers = new Map();

function setOnline(userId, ws) {
    onlineUsers.set(userId, ws);
    console.log(`[PRESENCE] User ${userId} is now ONLINE`);
}

function setOffline(userId) {
    onlineUsers.delete(userId);
    console.log(`[PRESENCE] User ${userId} is now OFFLINE`);
}

function isOnline(userId) {
    return onlineUsers.has(userId);
}

function getSocket(userId) {
    return onlineUsers.get(userId);
}

function getAllOnlineUsers() {
    return Array.from(onlineUsers.keys());
}

module.exports = {
    setOnline,
    setOffline,
    isOnline,
    getSocket,
    getAllOnlineUsers
};
