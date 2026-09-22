import { Bot } from 'grammy';
import dns from 'dns';
import { parseTextMessage, parseReceiptImage } from './gemini';
import { appendTransaction, getMonthSummary, updateTransactionNoteLink } from './googleSheets';
import { uploadReceiptToDrive } from './googleDrive';

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

// Command: /rekap
bot.command('rekap', async (ctx) => {
  try {
    await ctx.replyWithChatAction('typing');
    const summary = await getMonthSummary();
    await ctx.reply(
      `📊 *Ringkasan Keuangan (${summary.bulan})*\n\n` +
        `🟢 *Total Pemasukan:* ${formatRupiah(summary.totalPemasukan)}\n` +
        `🔴 *Total Pengeluaran:* ${formatRupiah(summary.totalPengeluaran)}\n` +
        `💰 *Sisa Saldo:* ${formatRupiah(summary.saldo)}\n\n` +
        `📝 *Total Transaksi Tercatat:* ${summary.count} transaksi.`,
      { parse_mode: 'Markdown' }
    );
  } catch (error: any) {
    console.error('Error saat membuat rekap:', error);
    await ctx.reply(`⚠️ Gagal mengambil rekap: ${error?.message || 'Terjadi kesalahan sistem.'}`);
  }
});

// Handler: Pesan Teks
bot.on('message:text', async (ctx) => {
  const text = ctx.message.text.trim();
  if (text.startsWith('/')) return; // Abaikan slash commands

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
