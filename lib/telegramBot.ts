import { Bot } from 'grammy';
import dns from 'dns';
import { google } from 'googleapis';
import { parseTextMessage, parseReceiptImage } from './gemini';
import { appendTransaction, getMonthSummary, updateTransactionNoteLink } from './googleSheets';
import { uploadReceiptToDrive } from './googleDrive';
import { formatPrivateKey, getGoogleAuth } from './googleAuth';

// Paksa IPv4 untuk menghindari timeout koneksi IPv6 ke server Telegram di jaringan Windows/ISP lokal
try {
  dns.setDefaultResultOrder('ipv4first');
} catch (e) {
  // Abaikan jika tidak didukung
}

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.warn('Peringatan: TELEGRAM_BOT_TOKEN belum diisi di environment variables.');
}

export const bot = new Bot(token || 'dummy_token');

function formatRupiah(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount);
}

// Middleware Keamanan: Whitelist Telegram User ID
bot.use(async (ctx, next) => {
  const allowed = process.env.ALLOWED_TELEGRAM_USER_IDS;
  if (allowed && allowed.trim() !== '') {
    const list = allowed.split(',').map((id) => id.trim());
    const senderId = String(ctx.from?.id);
    if (!list.includes(senderId)) {
      await ctx.reply(
        `⛔ *Akses Dibatasi*\nID Telegram Anda adalah: \`${senderId}\`\n\nUntuk mengizinkan akun ini menggunakan bot, tambahkan ID di atas ke variabel \`ALLOWED_TELEGRAM_USER_IDS\` di file konfigurasi.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }
  }
  await next();
});

// Command: /start & /help
bot.command(['start', 'help'], async (ctx) => {
  const senderId = ctx.from?.id;
  await ctx.reply(
    `👋 *Halo! Saya Bot Pencatat Keuangan Pribadi Anda.*\n\n` +
      `💡 *Cara Penggunaan:*\n` +
      `1. *Kirim Teks Bebas:* Langsung chat pengeluaran atau pemasukan Anda.\n` +
      `   • \`makan siang padang 35rb\`\n` +
      `   • \`kemarin beli bensin 50000\`\n` +
      `   • \`dapat transfer freelance 2.5jt tanggal 15 agustus\`\n\n` +
      `2. *Kirim Foto Nota / Struk:* Cukup kirim foto struk belanjaan Anda. AI akan otomatis membaca nominal, tanggal, dan nama toko, lalu menyimpannya ke Google Drive & Sheets!\n\n` +
      `3. *Cek Ringkasan:* Ketik /rekap untuk melihat total pengeluaran & pemasukan bulan ini.\n\n` +
      `🆔 _ID Telegram Anda: \`${senderId}\`_`,
    { parse_mode: 'Markdown' }
  );
});

// Command: /debug (Diagnostik sistem & koneksi Google Sheets di Vercel)
bot.command('debug', async (ctx) => {
  const rawKey = process.env.GOOGLE_PRIVATE_KEY || '';
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
  const sheetId = process.env.GOOGLE_SHEET_ID || '';
  const formatted = formatPrivateKey(rawKey);

  let jwtStatus = 'Testing...';
  try {
    const auth = getGoogleAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'Transaksi!A1:B1',
    });
    jwtStatus = `✅ Sukses! Kolom: ${res.data.values?.[0]?.join(', ')}`;
  } catch (err: any) {
    jwtStatus = `❌ Gagal: ${err.message}`;
  }

  const msg =
    `🛠️ *Laporan Diagnostik Bot*\n\n` +
    `📧 *Service Account:* \`${email || 'KOSONG'}\`\n` +
    `📊 *Sheet ID:* \`${sheetId || 'KOSONG'}\`\n` +
    `🔑 *Raw Key Length:* ${rawKey.length} karakter\n` +
    `✨ *Formatted Key Length:* ${formatted.length} karakter\n` +
    `📌 *Kunci Awal:* \`${rawKey.slice(0, 30)}\`\n` +
    `📌 *Kunci Akhir:* \`${rawKey.slice(-30)}\`\n\n` +
    `📋 *Status Google Sheets:* ${jwtStatus}`;

  await ctx.reply(msg, { parse_mode: 'Markdown' });
});

