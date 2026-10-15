Keputusan untuk menulis ulang sendiri (*rewrite from scratch*) secara manual adalah langkah yang sangat tepat jika tujuan utamanya adalah menguasai fundamental dan makna arsitekturnya. Mengetik kode sendiri secara bertahap memaksa otak memahami alasan di balik setiap baris kode, daripada sekadar menghafal proyek yang sudah jadi.

Namun, ada satu peringatan penting: **jangan mengetik semuanya sekaligus lalu baru dijalankan di akhir.** Jika dilakukan seperti itu, kamu akan berhadapan dengan puluhan error sekaligus dan frustrasi.

Cara yang benar dan logis adalah **membangun per lapisan (*layer by layer*)**, di mana setiap lapisan bisa langsung kamu uji fungsinya sebelum melangkah ke lapisan berikutnya.

---

### Estimasi Waktu yang Realistis

Jika kamu menulis manual sendiri tanpa copy-paste buta:
* **Waktu pengetikan murni:** sekitar 2,5 hingga 3 jam.
* **Waktu pengetikan + pemahaman + perbaikan salah ketik (*debugging typo*):** secara realistis membutuhkan **6 hingga 8 jam** (bisa dibagi menjadi 2 sesi/hari, masing-masing 3–4 jam).

---

### Urutan Logis Pembangunan Proyek (Langkah Demi Langkah)

Berikut urutan dari fondasi paling bawah hingga ke tampilan antarmuka:

---

#### TAHAP 1: Inisialisasi Proyek dan Folder (Estimasi: 20 Menit)

