# 🤖 Telegram Finance Bot (Google Sheets + Drive + Gemini AI)

Bot Telegram untuk mencatat keuangan pribadi secara otomatis berbasis AI. Cukup kirim chat teks (contoh: *"makan siang 35rb"*, *"kemarin beli bensin 50rb"*) atau kirim **foto nota/struk belanja**. Data akan diekstrak oleh **Google Gemini AI**, dicatat ke **Google Sheets**, dan bukti foto nota otomatis tersimpan di **Google Drive**.

Didesain untuk dideploy **100% GRATIS** ke **Vercel** via Serverless Webhook.

---

## 🌟 Fitur Utama

1. **Bahasa Natural (NLP):** Paham format rupiah (*35rb, 50k, 1.5jt*), pengeluaran vs pemasukan, dan tanggal relatif (*hari ini, kemarin, 3 hari lalu, tgl 15 agustus*).
2. **OCR Nota/Struk Cerdas:** Kirim foto struk kasir, Gemini Vision akan membaca total belanja, nama toko/merchant, dan tanggal struk.
3. **Penyimpanan Terpusat:**
   - Transaksi tersusun rapi di tabel **Google Sheets**.
   - Foto nota tersimpan di folder **Google Drive** dan tautan link-nya dicantumkan di baris transaksi.
4. **Perintah /rekap:** Menampilkan ringkasan total pemasukan, total pengeluaran, dan sisa saldo bulan ini.
5. **Privat & Aman:** Dilengkapi filter `ALLOWED_TELEGRAM_USER_IDS` sehingga hanya Anda yang bisa menggunakan bot ini.

---

## 🚀 Panduan Setup & Deploy ke Vercel

### 1. Dapatkan Kredensial yang Dibutuhkan

#### A. Telegram Bot Token
1. Buka Telegram dan cari `@BotFather`.
2. Kirim `/newbot` dan ikuti instruksinya.
3. Simpan token yang diberikan (contoh: `1234567890:ABCdefGHIjklMNOpqrs...`).

#### B. Gemini API Key (Gratis)
1. Buka [Google AI Studio](https://aistudio.google.com/).
2. Login dengan akun Google Anda dan klik **Get API key**.
3. Buat API Key baru dan salin.

#### C. Google Cloud Service Account (Untuk Sheets & Drive)
1. Buka [Google Cloud Console](https://console.cloud.google.com/).
2. Buat Project baru (misal: `catat-keuangan-bot`).
3. Buka menu **APIs & Services > Library**, aktifkan 2 API berikut:
   - **Google Sheets API**
   - **Google Drive API**
4. Buka menu **APIs & Services > Credentials > Create Credentials > Service Account**.
   - Beri nama (misal: `bot-sheets`), klik *Done*.
   - Salin email Service Account tersebut (contoh: `bot-sheets@project-id.iam.gserviceaccount.com`).
5. Klik Service Account yang baru dibuat > tab **Keys** > **Add Key** > **Create new key** > pilih format **JSON** > Unduh file JSON tersebut.
   - Buka file JSON: salin `client_email` dan `private_key`.

#### D. Google Sheets & Google Drive
1. Buat Spreadsheet baru di [Google Sheets](https://sheets.new).
   - Klik tombol **Share (Bagikan)** di kanan atas, masukkan email Service Account tadi dengan hak akses **Editor**.
   - Salin ID Spreadsheet dari URL: `https://docs.google.com/spreadsheets/d/`**`[ID_SPREADSHEET_DI_SINI]`**`/edit`.
2. Buat Folder baru di [Google Drive](https://drive.google.com) (misal: `Nota Keuangan`).
   - Klik kanan folder > **Share (Bagikan)** > masukkan email Service Account sebagai **Editor**.
   - Buka folder tersebut dan salin Folder ID dari URL: `https://drive.google.com/drive/folders/`**`[ID_FOLDER_DI_SINI]`**.

---

### 2. Konfigurasi Environment Variables

Buat file `.env.local` di komputer Anda (atau masukkan ke Vercel Environment Variables):

```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
GEMINI_API_KEY=AIzaSy...
GOOGLE_SERVICE_ACCOUNT_EMAIL=bot-sheets@project-id.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_SHEET_ID=1abc...
GOOGLE_SHEET_NAME=Transaksi
GOOGLE_DRIVE_FOLDER_ID=1xyz...
ALLOWED_TELEGRAM_USER_IDS=
```

---

### 3. Deploy ke Vercel

1. Push repository ini ke GitHub / GitLab.
2. Buka [Vercel](https://vercel.com), klik **Add New > Project**, lalu import repository ini.
3. Pada bagian **Environment Variables**, masukkan semua variabel dari poin 2 di atas.
4. Klik **Deploy**.
5. Setelah selesai, buka URL aplikasi Vercel Anda (misal: `https://duit-pwd-bot.vercel.app`), lalu klik tombol **🔗 Aktifkan Webhook Telegram**.
6. Selesai! Bot Anda di `@duit_pwd_bot` sudah aktif 24/7!