// Command: /rekap & /recap
bot.command(['rekap', 'recap'], async (ctx) => {
  try {
    await ctx.replyWithChatAction('typing');

    // Cek apakah ada argumen bulan, misal: /rekap agustus atau /rekap 08 atau /rekap 2026-08
    const text = ctx.message?.text || '';
    const parts = text.split(' ').slice(1).join(' ').trim().toLowerCase();

    let targetPrefix: string | undefined;

    const monthMap: Record<string, string> = {
      januari: '01', jan: '01',
      februari: '02', feb: '02',
      maret: '03', mar: '03',
      april: '04', apr: '04',
      mei: '05',
      juni: '06', jun: '06',
      juli: '07', jul: '07',
      agustus: '08', agu: '08', agt: '08',
      september: '09', sep: '09',
      oktober: '10', okt: '10',
      november: '11', nov: '11',
      desember: '12', des: '12',
    };

    const currentYear = new Date().getFullYear();

    if (parts) {
      if (monthMap[parts]) {
        targetPrefix = `${currentYear}-${monthMap[parts]}`;
      } else if (/^\d{1,2}$/.test(parts)) {
        targetPrefix = `${currentYear}-${parts.padStart(2, '0')}`;
      } else if (/^\d{4}-\d{1,2}$/.test(parts)) {
        const [y, m] = parts.split('-');
        targetPrefix = `${y}-${m.padStart(2, '0')}`;
      }
    }

    const summary = await getMonthSummary(targetPrefix);

    let msg = `📊 *Rekap Keuangan (${summary.bulan})*\n\n`;
    msg += `🟢 *Pemasukan:* ${formatRupiah(summary.totalPemasukan)}\n`;
    msg += `🔴 *Pengeluaran:* ${formatRupiah(summary.totalPengeluaran)}\n`;
    msg += `💰 *Sisa Saldo Periode Ini:* ${formatRupiah(summary.saldo)}\n`;
    msg += `📝 *Jumlah Transaksi:* ${summary.count} transaksi\n\n`;

    msg += `━━━━━━━━━━━━━━━━━━━\n`;
    msg += `🌐 *Akumulasi Kas (Semua Periode):*\n`;
    msg += `🟢 *Total Uang Masuk:* ${formatRupiah(summary.totalAllTimePemasukan)}\n`;
    msg += `🔴 *Total Uang Keluar:* ${formatRupiah(summary.totalAllTimePengeluaran)}\n`;
    msg += `💵 *Sisa Saldo Kas Riil:* ${formatRupiah(summary.saldoAllTime)}\n`;
    msg += `📑 *Total Seluruh Transaksi:* ${summary.totalAllTimeCount} transaksi\n\n`;
    msg += `💡 _Tips: Anda bisa cek bulan lain dengan cara:_ \`/rekap agustus\` _atau_ \`/rekap 08\``;

    await ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (error: any) {
    console.error('Error saat membuat rekap:', error);
    await ctx.reply(`⚠️ Gagal mengambil rekap: ${error?.message || 'Terjadi kesalahan sistem.'}`);
  }
});

// Handler: Pesan Teks
bot.on('message:text', async (ctx) => {
  const text = ctx.message.text.trim();

  // Jika pengguna mengetik 'rekap' atau 'recap' tanpa tanda slash
  if (text.toLowerCase().startsWith('rekap') || text.toLowerCase().startsWith('recap')) {
    // Arahkan ke handler rekap
    const parts = text.split(' ').slice(1).join(' ').trim().toLowerCase();
    const monthMap: Record<string, string> = {
      januari: '01', jan: '01',
      februari: '02', feb: '02',
      maret: '03', mar: '03',
      april: '04', apr: '04',
      mei: '05',
      juni: '06', jun: '06',
      juli: '07', jul: '07',
      agustus: '08', agu: '08', agt: '08',
      september: '09', sep: '09',
      oktober: '10', okt: '10',
      november: '11', nov: '11',
      desember: '12', des: '12',
    };
    const currentYear = new Date().getFullYear();
    let targetPrefix: string | undefined;
    if (parts && monthMap[parts]) {
      targetPrefix = `${currentYear}-${monthMap[parts]}`;
    }
    const summary = await getMonthSummary(targetPrefix);
    let msg = `📊 *Rekap Keuangan (${summary.bulan})*\n\n`;
    msg += `🟢 *Pemasukan:* ${formatRupiah(summary.totalPemasukan)}\n`;
    msg += `🔴 *Pengeluaran:* ${formatRupiah(summary.totalPengeluaran)}\n`;
    msg += `💰 *Sisa Saldo Periode Ini:* ${formatRupiah(summary.saldo)}\n`;
    msg += `📝 *Jumlah Transaksi:* ${summary.count} transaksi\n\n`;
    msg += `━━━━━━━━━━━━━━━━━━━\n`;
    msg += `🌐 *Akumulasi Kas (Semua Periode):*\n`;
    msg += `🟢 *Total Uang Masuk:* ${formatRupiah(summary.totalAllTimePemasukan)}\n`;
    msg += `🔴 *Total Uang Keluar:* ${formatRupiah(summary.totalAllTimePengeluaran)}\n`;
    msg += `💵 *Sisa Saldo Kas Riil:* ${formatRupiah(summary.saldoAllTime)}\n`;
    msg += `📑 *Total Seluruh Transaksi:* ${summary.totalAllTimeCount} transaksi`;
    await ctx.reply(msg, { parse_mode: 'Markdown' });
    return;
  }

  if (text.startsWith('/')) {
    await ctx.reply('❓ Perintah tidak dikenali. Ketik /help untuk melihat panduan atau /rekap untuk melihat ringkasan keuangan.');
    return;
  }

  try {
    await ctx.replyWithChatAction('typing');
    const parsed = await parseTextMessage(text);

    if (!parsed) {
      await ctx.reply(
        `🤔 Maaf, saya belum mengenali catatan keuangan dari pesan tersebut.\n` +
          `Contoh yang bisa dipahami:\n` +
          `• \`Makan sate 45rb\`\n` +
          `• \`Kemarin ganti oli motor 75.000\`\n` +
          `• \`Gaji kantor 8jt tanggal 25\``
      );
      return;
    }

    // Simpan ke Google Sheets
    await appendTransaction(parsed);

    const emoji = parsed.type === 'Pemasukan' ? '🟢' : '🔴';
    await ctx.reply(
      `✅ *Transaksi Berhasil Dicatat!*\n\n` +
        `📅 *Tanggal:* ${parsed.date}\n` +
        `${emoji} *Jenis:* ${parsed.type}\n` +
        `📂 *Kategori:* ${parsed.category}\n` +
        `💰 *Nominal:* ${formatRupiah(parsed.amount)}\n` +
        `📝 *Keterangan:* ${parsed.description}`,
      { parse_mode: 'Markdown' }
    );
  } catch (error: any) {
    console.error('Error processing text transaction:', error);
    await ctx.reply(
      `❌ Gagal mencatat transaksi: ${error?.message || 'Terjadi gangguan internal.'}`
    );
  }
});

// Handler: Foto Nota / Struk
bot.on(['message:photo', 'message:document'], async (ctx) => {
  try {
    let fileId: string | undefined;
    let fileName = `nota_${Date.now()}.jpg`;
    let mimeType = 'image/jpeg';

    if (ctx.message.photo) {
      const photos = ctx.message.photo;
      const largestPhoto = photos[photos.length - 1];
      fileId = largestPhoto.file_id;
    } else if (ctx.message.document) {
      const doc = ctx.message.document;
      if (doc.mime_type?.startsWith('image/')) {
        fileId = doc.file_id;
        fileName = doc.file_name || fileName;
        mimeType = doc.mime_type;
      }
    }

    if (!fileId) {
      await ctx.reply('⚠️ Mohon kirimkan file berupa gambar foto nota/struk belanja.');
      return;
    }

    await ctx.reply('🔍 *Menganalisis foto nota & mengunggah ke Google Drive...*', {
      parse_mode: 'Markdown',
    });
    await ctx.replyWithChatAction('upload_photo');

    // Download file dari server Telegram
    const file = await ctx.api.getFile(fileId);
    if (!file.file_path) {
      throw new Error('Tidak dapat mengunduh file dari Telegram.');
    }

    const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    const response = await fetch(fileUrl);
    if (!response.ok) {
      throw new Error(`Gagal fetch file dari Telegram: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Proses OCR dengan Gemini terlebih dahulu agar transaksi langsung tercatat tanpa menunggu upload Drive
    const parsed = await parseReceiptImage(buffer, mimeType, ctx.message.caption);

    if (!parsed) {
      await ctx.reply(
        '⚠️ Gambar tidak terdeteksi sebagai nota/struk belanja atau bukti transfer yang valid. Mohon pastikan foto cukup jelas dan mencakup nominal transaksi.'
      );
      return;
    }

    // 1. Simpan segera ke Google Sheets
    const rowNumber = await appendTransaction(parsed);

    // 2. Beri notifikasi instan ke pengguna bahwa transaksi sudah tercatat!
    const emoji = parsed.type === 'Pemasukan' ? '🟢' : '🔴';
    await ctx.reply(
      `🧾 *Transaksi Berhasil Dicatat!*\n\n` +
        `📅 *Tanggal:* ${parsed.date}\n` +
        `${emoji} *Jenis:* ${parsed.type}\n` +
        `📂 *Kategori:* ${parsed.category}\n` +
        `💰 *Total Nominal:* ${formatRupiah(parsed.amount)}\n` +
        `📝 *Keterangan:* ${parsed.description}\n\n` +
        `⏳ _Foto sedang diunggah ke Google Drive di latar belakang..._`,
      { parse_mode: 'Markdown' }
    );

    // 3. Upload ke Google Drive secara asinkron (background) agar tidak menghambat antrean foto berikutnya
    (async () => {
      try {
        const driveLink = await uploadReceiptToDrive(buffer, fileName, mimeType);
        if (driveLink) {
          if (rowNumber) {
            await updateTransactionNoteLink(rowNumber, driveLink).catch(console.error);
          }
          await ctx.reply(
            `📎 *Foto Tersimpan di Google Drive!*\n` +
              `📝 *Item:* ${parsed.description} (${formatRupiah(parsed.amount)})\n` +
              `🔗 [Buka Foto di Google Drive](${driveLink})`,
            { parse_mode: 'Markdown', link_preview_options: { is_disabled: true } }
          ).catch(console.error);
        }
      } catch (uploadErr) {
        console.error('Error saat upload background ke Drive:', uploadErr);
      }
    })();
  } catch (error: any) {
    console.error('Error processing receipt:', error);
    await ctx.reply(
      `❌ Gagal memproses foto: ${error?.message || 'Terjadi kesalahan sistem.'}`
    );
  }
});
