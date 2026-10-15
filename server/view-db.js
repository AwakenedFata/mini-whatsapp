const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'data/messages.db');
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
    if (err) {
        console.error("Gagal membuka database:", err.message);
        process.exit(1);
    }
});

console.log(`\nMembaca database dari: ${dbPath}`);
console.log("================================================================================");

const query = `
    SELECT 
        clientMessageId, 
        senderId, 
        recipientId, 
        CASE WHEN deliveredAt IS NULL THEN ' TERTUNDA (Di Server)' ELSE ' TERKIRIM' END as status,
        ciphertext
    FROM messages
`;

db.all(query, [], (err, rows) => {
    if (err) {
        throw err;
    }

    if (rows.length === 0) {
        console.log("Database kosong. Belum ada pesan.");
    } else {
        // Potong ciphertext agar tabel tidak terlalu panjang saat didemokan
        const formattedRows = rows.map(row => ({
            ...row,
            ciphertext: row.ciphertext ? row.ciphertext.substring(0, 15) + '...' : '(null)'
        }));
        console.table(formattedRows);
    }

    console.log("================================================================================\n");
    db.close();
});
