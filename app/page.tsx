'use client';

import { useState } from 'react';

export default function HomePage() {
  const [webhookStatus, setWebhookStatus] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const activateWebhook = async () => {
    setIsLoading(true);
    setWebhookStatus(null);
    try {
      const res = await fetch('/api/set-webhook');
      const data = await res.json();
      if (data.success) {
        setWebhookStatus(`✅ ${data.message} (${data.webhookUrl})`);
      } else {
        setWebhookStatus(`❌ ${data.error || 'Gagal mengatur webhook'}`);
      }
    } catch (err: any) {
      setWebhookStatus(`❌ Error koneksi: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="container">
      <header className="header">
        <h1>Catat Keuangan Telegram Bot</h1>
        <p>Asisten pencatatan keuangan otomatis berbasis Google Gemini AI, Sheets & Drive</p>
      </header>

      <div className="card">
        <h2>
          🤖 Bot Telegram: <span style={{ color: '#38bdf8' }}>@duit_pwd_bot</span>
        </h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
          Setelah dideploy ke Vercel, klik tombol di bawah untuk menyambungkan bot Telegram Anda dengan URL Vercel ini secara otomatis.
        </p>

        <button className="btn" onClick={activateWebhook} disabled={isLoading}>
          {isLoading ? 'Menghubungkan Webhook...' : '🔗 Aktifkan Webhook Telegram'}
        </button>

        {webhookStatus && (
          <div style={{ marginTop: '1rem', padding: '0.75rem', background: '#030712', borderRadius: '8px' }}>
            <p style={{ fontSize: '0.9rem' }}>{webhookStatus}</p>
          </div>
        )}
      </div>

      <div className="card">
        <h2>📋 Cara Penggunaan di Telegram</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div>
            <strong>1. Catat Pengeluaran / Pemasukan Lewat Chat:</strong>
            <div className="code-snippet">Makan siang ayam geprek 25rb</div>
            <div className="code-snippet">Kemarin servis motor 120.000</div>
            <div className="code-snippet">Terima transfer proyek 3jt tanggal 15 agustus</div>
          </div>

          <div style={{ marginTop: '0.5rem' }}>
            <strong>2. Kirim Foto Nota / Struk Belanja:</strong>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              Foto struk belanja (Indomaret, restoran, SPBU, dll). Gemini AI akan otomatis mengekstrak nominal dan tanggal, lalu bukti nota langsung diunggah ke Google Drive Anda.
            </p>
          </div>

          <div style={{ marginTop: '0.5rem' }}>
            <strong>3. Lihat Ringkasan Bulan Ini:</strong>
            <div className="code-snippet">/rekap</div>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>⚙️ Konfigurasi Environment Variables (.env)</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1rem' }}>
          Pastikan variabel-variabel berikut sudah dimasukkan di pengaturan Project Vercel (Settings &gt; Environment Variables):
        </p>
        <table className="config-table">
          <tbody>
            <tr>
              <td><code>TELEGRAM_BOT_TOKEN</code></td>
              <td>Token dari @BotFather</td>
            </tr>
            <tr>
              <td><code>GEMINI_API_KEY</code></td>
              <td>API Key dari Google AI Studio (Gratis)</td>
            </tr>
            <tr>
              <td><code>GOOGLE_SERVICE_ACCOUNT_EMAIL</code></td>
              <td>Email Service Account Google Cloud</td>
            </tr>
            <tr>
              <td><code>GOOGLE_PRIVATE_KEY</code></td>
              <td>Private Key Service Account</td>
            </tr>
            <tr>
              <td><code>GOOGLE_SHEET_ID</code></td>
              <td>ID Dokumen Google Sheets</td>
            </tr>
            <tr>
              <td><code>GOOGLE_DRIVE_FOLDER_ID</code></td>
              <td>ID Folder Google Drive untuk bukti nota</td>
            </tr>
            <tr>
              <td><code>ALLOWED_TELEGRAM_USER_IDS</code></td>
              <td>(Opsional) ID Telegram Anda agar aman dan privat</td>
            </tr>
          </tbody>
        </table>
      </div>
    </main>
  );
}