**Yang Dibangun:**
1. Root [package.json](file:///d:/distributed-system/package.json) (untuk script menjalankan server dan web bersamaan).
2. Folder `server/` dengan instalasi pustaka: `express`, `ws`, `sqlite3`, `multer`, `uuid`, `cors`, `dotenv`.
3. Folder `web/` menggunakan Next.js (TypeScript dan Tailwind CSS).

**Makna/Esensi:**
Memisahkan lingkungan kerja antara node server (Node.js murni) dan node klien (React/Next.js).

---

#### TAHAP 2: Fondasi Database dan State Server (Estimasi: 45 Menit)

Bangun backend bagian penyimpanan data terlebih dahulu sebelum membuat koneksi jaringan.

**File yang Ditulis:**
1. [server/src/database/db.js](file:///d:/distributed-system/server/src/database/db.js):
   * Membuat koneksi SQLite ke file `data/messages.db`.
   * Membuat tabel `users` (id, username, publicKey, lastSeenAt).
   * Membuat tabel `messages` (id, clientMessageId, senderId, recipientId, ciphertext, iv, senderPublicKey, createdAt, deliveredAt, readAt, expiresAt, mediaId).
2. [server/src/presence/manager.js](file:///d:/distributed-system/server/src/presence/manager.js):
   * Menggunakan objek `new Map()` di memori untuk mencatat socket user yang sedang online.
3. [server/view-db.js](file:///d:/distributed-system/server/view-db.js):
   * Script CLI sederhana untuk membaca tabel `messages` lewat terminal.

**Cara Mengujinya:**
Jalankan `node server/src/database/db.js`, lalu periksa apakah folder `server/data/` dan file `messages.db` berhasil terbentuk secara fisik.

---

#### TAHAP 3: Lapisan Kriptografi dan Penyimpanan Lokal Klien (Estimasi: 1 Jam)

Sebelum klien mengirim data, klien harus punya identitas dan kemampuan mengenkripsi data sendiri.

**File yang Ditulis:**
1. [web/lib/crypto.js](file:///d:/distributed-system/web/lib/crypto.js):
   * Fungsi `generateKeyPair()`: Membuat pasangan kunci ECDH P-256.
   * Fungsi `exportPublicKey()` dan `importPublicKey()`: Konversi kunci ke format JWK JSON.
   * Fungsi `deriveSharedSecret()`: Menghitung kunci rahasia bersama via ECDH.
   * Fungsi `encryptMessage()` dan `decryptMessage()`: Enkripsi dan dekripsi menggunakan AES-GCM 256-bit.
2. [web/lib/local-db.js](file:///d:/distributed-system/web/lib/local-db.js):
   * Membuka IndexedDB bernama `mini-whatsapp`.
   * Membuat object store `identity` (menyimpan kunci privat pengguna).
   * Membuat object store `messages` (menyimpan riwayat chat di browser).
   * Fungsi `saveMessage()`, `getAllMessages()`, `getPendingMessages()`, dan `updateMessageStatus()`.

**Cara Mengujinya:**
Buka browser console (F12), impor file `crypto.js`, lalu panggil fungsi `generateKeyPair()`. Pastikan browser menghasilkan objek kunci tanpa error.

---

#### TAHAP 4: Jalur Komunikasi Jaringan (WebSocket Client-Server) (Estimasi: 1,5 Jam)

Setelah server punya storage dan klien punya kriptografi, barulah sambungkan keduanya dengan pipa WebSocket.

**File yang Ditulis:**
1. [server/src/index.js](file:///d:/distributed-system/server/src/index.js):
   * Inisialisasi HTTP server Express dan WebSocket server (`ws`).
   * Menambahkan pembersih pesan kedaluwarsa (`setInterval` 60 detik).
2. [server/src/websocket/handler.js](file:///d:/distributed-system/server/src/websocket/handler.js):
   * Menerima koneksi WebSocket.
   * Menangani event dasar: `AUTH`, `PING`, dan penutupan koneksi (`on('close')`).
3. [web/lib/websocket.js](file:///d:/distributed-system/web/lib/websocket.js):
   * Fungsi `connectWebSocket()` dengan mekanisme **Exponential Backoff** (`reconnectInterval = Math.min(reconnectInterval * 2, maxReconnectInterval)`).
   * Antrean internal `messageQueue` jika socket belum siap.
4. [web/lib/outbox.js](file:///d:/distributed-system/web/lib/outbox.js):
   * Fungsi `processOutbox()` yang membaca pesan pending dari IndexedDB dan mengirimkannya ke WebSocket.

**Cara Mengujinya:**
Nyalakan server (`node server/src/index.js`). Buka browser console dan jalankan `connectWebSocket()`. Lihat di terminal server apakah log `User authenticated` muncul.

---

#### TAHAP 5: Logika Utama Perpesanan Server (Store-and-Forward & Idempotency) (Estimasi: 1,5 Jam)

Ini adalah tahap inti arsitektur terdistribusi.

**File yang Ditulis:**
1. [server/src/failure-simulation/manager.js](file:///d:/distributed-system/server/src/failure-simulation/manager.js):
   * Flag simulasi kegagalan database.
2. [server/src/message/handler.js](file:///d:/distributed-system/server/src/message/handler.js):
   * `handleSendMessage()`: Cek kegagalan DB -> Cek duplikasi `clientMessageId` (idempotency) -> Simpan SQLite -> Balas `MESSAGE_ACK` -> Cek presence penerima (`if (recipientWs)` kirim langsung, `else` antre di server).
   * `handleDeliveryAck()`: Update `deliveredAt` di SQLite -> Kirim `DELIVERY_UPDATE` ke pengirim.
   * `handleRead()`: Update `readAt` di SQLite -> Kirim `READ_UPDATE` ke pengirim.
   * `syncPending()`: Menguras pesan tertunda di SQLite (`deliveredAt IS NULL`) saat user login.
   * `registerPublicKey()`: Menyimpan kunci publik user ke tabel `users`.

**Makna/Esensi:**
Memahami alur pesan: Simpan -> ACK -> Teruskan. Inilah yang membuat pesan tidak pernah hilang saat penerima offline.

---

#### TAHAP 6: Media Plane / Pengiriman Gambar (Estimasi: 45 Menit)

Memisahkan jalur data biner dari pipa WebSocket.

**File yang Ditulis:**
1. [server/src/media/router.js](file:///d:/distributed-system/server/src/media/router.js):
   * Konfigurasi `multer` untuk menerima file upload HTTP POST.
   * Menyimpan file ke `server/uploads/` dengan penamaan `uuidv4()`.
   * Endpoint GET `/api/media/:mediaId` untuk streaming gambar.
2. Daftarkan router ini di [server/src/index.js](file:///d:/distributed-system/server/src/index.js) pada baris `app.use('/api/media', mediaRouter)`.

**Makna/Esensi:**
Memahami arsitektur pemisahan *Control Plane* (WebSocket teks) dan *Data Plane* (HTTP media).

---

#### TAHAP 7: Antarmuka Web dan Integrasi State (Estimasi: 2 Jam)

Menghubungkan semua fungsi backend, IndexedDB, dan WebCrypto ke dalam antarmuka obrolan pengguna.

**File yang Ditulis:**
[web/app/page.tsx](file:///d:/distributed-system/web/app/page.tsx):
1. **State:** Menyimpan `currentUser`, `recipient`, `messages`, `connectionState`, `selectedFile`.
2. **Koneksi Otomatis:** `useEffect` untuk login dan inisialisasi kunci kriptografi.
3. **Penanganan Event WebSocket (`handleWsMessage`):**
   * Mengubah status pesan lokal saat menerima `MESSAGE_ACK`, `DELIVERY_UPDATE`, dan `READ_UPDATE`.
   * Mendekripsi teks dan membalas `DELIVERY_ACK` saat menerima `DELIVER_MESSAGE`.
4. **Fungsi Kirim (`handleSend`):**
   * Upload file media jika ada -> Enkripsi teks -> Simpan ke IndexedDB (`LOCAL_PENDING`) -> Kirim ke WebSocket jika online.
5. **Render Komponen UI:**
   * Header chat yang jelas (*Chat Dengan* vs *Akun Anda*).
   * Daftar bubble chat dengan indikator centang dan penampil gambar.
   * Developer Panel untuk simulasi offline, gagal database, dan tombol Force Retry Outbox.
   * Auto-scroll menggunakan `useRef` dan `scrollIntoView()`.

---

### Rekomendasi Cara Menjalankannya

Jika kamu ingin mulai menulis manual sekarang:
1. Buka folder baru atau workspace kosong di sebelah proyek yang sudah ada.
2. Jadikan proyek yang sekarang sebagai **referensi/contekkan jawaban**.
3. Ketik baris demi baris mengikuti urutan **Tahap 1 sampai 7** di atas.
4. Di setiap akhir tahap, jalankan dan tes seperti instruksi yang saya berikan.

Dengan menyelesaikan penulisan ini sendiri, saat presentasi di depan dosen kamu tidak akan ragu atau bingung lagi, karena kamu tahu persis alasan setiap baris kode itu ditaruh di sana.