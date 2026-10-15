const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const db = new sqlite3.Database(path.join(dataDir, 'messages.db'));

db.serialize(() => {
    // Users table
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT,
            publicKey TEXT,
            createdAt INTEGER,
            lastSeenAt INTEGER
        )
    `);

    // Messages table
    db.run(`
        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            clientMessageId TEXT UNIQUE,
            senderId TEXT,
            recipientId TEXT,
            ciphertext TEXT,
            iv TEXT,
            senderPublicKey TEXT,
            createdAt INTEGER,
            deliveredAt INTEGER,
            readAt INTEGER,
            expiresAt INTEGER,
            mediaId TEXT
        )
    `);
});

module.exports = db;
