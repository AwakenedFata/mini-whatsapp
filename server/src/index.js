require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const { handleConnection } = require('./websocket/handler');
const { getAllOnlineUsers } = require('./presence/manager');
const db = require('./database/db');
const mediaRouter = require('./media/router');
const { setDbFailureSimulation, isDbFailureSimulated } = require('./failure-simulation/manager');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());

// Basic API routes
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        database: isDbFailureSimulated() ? 'simulated_failure' : 'ok',
        connections: getAllOnlineUsers().length
    });
});

app.use('/api/media', mediaRouter);

app.post('/api/simulate-db-failure', (req, res) => {
    const { fail } = req.body;
    setDbFailureSimulation(fail);
    res.json({ success: true, dbFailureSimulated: isDbFailureSimulated() });
});

app.get('/api/users/:userId/public-key', (req, res) => {
    db.get(`SELECT publicKey FROM users WHERE id = ?`, [req.params.userId], (err, row) => {
        if (err || !row) {
            return res.status(404).json({ error: 'Not found' });
        }
        res.json({ publicKey: JSON.parse(row.publicKey) });
    });
});

// WebSocket Server
wss.on('connection', (ws) => {
    handleConnection(ws);
});

// Cleanup job for expired messages
setInterval(() => {
    const now = Date.now();
    db.run(`DELETE FROM messages WHERE expiresAt < ? AND deliveredAt IS NULL`, [now], function(err) {
        if (err) {
            console.error('[CLEANUP] Error deleting expired messages', err);
        } else if (this.changes > 0) {
            console.log(`[CLEANUP] Deleted ${this.changes} expired pending messages`);
        }
    });
}, 60000); // Check every minute

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
    console.log(`Messaging Server running on port ${PORT}`);
});
