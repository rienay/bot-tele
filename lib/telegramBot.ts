import { Bot, InputFile, InlineKeyboard } from 'grammy';
import dns from 'dns';
import { google } from 'googleapis';
import { parseTextMessage, parseReceiptImage } from './gemini';
import {
  appendTransaction,
  getMonthSummary,
  updateTransactionNoteLink,
  getAllSheetBooks,
  createSheetBook,
  getUserActiveBook,
  setUserActiveBook,
  getAllSheetsSummary,
  DEFAULT_BOOK_NAME,
  sanitizeBookName,
  transferBookBalance,
  getRecentTransactionsWithNotes,
  getTransactionByRow,
  findMatchingTransactionRow,
  findMatchingTransactionRowAcrossBooks,
} from './googleSheets';
import {
  getDaftarAnggota,
  tambahAnggota,
  ubahStatusAnggota,
  catatPembayaranKas,
  cekStatusKasBulan,
  cekStatusKasAnggota,
  normalisasiBulan,
  DAFTAR_BULAN,
  NOMINAL_IURAN_DEFAULT,
} from './kasAnggota';
import { uploadReceiptToDrive, getDriveConfigStatus, testDriveUpload } from './googleDrive';
import { formatPrivateKey, getGoogleAuth } from './googleAuth';
import { generateNotaPdf, HARGA_PER_KG, rupiahFormat } from './generateNota';
import { ExpenseDetail } from './types';
import {
  checkUserAccess,
  isUserAdmin,
  registerUserRequest,
  approveUser,
  rejectUser,
  revokeUser,
  getAllUsers,
  getAdminTelegramId,
  getUserRecord,
} from './userAccess';

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

// Set untuk deduplikasi: mencegah 1 update diproses >1x akibat Telegram retry webhook
const processedUpdateIds = new Set<number>();
const MAX_DEDUP_CACHE = 500; // batas agar memori tidak bocor

// State untuk percakapan /buat buku baru
const createBookStates = new Map<number, boolean>();

// ============================================================
// STATE MACHINE: Percakapan multi-step untuk /pindahsaldo
// ============================================================
type TransferStep = 'select_source' | 'select_target' | 'select_amount' | 'input_amount' | 'confirm';
interface TransferState {
  step: TransferStep;
  books?: { bookName: string; saldo: number }[];
  sourceBook?: string;
  sourceBalance?: number;
  targetBook?: string;
  amount?: number;
}
const transferStates = new Map<number, TransferState>();

// ============================================================
// STATE MACHINE: Percakapan multi-step untuk /nota
// ============================================================
type NotaStep = 'invoice_no' | 'tanggal' | 'nama' | 'alamat' | 'catatan' | 'items';
interface NotaState {
  step: NotaStep;
  data: {
    noInvoice?: string;
    tanggal?: string;
    namaKepada?: string;
    alamatKepada?: string;
    catatan?: string;
    items: number[];
  };
}
// Map: chatId → state nota yang sedang berlangsung
const notaStates = new Map<number, NotaState>();

// ============================================================
// STATE: Unggah ulang foto nota untuk transaksi tertentu
// ============================================================
interface ReuploadState {
  rowNumber: number;
  bookName: string;
  description: string;
  amount: number;
  date: string;
}
const reuploadStates = new Map<number, ReuploadState>();

function formatRupiah(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Mendaftarkan / memperbarui daftar perintah bot di Telegram
 */
async function syncBotCommands(api: any) {
  try {
    const books = await getAllSheetBooks();
    const baseCommands = [
      { command: 'start', description: 'Panduan & menu utama' },
      { command: 'buat', description: 'Buat catatan/buku kegiatan baru' },
      { command: 'pindahsaldo', description: 'Pindah saldo antar buku/kegiatan' },
      { command: 'rekap', description: 'Rekap buku kegiatan aktif' },
      { command: 'rekapkas', description: 'Rekap seluruh kas & kegiatan' },
      { command: 'cekfoto', description: 'Cek status unggahan foto nota di Drive' },
      { command: 'unggahfoto', description: 'Unggah ulang foto nota transaksi' },
      { command: 'kas', description: 'Beralih ke buku Kas Utama' },
      { command: 'buku', description: 'Daftar & ganti buku kegiatan' },
      { command: 'cekkas', description: 'Cek kas anggota (lunas & belum bayar)' },
      { command: 'bayarkas', description: 'Catat pembayaran kas anggota' },
      { command: 'anggota', description: 'Daftar & kelola anggota kas' },
      { command: 'akses', description: 'Kelola hak akses & anggota bot' },
      { command: 'invite', description: 'Cara undang anggota baru' },
      { command: 'linkuang', description: 'Link website keuangan transparan' },
    ];

    // Tambahkan command untuk buku kegiatan yang valid (hanya huruf, angka, underscore)
    for (const b of books) {
      if (b.toLowerCase() === 'kas') continue;
      const cmd = b.toLowerCase().replace(/[^a-z0-9_]/g, '');
      if (cmd && cmd.length <= 32 && !baseCommands.some((c) => c.command === cmd)) {
        baseCommands.push({ command: cmd, description: `Beralih ke buku ${b}` });
      }
    }

    await api.setMyCommands(baseCommands);
  } catch (err) {
    console.warn('Gagal sync bot commands:', err);
  }
}

// Middleware Keamanan: Kontrol Akses & Sistem Persetujuan Otomatis
bot.use(async (ctx, next) => {
  const updateId = ctx.update.update_id;
  if (processedUpdateIds.has(updateId)) {
    console.warn(`[Dedup] Update ${updateId} sudah diproses, diabaikan.`);
    return;
  }
  processedUpdateIds.add(updateId);
  if (processedUpdateIds.size > MAX_DEDUP_CACHE) {
    const firstItem = processedUpdateIds.values().next().value;
    if (firstItem !== undefined) processedUpdateIds.delete(firstItem);
  }

  // Izinkan callback query persetujuan/pencabutan akses diproses langsung oleh handler
  if (ctx.callbackQuery?.data?.startsWith('user_access:')) {
    await next();
    return;
  }

  const senderId = String(ctx.from?.id);
  const senderName = ctx.from?.first_name || 'Pengguna';
  const username = ctx.from?.username ? `@${ctx.from.username}` : '';

  const accessStatus = await checkUserAccess(senderId);

  if (accessStatus === 'Aktif') {
    await next();
    return;
  }

  if (accessStatus === 'Menunggu') {
    await ctx.reply(
      `⏳ *Permintaan Akses Sedang Menunggu Persetujuan Admin*\n\n` +
        `Halo *${senderName}*, permintaan akses untuk akun Anda (ID: \`${senderId}\`) telah dikirimkan ke Admin.\n` +
        `Mohon ditunggu ya! Begitu Admin menekan tombol izinkan, Anda akan otomatis mendapatkan notifikasi di sini. 😊`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  if (accessStatus === 'Ditolak' || accessStatus === 'Nonaktif') {
    await ctx.reply(
      `⛔ *Akses Tidak Diizinkan*\n\n` +
        `Akun Telegram Anda (ID: \`${senderId}\`) saat ini berstatus *${accessStatus}*.\n` +
        `Silakan hubungi Admin jika Anda memerlukan akses kembali ke bot ini.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Jika status 'Belum_Ada': Daftarkan permintaan baru dan kirim tombol interaktif ke Admin
  try {
    await registerUserRequest(senderId, senderName, ctx.from?.username || '');

    await ctx.reply(
      `⏳ *Permintaan Akses Terkirim!*\n\n` +
        `Halo *${senderName}*! Bot pencatat keuangan ini bersifat privat.\n` +
        `Permintaan akses Anda telah otomatis diteruskan ke Admin untuk disetujui.\n\n` +
        `Mohon ditunggu sebentar ya! Anda akan otomatis menerima notifikasi di sini begitu akses dibuka oleh Admin. 😊\n\n` +
        `🆔 _ID Telegram Anda:_ \`${senderId}\``,
      { parse_mode: 'Markdown' }
    );

    const adminId = getAdminTelegramId();
    const adminKb = new InlineKeyboard()
      .text('✅ Izinkan Akses', `user_access:approve:${senderId}`)
      .text('❌ Tolak', `user_access:reject:${senderId}`);

    const nowJakarta = new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      dateStyle: 'short',
      timeStyle: 'medium',
    }).format(new Date());

    await ctx.api.sendMessage(
      adminId,
      `🔔 *Permintaan Akses Anggota Baru!*\n\n` +
        `Ada pengguna baru yang ingin bergabung dan menggunakan bot:\n` +
        `👤 *Nama:* ${senderName}\n` +
        `🔗 *Username:* ${username || '_(tidak ada)_'}\n` +
        `🆔 *Telegram ID:* \`${senderId}\`\n` +
        `📅 *Waktu:* ${nowJakarta}\n\n` +
        `Apakah Anda ingin mengizinkan pengguna ini untuk mencatat keuangan?`,
      {
        parse_mode: 'Markdown',
        reply_markup: adminKb,
      }
    );
  } catch (err) {
    console.error('Error saat pendaftaran user baru:', err);
    await ctx.reply('Terjadi kendala saat memproses permintaan akses. Silakan coba sesaat lagi.');
  }
});

// Helper: Membangun tombol keyboard buku
async function buildBooksKeyboard(activeBook: string): Promise<InlineKeyboard> {
  const books = await getAllSheetBooks();
  const keyboard = new InlineKeyboard();

  books.forEach((b, idx) => {
    const isCurrent = b.toLowerCase() === activeBook.toLowerCase();
    const label = `${isCurrent ? '📌 ' : '📖 '}${b}${isCurrent ? ' (Aktif)' : ''}`;
    keyboard.text(label, `switch_book:${b}`);
    if ((idx + 1) % 2 === 0) keyboard.row();
  });

  return keyboard;
}

// Command: /start & /help
bot.command(['start', 'help'], async (ctx) => {
  const senderId = ctx.from?.id;
  const chatId = ctx.chat.id;

  const [activeBook, books, isAdmin] = await Promise.all([
    getUserActiveBook(chatId),
    getAllSheetBooks(),
    isUserAdmin(senderId || 0),
  ]);

  // Sync menu command di background
  syncBotCommands(ctx.api).catch(() => {});

  let booksListText = '';
  for (const b of books) {
    const cmd = b.toLowerCase().replace(/[^a-z0-9_]/g, '');
    const isCurrent = b.toLowerCase() === activeBook.toLowerCase();
    booksListText += `• /${cmd} — ${b} ${isCurrent ? '*(Sedang Aktif)*' : ''}\n`;
  }

  const keyboard = await buildBooksKeyboard(activeBook);

  const adminMenuText = isAdmin
    ? `🔐 *Menu Hak Akses & Monitoring (Admin):*\n` +
      `• /akses — Kelola & cabut hak akses anggota bot\n` +
      `• /invite — Panduan mengundang anggota baru\n` +
      `• /izinkan <ID> [Nama] — Izinkan akses anggota manual\n` +
      `• /cabut <ID> — Cabut izin akses anggota\n\n`
    : '';

  await ctx.reply(
    `👋 *Halo! Saya Bot Pencatat Keuangan & Kas Anggota.*\n\n` +
      `📌 *Buku Aktif Saat Ini:* \`${activeBook}\`\n` +
      `_(Semua chat transaksi & struk nota akan dicatat ke buku ini)_\n\n` +
      `⚙️ *Menu Pembukuan & Rekap:*\n` +
      `• /buat — *Buat Catatan/Buku Baru* (tab baru Sheets)\n` +
      `• /pindahsaldo — *Pindah Saldo* (sisa kegiatan ke Kas/lainnya)\n` +
      `• /rekap — *Rekap Buku Aktif* (\`${activeBook}\`)\n` +
      `• /rekapkas — *Rekap Seluruh Kas* (semua kegiatan + kas)\n` +
      `• /cekfoto — *Cek Foto Nota* (status nota & link Google Drive)\n` +
      `• /unggahfoto — *Unggah Ulang Foto* (tambahkan nota ke transaksi lama)\n` +
      `• /kas — Beralih ke Buku *Kas Utama*\n` +
      `• /buku — Daftar & tombol ganti buku\n\n` +
      `👥 *Menu Iuran Kas Anggota:*\n` +
      `• /cekkas — *Cek Pembayaran Kas* (siapa yang lunas & belum)\n` +
      `• /bayarkas — *Catat Bayar Kas Anggota* (otomatis masuk ke Kas)\n` +
      `• /anggota — *Kelola Anggota* (daftar, tambah, nonaktifkan)\n\n` +
      `🌸 *Website Dashboard Keuangan:*\n` +
      `• /linkuang — *Buka Link Web Keuangan* (tampilan pastel & transparan)\n\n` +
      adminMenuText +
      `📚 *Buku Kegiatan Tersedia:*\n` +
      `${booksListText}\n` +
      `💡 *Cara Catat Transaksi Cepat:*\n` +
      `• Kirim teks biasa: \`makan siang 35rb\`, \`beli bensin 50rb\`\n` +
      `• Kirim foto struk/nota belanja: otomatis dibaca AI!\n\n` +
      `🆔 _ID Telegram Anda: \`${senderId}\`_`,
    {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    }
  );
});

// Command: /buat (Membuat kegiatan / buku baru)
bot.command('buat', async (ctx) => {
  const chatId = ctx.chat.id;
  createBookStates.set(chatId, true);
  notaStates.delete(chatId);
  transferStates.delete(chatId);

  await ctx.reply(
    `📝 *Buat Catatan / Buku Kegiatan Baru*\n\n` +
      `Silakan ketik *nama kegiatan* yang ingin dibuat:\n` +
      `_(contoh: \`jojo\`, \`pwd\`, \`gathering\`, \`renovasi\`)_\n\n` +
      `💡 Bot akan otomatis membuatkan halaman (sheet) baru di Google Sheets Anda. Penyimpanan struk tetap terpusat di Google Drive.\n\n` +
      `_(Ketik *batal* jika ingin membatalkan)_`,
    { parse_mode: 'Markdown' }
  );
});

// Command: /kas (Beralih ke buku Kas Utama)
bot.command('kas', async (ctx) => {
  const chatId = ctx.chat.id;
  await setUserActiveBook(chatId, DEFAULT_BOOK_NAME);
  await ctx.reply(
    `📖 *Buku Aktif Diubah:* *Kas Utama*\n\n` +
      `Semua transaksi dan foto nota selanjutnya akan dicatat ke tab *${DEFAULT_BOOK_NAME}*.\n` +
      `Ketik /rekap untuk melihat rekap kas ini.`,
    { parse_mode: 'Markdown' }
  );
});

// Command: /buku (Melihat & memilih buku yang ada)
bot.command('buku', async (ctx) => {
  const chatId = ctx.chat.id;
  const activeBook = await getUserActiveBook(chatId);
  const keyboard = await buildBooksKeyboard(activeBook);

  await ctx.reply(
    `📚 *Pilih Buku / Halaman Kegiatan*\n\n` +
      `📌 *Buku Aktif Saat Ini:* \`${activeBook}\`\n\n` +
      `Silakan klik tombol di bawah untuk berpindah buku:`,
    {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    }
  );
});

// Handler tombol Inline Keyboard (switch_book:nama_buku)
bot.callbackQuery(/^switch_book:(.+)$/, async (ctx) => {
  const targetBook = ctx.match[1];
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  await setUserActiveBook(chatId, targetBook);
  await ctx.answerCallbackQuery({
    text: `Buku aktif diubah ke: ${targetBook}`,
  });

  const keyboard = await buildBooksKeyboard(targetBook);
  try {
    await ctx.editMessageText(
      `✅ *Buku Aktif Berhasil Diubah!*\n\n` +
        `📌 *Buku Saat Ini:* \`${targetBook}\`\n\n` +
        `Semua transaksi teks dan foto nota selanjutnya akan dicatat ke tab *${targetBook}*.\n` +
        `• Ketik /rekap untuk rekap buku ini\n` +
        `• Ketik /rekapkas untuk seluruh rekap kas\n` +
        `• Ketik /kas untuk kembali ke Kas Utama`,
      {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      }
    );
  } catch {
    // Abaikan jika tidak bisa edit pesan
  }
});

// ============================================================
// SISTEM KONTROL AKSES ANGGOTA & MONITORING ADMIN
// ============================================================

// Callback: Persetujuan akses anggota baru oleh Admin
bot.callbackQuery(/^user_access:approve:(.+)$/, async (ctx) => {
  const targetId = ctx.match[1];
  const adminId = String(ctx.from?.id);
  const isAdmin = await isUserAdmin(adminId);

  if (!isAdmin) {
    await ctx.answerCallbackQuery({ text: '⛔ Hanya Admin yang dapat menyetujui akses!', show_alert: true });
    return;
  }

  try {
    await approveUser(targetId);
    await ctx.answerCallbackQuery({ text: '✅ Akses anggota berhasil disetujui!' });

    const targetUser = await getUserRecord(targetId);
    const targetName = targetUser?.name || 'Anggota';
    const targetUname = targetUser?.username ? `@${targetUser.username}` : '';

    try {
      await ctx.editMessageText(
        `✅ *Akses Berhasil Disetujui!*\n\n` +
          `👤 *Nama:* ${targetName} ${targetUname}\n` +
          `🆔 *Telegram ID:* \`${targetId}\`\n` +
          `Status: *Aktif (Member)*\n\n` +
          `Pengguna sekarang dapat menggunakan bot untuk mencatat transaksi dan aktivitasnya akan dipantau di chat ini.`,
        { parse_mode: 'Markdown' }
      );
    } catch {}

    // Kirim notifikasi ke anggota yang disetujui
    await ctx.api.sendMessage(
      targetId,
      `🎉 *Selamat! Akses Anda Telah Disetujui Admin!* 🚀\n\n` +
        `Halo *${targetName}*, sekarang Anda sudah dapat menggunakan bot ini untuk mencatat keuangan & kas.\n\n` +
        `💡 *Cara Cepat Mencatat:*\n` +
        `• Kirim teks biasa: \`makan siang 35rb\`, \`beli bensin 50rb\`\n` +
        `• Kirim foto struk/nota belanja: otomatis dibaca AI!\n` +
        `• Ketik /start untuk melihat menu buku kas dan fitur lainnya.`,
      { parse_mode: 'Markdown' }
    ).catch(console.error);
  } catch (error: any) {
    console.error('Error approving user:', error);
    await ctx.answerCallbackQuery({ text: `Gagal: ${error?.message || 'Error internal'}`, show_alert: true });
  }
});

// Callback: Penolakan akses oleh Admin
bot.callbackQuery(/^user_access:reject:(.+)$/, async (ctx) => {
  const targetId = ctx.match[1];
  const adminId = String(ctx.from?.id);
  const isAdmin = await isUserAdmin(adminId);

  if (!isAdmin) {
    await ctx.answerCallbackQuery({ text: '⛔ Hanya Admin yang dapat menolak akses!', show_alert: true });
    return;
  }

  try {
    await rejectUser(targetId);
    await ctx.answerCallbackQuery({ text: '❌ Permintaan akses ditolak.' });

    const targetUser = await getUserRecord(targetId);
    const targetName = targetUser?.name || 'Pengguna';

    try {
      await ctx.editMessageText(
        `❌ *Permintaan Akses Ditolak*\n\n` +
          `👤 *Nama:* ${targetName}\n` +
          `🆔 *Telegram ID:* \`${targetId}\`\n` +
          `Status: *Ditolak*`,
        { parse_mode: 'Markdown' }
      );
    } catch {}

    await ctx.api.sendMessage(
      targetId,
      `Mohon maaf, permintaan akses Anda ke bot pencatat keuangan ini belum disetujui oleh Admin.`,
      { parse_mode: 'Markdown' }
    ).catch(console.error);
  } catch (error: any) {
    console.error('Error rejecting user:', error);
    await ctx.answerCallbackQuery({ text: `Gagal: ${error?.message || 'Error internal'}`, show_alert: true });
  }
});

// Callback: Pencabutan akses anggota
bot.callbackQuery(/^user_access:revoke:(.+)$/, async (ctx) => {
  const targetId = ctx.match[1];
  const adminId = String(ctx.from?.id);
  const isAdmin = await isUserAdmin(adminId);

  if (!isAdmin) {
    await ctx.answerCallbackQuery({ text: '⛔ Hanya Admin yang dapat mencabut akses!', show_alert: true });
    return;
  }

  try {
    await revokeUser(targetId);
    await ctx.answerCallbackQuery({ text: `Akses ID ${targetId} berhasil dicabut.` });

    try {
      await ctx.editMessageText(
        `🚫 *Akses Berhasil Dicabut*\n\n` +
          `Pengguna ID \`${targetId}\` telah dinonaktifkan dari akses bot.`,
        { parse_mode: 'Markdown' }
      );
    } catch {}

    await ctx.api.sendMessage(
      targetId,
      `⚠️ *Pemberitahuan:*\nAkses akun Telegram Anda ke bot pencatat keuangan telah dinonaktifkan oleh Admin.`,
      { parse_mode: 'Markdown' }
    ).catch(console.error);
  } catch (error: any) {
    console.error('Error revoking user:', error);
    await ctx.answerCallbackQuery({ text: `Gagal: ${error?.message || 'Error internal'}`, show_alert: true });
  }
});

// Command: /akses (Kelola akses anggota bot)
bot.command(['akses', 'aksesbot', 'kelolaakses'], async (ctx) => {
  const senderId = String(ctx.from?.id);
  const isAdmin = await isUserAdmin(senderId);
  if (!isAdmin) {
    await ctx.reply('⛔ Fitur ini hanya dapat diakses oleh Admin.');
    return;
  }

  await ctx.replyWithChatAction('typing');
  const users = await getAllUsers(true);
  const adminId = getAdminTelegramId();

  let text = `🔐 *Kelola Hak Akses Anggota Bot*\n\n` +
    `👑 *Admin / Pemilik:*\n` +
    `• ID: \`${adminId}\`\n\n`;

  const activeMembers = users.filter((u) => u.id !== adminId && u.status === 'Aktif');
  const pendingMembers = users.filter((u) => u.status === 'Menunggu');
  const inactiveMembers = users.filter((u) => u.id !== adminId && (u.status === 'Nonaktif' || u.status === 'Ditolak'));

  const keyboard = new InlineKeyboard();

  if (activeMembers.length > 0) {
    text += `👥 *Anggota Aktif (${activeMembers.length}):*\n`;
    activeMembers.forEach((u, i) => {
      text += `${i + 1}. *${u.name}* ${u.username ? `(@${u.username})` : ''} — \`${u.id}\`\n`;
      keyboard.text(`❌ Cabut: ${u.name.slice(0, 15)}`, `user_access:revoke:${u.id}`).row();
    });
    text += `\n`;
  } else {
    text += `👥 *Anggota Aktif:* _(Belum ada anggota luar yang diizinkan)_\n\n`;
  }

  if (pendingMembers.length > 0) {
    text += `⏳ *Menunggu Persetujuan (${pendingMembers.length}):*\n`;
    pendingMembers.forEach((u, i) => {
      text += `${i + 1}. *${u.name}* ${u.username ? `(@${u.username})` : ''} — \`${u.id}\`\n`;
      keyboard.text(`✅ Izinkan ${u.name.slice(0, 10)}`, `user_access:approve:${u.id}`)
        .text(`❌ Tolak`, `user_access:reject:${u.id}`).row();
    });
    text += `\n`;
  }

  if (inactiveMembers.length > 0) {
    text += `🚫 *Nonaktif / Ditolak (${inactiveMembers.length}):*\n`;
    inactiveMembers.forEach((u, i) => {
      text += `${i + 1}. ${u.name} — \`${u.id}\` (${u.status})\n`;
      keyboard.text(`🔄 Pulihkan ${u.name.slice(0, 10)}`, `user_access:approve:${u.id}`).row();
    });
    text += `\n`;
  }

  text += `💡 *Perintah Cepat Admin:*\n` +
    `• Ketik /invite untuk petunjuk mengundang teman\n` +
    `• Ketik \`/izinkan <ID> [Nama]\` untuk izinkan langsung\n` +
    `• Ketik \`/cabut <ID>\` untuk cabut akses manual`;

  await ctx.reply(text, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
});

// Command: /invite (Petunjuk undang anggota baru)
bot.command(['invite', 'undang'], async (ctx) => {
  const senderId = String(ctx.from?.id);
  const isAdmin = await isUserAdmin(senderId);
  if (!isAdmin) {
    await ctx.reply('⛔ Fitur ini hanya dapat diakses oleh Admin.');
    return;
  }

  let botUsername = '';
  try {
    const me = await ctx.api.getMe();
    botUsername = me.username || '';
  } catch {}

  const link = botUsername ? `https://t.me/${botUsername}` : 'username bot ini';

  await ctx.reply(
    `📩 *Cara Mengundang Anggota Baru:*\n\n` +
      `1. *Bagikan Link Bot:*\n` +
      `   Kirim link bot ini ke rekan Anda:\n` +
      `   👉 ${link}\n\n` +
      `2. *Teman Menekan Tombol /start:*\n` +
      `   Minta teman Anda untuk membuka bot tersebut dan klik tombol *Start*.\n\n` +
      `3. *Persetujuan Realtime (Interactive):*\n` +
      `   Bot akan otomatis mengirim pesan konfirmasi ke chat Anda ini berisi tombol:\n` +
      `   [ ✅ *Izinkan Akses* ] dan [ ❌ *Tolak* ]\n\n` +
      `4. *Otomatis Terhubung & Dipantau:*\n` +
      `   Setelah Anda klik *Izinkan*, teman Anda langsung bisa mencatat keuangan dan *setiap kali mereka mencatat transaksi / upload nota, Anda akan langsung menerima laporan realtime di sini!*\n\n` +
      `💡 *Atau izinkan langsung tanpa menunggu mereka chat:*\n` +
      `Ketik: \`/izinkan <ID_Telegram> [Nama]\`\n` +
      `Contoh: \`/izinkan 12345678 Sulis\``,
    { parse_mode: 'Markdown', link_preview_options: { is_disabled: true } }
  );
});

// Command: /izinkan
bot.command(['izinkan', 'approve'], async (ctx) => {
  const senderId = String(ctx.from?.id);
  const isAdmin = await isUserAdmin(senderId);
  if (!isAdmin) {
    await ctx.reply('⛔ Fitur ini hanya dapat diakses oleh Admin.');
    return;
  }

  const text = ctx.message?.text || '';
  const parts = text.split(' ').slice(1);
  const targetId = parts[0]?.trim();
  const targetName = parts.slice(1).join(' ').trim() || 'Anggota';

  if (!targetId || !/^\d+$/.test(targetId)) {
    await ctx.reply(
      `💡 *Format Perintah:*\n\`/izinkan <ID_Telegram> [Nama]\`\n\nContoh: \`/izinkan 12345678 Sulis\``,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  try {
    await approveUser(targetId, targetName);
    await ctx.reply(
      `✅ *Berhasil!* Pengguna *${targetName}* (\`${targetId}\`) telah diberikan izin akses ke bot.`,
      { parse_mode: 'Markdown' }
    );

    await ctx.api.sendMessage(
      targetId,
      `🎉 *Selamat! Akun Anda telah diizinkan oleh Admin.* Sekarang Anda dapat menggunakan bot ini untuk mencatat keuangan.\nKetik /start untuk memulai.`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  } catch (err: any) {
    await ctx.reply(`❌ Gagal memberikan izin: ${err?.message || 'Error internal'}`);
  }
});

// Command: /cabut
bot.command(['cabut', 'revoke'], async (ctx) => {
  const senderId = String(ctx.from?.id);
  const isAdmin = await isUserAdmin(senderId);
  if (!isAdmin) {
    await ctx.reply('⛔ Fitur ini hanya dapat diakses oleh Admin.');
    return;
  }

  const text = ctx.message?.text || '';
  const parts = text.split(' ').slice(1);
  const targetId = parts[0]?.trim();

  if (!targetId || !/^\d+$/.test(targetId)) {
    await ctx.reply(
      `💡 *Format Perintah:*\n\`/cabut <ID_Telegram>\`\n\nContoh: \`/cabut 12345678\``,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  try {
    const success = await revokeUser(targetId);
    if (success) {
      await ctx.reply(`🚫 *Akses Berhasil Dicabut:* ID \`${targetId}\` tidak lagi dapat menggunakan bot ini.`, {
        parse_mode: 'Markdown',
      });
      await ctx.api.sendMessage(
        targetId,
        `⚠️ *Pemberitahuan:*\nAkses Anda ke bot pencatat keuangan ini telah dicabut oleh Admin.`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    } else {
      await ctx.reply(`⚠️ ID Telegram \`${targetId}\` tidak ditemukan dalam daftar anggota.`);
    }
  } catch (err: any) {
    await ctx.reply(`❌ Gagal mencabut akses: ${err?.message || 'Error internal'}`);
  }
});

// Command: /linkuang (Link website keuangan transparan)
bot.command(['linkuang', 'linkweb', 'dashboard', 'website'], async (ctx) => {
  const webUrl = 'https://bot-tele-topaz.vercel.app';
  const keyboard = new InlineKeyboard().url('🌸 Buka Website Keuangan', webUrl);

  await ctx.reply(
    `🌸 *Website Catatan Keuangan Transparan*\n\n` +
      `Sekarang seluruh panitia & anggota dapat melihat laporan saldo kas, rincian pengeluaran tiap kegiatan, dan bukti struk nota secara asik, rapi, dan mudah dipahami:\n\n` +
      `👉 [${webUrl}](${webUrl})\n\n` +
      `💡 *Catatan:* Menulis pemasukan/pengeluaran & upload foto nota tetap dilakukan lewat chat bot ini ya! Website tersebut berfungsi khusus untuk melihat & memantau laporan secara terbuka. ✨`,
    {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
      link_preview_options: { is_disabled: false },
    }
  );
});

// ============================================================
// LOGIKA & HANDLER PINDAH SALDO ANTAR BUKU / KEGIATAN
// ============================================================

// Helper: Parse nominal uang dari teks fleksibel (misal: 50000, 50rb, 50k, 1.5jt, Rp 250.000)
function parseNominalInput(text: string): number | null {
  const clean = text.trim().toLowerCase().replace(/^rp\.?\s*/i, '').trim();
  const rbMatch = clean.match(/^([\d.,]+)\s*(rb|ribu|k)$/i);
  if (rbMatch) {
    const num = parseFloat(rbMatch[1].replace(/\./g, '').replace(/,/g, '.'));
    return isNaN(num) ? null : Math.round(num * 1000);
  }
  const jtMatch = clean.match(/^([\d.,]+)\s*(jt|juta|m)$/i);
  if (jtMatch) {
    const num = parseFloat(jtMatch[1].replace(/\./g, '').replace(/,/g, '.'));
    return isNaN(num) ? null : Math.round(num * 1000000);
  }
  const plain = clean.replace(/\./g, '').replace(/,/g, '');
  if (/^\d+$/.test(plain)) {
    const num = parseInt(plain, 10);
    return isNaN(num) ? null : num;
  }
  return null;
}

function buildTransferSourceKeyboard(books: { bookName: string; saldo: number }[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  books.forEach((b, idx) => {
    const isPositive = b.saldo > 0;
    const icon = isPositive ? '💰' : '⚪';
    const label = `${icon} ${b.bookName} (${formatRupiah(b.saldo)})`;
    keyboard.text(label, `ps_src:${idx}`);
    keyboard.row();
  });
  keyboard.text('❌ Batal', 'ps_cancel');
  return keyboard;
}

function buildTransferTargetKeyboard(
  books: { bookName: string; saldo: number }[],
  sourceBook: string
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const targetBooks = books.filter((b) => b.bookName.toLowerCase() !== sourceBook.toLowerCase());
  targetBooks.forEach((b) => {
    const isKas = b.bookName.toLowerCase() === DEFAULT_BOOK_NAME.toLowerCase();
    const icon = isKas ? '📌' : '📖';
    const label = `${icon} ${b.bookName} (Saldo: ${formatRupiah(b.saldo)})`;
    const origIdx = books.findIndex((x) => x.bookName.toLowerCase() === b.bookName.toLowerCase());
    keyboard.text(label, `ps_dst:${origIdx}`);
    keyboard.row();
  });
  keyboard.text('🔙 Kembali', 'ps_back_src').text('❌ Batal', 'ps_cancel');
  return keyboard;
}

function buildTransferAmountKeyboard(sourceBalance: number): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  keyboard.text(`⚡ Pindah Semua (${formatRupiah(sourceBalance)})`, 'ps_amt:all').row();
  keyboard.text('✏️ Masukkan Nominal Tertentu', 'ps_amt:custom').row();
  keyboard.text('🔙 Kembali', 'ps_back_dst').text('❌ Batal', 'ps_cancel');
  return keyboard;
}

function buildTransferConfirmKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  keyboard.text('✅ Ya, Pindahkan Sekarang', 'ps_exec').row();
  keyboard.text('❌ Batal', 'ps_cancel');
  return keyboard;
}

async function handleStartPindahSaldo(ctx: any, argsText: string = '') {
  const chatId = ctx.chat.id;
  await ctx.replyWithChatAction('typing');

  createBookStates.delete(chatId);
  notaStates.delete(chatId);
  transferStates.delete(chatId);

  const summary = await getAllSheetsSummary();
  const books = summary.books.map((b) => ({ bookName: b.bookName, saldo: b.saldo }));

  if (books.length < 2) {
    await ctx.reply(
      '⚠️ *Tidak Ada Buku Lain*\n\n' +
        'Fitur pindah saldo membutuhkan minimal 2 buku/kegiatan. Buat kegiatan baru dengan /buat terlebih dahulu.',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const cleanArgs = argsText.trim();
  if (cleanArgs) {
    // Mode command cepat: /pindahsaldo [asal] [ke?] [tujuan] [nominal?]
    // contoh: /pindahsaldo jojo kas 50000 atau /pindahsaldo jojo ke kas
    const tokens = cleanArgs.split(/\s+/).filter((t) => t.toLowerCase() !== 'ke');
    if (tokens.length >= 2) {
      const srcQuery = tokens[0].toLowerCase();
      const dstQuery = tokens[1].toLowerCase();
      const nominalStr = tokens.slice(2).join(' ').trim();

      const matchedSrc = books.find(
        (b) =>
          b.bookName.toLowerCase() === srcQuery ||
          b.bookName.toLowerCase().replace(/[^a-z0-9_]/g, '') === srcQuery
      );
      const matchedDst = books.find(
        (b) =>
          b.bookName.toLowerCase() === dstQuery ||
          b.bookName.toLowerCase().replace(/[^a-z0-9_]/g, '') === dstQuery
      );

      if (matchedSrc && matchedDst) {
        if (matchedSrc.bookName.toLowerCase() === matchedDst.bookName.toLowerCase()) {
          await ctx.reply('⚠️ Buku asal dan buku tujuan tidak boleh sama.');
          return;
        }

        if (matchedSrc.saldo <= 0) {
          await ctx.reply(
            `⚠️ Buku *${matchedSrc.bookName}* tidak memiliki sisa saldo (Saldo: ${formatRupiah(matchedSrc.saldo)}). Tidak ada saldo yang dapat dipindahkan.`,
            { parse_mode: 'Markdown' }
          );
          return;
        }

        let amount = matchedSrc.saldo;
        if (nominalStr) {
          const parsedNominal = parseNominalInput(nominalStr);
          if (!parsedNominal || parsedNominal <= 0) {
            await ctx.reply('⚠️ Format nominal tidak valid. Contoh: `/pindahsaldo jojo kas 50000`', {
              parse_mode: 'Markdown',
            });
            return;
          }
          if (parsedNominal > matchedSrc.saldo) {
            await ctx.reply(
              `⚠️ Saldo buku *${matchedSrc.bookName}* hanya tersisa ${formatRupiah(matchedSrc.saldo)}. Nominal ${formatRupiah(parsedNominal)} melebihi saldo tersedia.`,
              { parse_mode: 'Markdown' }
            );
            return;
          }
          amount = parsedNominal;
        }

        transferStates.set(chatId, {
          step: 'confirm',
          books,
          sourceBook: matchedSrc.bookName,
          sourceBalance: matchedSrc.saldo,
          targetBook: matchedDst.bookName,
          amount,
        });

        const isAll = amount === matchedSrc.saldo;
        await ctx.reply(
          `⚠️ *Konfirmasi Pemindahan Saldo*\n\n` +
            `📤 *Dari:* \`${matchedSrc.bookName}\`\n` +
            `📥 *Ke:* \`${matchedDst.bookName}\`\n` +
            `💰 *Nominal:* *${formatRupiah(amount)}* ${isAll ? '_(Semua Saldo)_' : ''}\n\n` +
            `ℹ️ _Saldo di buku \`${matchedSrc.bookName}\` setelah ini akan menjadi *${formatRupiah(matchedSrc.saldo - amount)}*._\n\n` +
            `Apakah Anda yakin ingin memindahkan saldo ini?`,
          {
            parse_mode: 'Markdown',
            reply_markup: buildTransferConfirmKeyboard(),
          }
        );
        return;
      }
    }
  }

  // Tampilkan pilihan buku asal
  transferStates.set(chatId, {
    step: 'select_source',
    books,
  });

  const keyboard = buildTransferSourceKeyboard(books);
  await ctx.reply(
    `🔄 *Pindah Saldo Antar Buku / Kegiatan*\n\n` +
      `Fitur ini untuk memindahkan sisa anggaran/saldo dari kegiatan yang sudah selesai ke *Kas Utama* atau buku kegiatan lainnya.\n\n` +
      `Silakan pilih *Buku Asal* (sumber dana yang ingin dipindahkan):`,
    {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    }
  );
}

// Callback: Pilih buku asal pindah saldo
bot.callbackQuery(/^ps_src:(\d+)$/, async (ctx) => {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const idx = parseInt(ctx.match[1], 10);
  const state = transferStates.get(chatId);
  if (!state || !state.books || !state.books[idx]) {
    await ctx.answerCallbackQuery({ text: 'Sesi telah kedaluwarsa. Silakan ketik /pindahsaldo kembali.', show_alert: true });
    return;
  }

  const source = state.books[idx];
  if (source.saldo <= 0) {
    await ctx.answerCallbackQuery({
      text: `Buku "${source.bookName}" tidak memiliki saldo (${formatRupiah(source.saldo)}). Silakan pilih buku lain.`,
      show_alert: true,
    });
    return;
  }

  state.step = 'select_target';
  state.sourceBook = source.bookName;
  state.sourceBalance = source.saldo;

  await ctx.answerCallbackQuery();
  const keyboard = buildTransferTargetKeyboard(state.books, source.bookName);

  try {
    await ctx.editMessageText(
      `🔄 *Pindah Saldo Antar Buku*\n\n` +
        `📤 *Buku Asal:* \`${source.bookName}\`\n` +
        `💰 *Sisa Saldo:* *${formatRupiah(source.saldo)}*\n\n` +
        `Silakan pilih *Buku Tujuan* (kemana saldo akan dipindahkan):`,
      {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      }
    );
  } catch {}
});

// Callback: Pilih buku tujuan pindah saldo
bot.callbackQuery(/^ps_dst:(\d+)$/, async (ctx) => {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const idx = parseInt(ctx.match[1], 10);
  const state = transferStates.get(chatId);
  if (!state || !state.books || !state.books[idx] || state.sourceBalance === undefined) {
    await ctx.answerCallbackQuery({ text: 'Sesi telah kedaluwarsa. Silakan ketik /pindahsaldo kembali.', show_alert: true });
    return;
  }

  const target = state.books[idx];
  state.step = 'select_amount';
  state.targetBook = target.bookName;

  await ctx.answerCallbackQuery();
  const keyboard = buildTransferAmountKeyboard(state.sourceBalance);

  try {
    await ctx.editMessageText(
      `🔄 *Pindah Saldo Antar Buku*\n\n` +
        `📤 *Buku Asal:* \`${state.sourceBook}\`\n` +
        `📥 *Buku Tujuan:* \`${state.targetBook}\`\n` +
        `💰 *Sisa Saldo Tersedia:* *${formatRupiah(state.sourceBalance)}*\n\n` +
        `Berapa saldo yang ingin dipindahkan ke \`${state.targetBook}\`?`,
      {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      }
    );
  } catch {}
});

// Callback: Pilihan nominal pindah saldo (semua / nominal tertentu)
bot.callbackQuery(/^ps_amt:(all|custom)$/, async (ctx) => {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const mode = ctx.match[1];
  const state = transferStates.get(chatId);
  if (!state || !state.sourceBook || !state.targetBook || state.sourceBalance === undefined) {
    await ctx.answerCallbackQuery({ text: 'Sesi telah kedaluwarsa. Silakan ketik /pindahsaldo kembali.', show_alert: true });
    return;
  }

  if (mode === 'all') {
    state.amount = state.sourceBalance;
    state.step = 'confirm';

    await ctx.answerCallbackQuery();
    const keyboard = buildTransferConfirmKeyboard();

    try {
      await ctx.editMessageText(
        `⚠️ *Konfirmasi Pemindahan Seluruh Saldo*\n\n` +
          `Apakah Anda yakin ingin memindahkan seluruh sisa saldo?\n\n` +
          `📤 *Dari:* \`${state.sourceBook}\`\n` +
          `📥 *Ke:* \`${state.targetBook}\`\n` +
          `💰 *Nominal:* *${formatRupiah(state.amount)}* _(100% Saldo)_\n\n` +
          `ℹ️ _Saldo di buku \`${state.sourceBook}\` akan menjadi *Rp 0* setelah proses ini._`,
        {
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        }
      );
    } catch {}
  } else {
    state.step = 'input_amount';
    await ctx.answerCallbackQuery();

    const cancelKeyboard = new InlineKeyboard().text('❌ Batal', 'ps_cancel');
    try {
      await ctx.editMessageText(
        `✏️ *Masukkan Nominal Saldo*\n\n` +
          `📤 *Buku Asal:* \`${state.sourceBook}\` (Sisa: ${formatRupiah(state.sourceBalance)})\n` +
          `📥 *Buku Tujuan:* \`${state.targetBook}\`\n\n` +
          `Silakan ketik nominal yang ingin dipindahkan di chat:\n` +
          `_(Contoh: \`50000\`, \`75rb\`, atau \`100.000\`)_\n\n` +
          `_Ketik *batal* jika ingin membatalkan._`,
        {
          parse_mode: 'Markdown',
          reply_markup: cancelKeyboard,
        }
      );
    } catch {}
  }
});

// Callback: Kembali ke pilihan buku asal
bot.callbackQuery('ps_back_src', async (ctx) => {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const state = transferStates.get(chatId);
  if (!state || !state.books) return;

  state.step = 'select_source';
  await ctx.answerCallbackQuery();
  const keyboard = buildTransferSourceKeyboard(state.books);

  try {
    await ctx.editMessageText(
      `🔄 *Pindah Saldo Antar Buku / Kegiatan*\n\n` +
        `Silakan pilih *Buku Asal* (sumber dana yang ingin dipindahkan):`,
      {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      }
    );
  } catch {}
});

// Callback: Kembali ke pilihan buku tujuan
bot.callbackQuery('ps_back_dst', async (ctx) => {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const state = transferStates.get(chatId);
  if (!state || !state.books || !state.sourceBook || state.sourceBalance === undefined) return;

  state.step = 'select_target';
  await ctx.answerCallbackQuery();
  const keyboard = buildTransferTargetKeyboard(state.books, state.sourceBook);

  try {
    await ctx.editMessageText(
      `🔄 *Pindah Saldo Antar Buku*\n\n` +
        `📤 *Buku Asal:* \`${state.sourceBook}\`\n` +
        `💰 *Sisa Saldo:* *${formatRupiah(state.sourceBalance)}*\n\n` +
        `Silakan pilih *Buku Tujuan* (kemana saldo akan dipindahkan):`,
      {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      }
    );
  } catch {}
});

// Callback: Batalkan pindah saldo
bot.callbackQuery('ps_cancel', async (ctx) => {
  const chatId = ctx.chat?.id;
  if (chatId) transferStates.delete(chatId);

  await ctx.answerCallbackQuery({ text: 'Pemindahan saldo dibatalkan.' });
  try {
    await ctx.editMessageText('❌ *Pemindahan saldo dibatalkan.*', { parse_mode: 'Markdown' });
  } catch {}
});

// Callback: Eksekusi pindah saldo
bot.callbackQuery('ps_exec', async (ctx) => {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const state = transferStates.get(chatId);
  if (!state || !state.sourceBook || !state.targetBook || !state.amount) {
    await ctx.answerCallbackQuery({ text: 'Sesi telah kedaluwarsa. Silakan ketik /pindahsaldo kembali.', show_alert: true });
    return;
  }

  await ctx.answerCallbackQuery({ text: 'Memproses pindah saldo...' });
  try {
    await ctx.editMessageText('⏳ _Sedang memproses pemindahan saldo di Google Sheets..._', {
      parse_mode: 'Markdown',
    });
  } catch {}

  try {
    const result = await transferBookBalance({
      sourceBook: state.sourceBook,
      targetBook: state.targetBook,
      amount: state.amount,
    });

    transferStates.delete(chatId);

    await ctx.editMessageText(
      `🎉 *Pindah Saldo Berhasil!*\n\n` +
        `📤 *Buku Asal:* \`${result.sourceBook}\`\n` +
        `• Saldo Sebelumnya: ${formatRupiah(result.sourceBalanceBefore)}\n` +
        `• Saldo Sekarang: *${formatRupiah(result.sourceBalanceAfter)}*\n\n` +
        `📥 *Buku Tujuan:* \`${result.targetBook}\`\n` +
        `• Saldo Sebelumnya: ${formatRupiah(result.targetBalanceBefore)}\n` +
        `• Saldo Sekarang: *${formatRupiah(result.targetBalanceAfter)}*\n\n` +
        `💰 *Nominal Dipindahkan:* *${formatRupiah(result.amount)}*\n` +
        `📅 *Tanggal:* ${result.date}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n` +
        `✅ Dicatat sebagai *Pengeluaran* di \`${result.sourceBook}\`\n` +
        `✅ Dicatat sebagai *Pemasukan* di \`${result.targetBook}\``,
      { parse_mode: 'Markdown' }
    );
  } catch (err: any) {
    console.error('Error saat transfer saldo:', err);
    try {
      await ctx.editMessageText(`❌ *Gagal memindahkan saldo:* ${err.message}`, {
        parse_mode: 'Markdown',
      });
    } catch {
      await ctx.reply(`❌ *Gagal memindahkan saldo:* ${err.message}`, { parse_mode: 'Markdown' });
    }
  }
});

// Command: /debug
bot.command('debug', async (ctx) => {
  const rawKey = process.env.GOOGLE_PRIVATE_KEY || '';
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
  const sheetId = process.env.GOOGLE_SHEET_ID || '';
  const formatted = formatPrivateKey(rawKey);

  let jwtStatus = 'Testing...';
  let booksList: string[] = [];
  try {
    booksList = await getAllSheetBooks(true);
    jwtStatus = `✅ Sukses! Buku terdeteksi: ${booksList.join(', ')}`;
  } catch (err: any) {
    jwtStatus = `❌ Gagal: ${err.message}`;
  }

  const msg =
    `🛠️ *Laporan Diagnostik Bot*\n\n` +
    `📧 *Service Account:* \`${email || 'KOSONG'}\`\n` +
    `📊 *Sheet ID:* \`${sheetId || 'KOSONG'}\`\n` +
    `🔑 *Key Length:* ${formatted.length} karakter\n\n` +
    `📋 *Status Google Sheets:* ${jwtStatus}`;

  await ctx.reply(msg, { parse_mode: 'Markdown' });
});

// Helper: Parse parameter bulan dari teks pengguna
function parseMonthQuery(queryText: string): { yearMonth: string; label: string } | null {
  const clean = queryText.trim().toLowerCase();
  if (!clean) return null;

  const currentYear = new Date().getFullYear();

  const monthMap: Record<string, { code: string; name: string }> = {
    januari: { code: '01', name: 'Januari' },
    jan: { code: '01', name: 'Januari' },
    februari: { code: '02', name: 'Februari' },
    feb: { code: '02', name: 'Februari' },
    maret: { code: '03', name: 'Maret' },
    mar: { code: '03', name: 'Maret' },
    april: { code: '04', name: 'April' },
    apr: { code: '04', name: 'April' },
    mei: { code: '05', name: 'Mei' },
    may: { code: '05', name: 'Mei' },
    juni: { code: '06', name: 'Juni' },
    jun: { code: '06', name: 'Juni' },
    juli: { code: '07', name: 'Juli' },
    jul: { code: '07', name: 'Juli' },
    agustus: { code: '08', name: 'Agustus' },
    agu: { code: '08', name: 'Agustus' },
    agt: { code: '08', name: 'Agustus' },
    aug: { code: '08', name: 'Agustus' },
    september: { code: '09', name: 'September' },
    sep: { code: '09', name: 'September' },
    oktober: { code: '10', name: 'Oktober' },
    okt: { code: '10', name: 'Oktober' },
    oct: { code: '10', name: 'Oktober' },
    november: { code: '11', name: 'November' },
    nov: { code: '11', name: 'November' },
    desember: { code: '12', name: 'Desember' },
    des: { code: '12', name: 'Desember' },
    dec: { code: '12', name: 'Desember' },
  };

  const isoMatch = clean.match(/^(\d{4})-(\d{1,2})$/);
  if (isoMatch) {
    const y = isoMatch[1];
    const m = isoMatch[2].padStart(2, '0');
    const foundEntry = Object.values(monthMap).find((v) => v.code === m);
    const mName = foundEntry ? foundEntry.name : `Bulan ${m}`;
    return { yearMonth: `${y}-${m}`, label: `${mName} ${y}` };
  }

  const yearMatch = clean.match(/\b(20\d\d)\b/);
  const year = yearMatch ? yearMatch[1] : String(currentYear);

  const numMatch = clean.match(/\b([1-9]|1[0-2])\b/);
  if (numMatch && !clean.includes('-')) {
    const m = numMatch[1].padStart(2, '0');
    const foundEntry = Object.values(monthMap).find((v) => v.code === m);
    const mName = foundEntry ? foundEntry.name : `Bulan ${m}`;
    return { yearMonth: `${year}-${m}`, label: `${mName} ${year}` };
  }

  for (const [key, val] of Object.entries(monthMap)) {
    if (clean.includes(key)) {
      return { yearMonth: `${year}-${val.code}`, label: `${val.name} ${year}` };
    }
  }

  return null;
}

// Helper format tanggal Indonesia
function formatIndonesianDate(isoDate: string): string {
  const clean = String(isoDate).trim().replace(/^'/, '');
  const match = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return clean;
  const [, y, m, d] = match;
  const namaBulan: Record<string, string> = {
    '01': 'Januari',
    '02': 'Februari',
    '03': 'Maret',
    '04': 'April',
    '05': 'Mei',
    '06': 'Juni',
    '07': 'Juli',
    '08': 'Agustus',
    '09': 'September',
    '10': 'Oktober',
    '11': 'November',
    '12': 'Desember',
  };
  const bulan = namaBulan[m] || m;
  return `${parseInt(d, 10)} ${bulan} ${y}`;
}

function escapeTelegramMarkdown(text: string): string {
  return String(text || '').replace(/[_*[\]`\\]/g, '\\$&');
}

// Helper: Buat blok daftar transaksi per tanggal
function buildTransactionDateBlocks(items: ExpenseDetail[], defaultType: string): string[] {
  const blocks: string[] = [];
  if (!items || items.length === 0) return blocks;

  const grouped: Record<string, ExpenseDetail[]> = {};
  for (const it of items) {
    const d = it.date || 'Lainnya';
    if (!grouped[d]) grouped[d] = [];
    grouped[d].push(it);
  }

  const sortedDates = Object.keys(grouped).sort((a, b) => a.localeCompare(b));

  for (const d of sortedDates) {
    const list = grouped[d];
    const subtotal = list.reduce((sum, item) => sum + item.nominal, 0);
    const tglFormatted = formatIndonesianDate(d);

    let block = `🗓️ *${tglFormatted}*`;
    if (list.length > 1) {
      block += ` _(Total: ${formatRupiah(subtotal)})_`;
    }
    block += `\n`;

    for (const item of list) {
      const desc = item.description && item.description !== '-' ? escapeTelegramMarkdown(item.description) : '';
      const cat = escapeTelegramMarkdown(item.category);
      const nominal = formatRupiah(item.nominal);

      if (desc && desc.toLowerCase() !== cat.toLowerCase()) {
        block += ` • ${desc} _(${cat})_: ${nominal}\n`;
      } else {
        block += ` • ${cat || defaultType}: ${nominal}\n`;
      }
    }
    blocks.push(block.trimEnd());
  }

  return blocks;
}

// Helper: Mengirim pesan rekap buku kegiatan aktif
async function sendRekap(ctx: any, queryText: string = '') {
  try {
    await ctx.replyWithChatAction('typing');

    const chatId = ctx.chat.id;
    const activeBook = await getUserActiveBook(chatId);
    const monthInfo = parseMonthQuery(queryText);

    const summary = await getMonthSummary(
      monthInfo?.yearMonth,
      monthInfo?.label,
      activeBook
    );

    const isKas = activeBook.toLowerCase() === DEFAULT_BOOK_NAME.toLowerCase();
    const judulBuku = isKas ? 'Kas Utama' : `Kegiatan "${activeBook}"`;

    let headerMsg = `📊 *Rekap Transaksi — ${judulBuku}*\n`;
    headerMsg += `🗓️ *Periode:* ${summary.periodeLabel}\n\n`;
    headerMsg += `🟢 *Pemasukan:* ${formatRupiah(summary.totalPemasukan)}\n`;
    headerMsg += `🔴 *Pengeluaran:* ${formatRupiah(summary.totalPengeluaran)}\n`;
    headerMsg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    const selisihLabel = summary.saldo >= 0 ? '💰 *Sisa Uang (Surplus):*' : '🔻 *Defisit:*';
    headerMsg += `${selisihLabel} ${formatRupiah(summary.saldo)}\n`;
    headerMsg += `📝 *Jumlah Transaksi:* ${summary.count} transaksi\n`;

    const incomeKeys = Object.keys(summary.categoryIncome || {});
    if (incomeKeys.length > 0) {
      headerMsg += `\n📥 *Ringkasan Kategori Pemasukan:*`;
      for (const kat of incomeKeys.sort((a, b) => summary.categoryIncome[b] - summary.categoryIncome[a])) {
        headerMsg += `\n • ${escapeTelegramMarkdown(kat)}: ${formatRupiah(summary.categoryIncome[kat])}`;
      }
    }

    const expKeys = Object.keys(summary.categoryExpenses || {});
    if (expKeys.length > 0) {
      headerMsg += `\n\n📤 *Ringkasan Kategori Pengeluaran:*`;
      for (const kat of expKeys.sort((a, b) => summary.categoryExpenses[b] - summary.categoryExpenses[a])) {
        headerMsg += `\n • ${escapeTelegramMarkdown(kat)}: ${formatRupiah(summary.categoryExpenses[kat])}`;
      }
    }

    if (summary.count === 0) {
      headerMsg += `\n\nℹ️ _Belum ada transaksi yang tercatat pada buku ini._`;
    }

    // Kelompokkan pemasukan & pengeluaran per tanggal
    const incomeDateBlocks = buildTransactionDateBlocks(summary.incomeDetails || [], 'Pemasukan');
    const expenseDateBlocks = buildTransactionDateBlocks(summary.expenseDetails || [], 'Pengeluaran');

    // Susun pesan dan pecah per chunk jika terlalu panjang (batas aman 3500 karakter)
    const chunks: string[] = [];
    let currentChunk = headerMsg;

    // Bagian Rincian Pemasukan per Tanggal
    if (incomeDateBlocks.length > 0) {
      const sectionDivider = `\n\n━━━━━━━━━━━━━━━━━━━━━\n📥 *Rincian Pemasukan per Tanggal:*\n`;
      if ((currentChunk + sectionDivider).length <= 3500) {
        currentChunk += sectionDivider;
      } else {
        chunks.push(currentChunk.trim());
        currentChunk = `📥 *Rincian Pemasukan per Tanggal:*\n`;
      }

      for (const block of incomeDateBlocks) {
        if ((currentChunk + '\n\n' + block).length > 3500) {
          chunks.push(currentChunk.trim());
          currentChunk = block;
        } else {
          currentChunk += (currentChunk.endsWith('\n') ? '\n' : '\n\n') + block;
        }
      }
    }

    // Bagian Rincian Pengeluaran per Tanggal
    if (expenseDateBlocks.length > 0) {
      const sectionDivider = `\n\n━━━━━━━━━━━━━━━━━━━━━\n📤 *Rincian Pengeluaran per Tanggal:*\n`;
      if ((currentChunk + sectionDivider).length <= 3500) {
        currentChunk += sectionDivider;
      } else {
        chunks.push(currentChunk.trim());
        currentChunk = `📤 *Rincian Pengeluaran per Tanggal:*\n`;
      }

      for (const block of expenseDateBlocks) {
        if ((currentChunk + '\n\n' + block).length > 3500) {
          chunks.push(currentChunk.trim());
          currentChunk = block;
        } else {
          currentChunk += (currentChunk.endsWith('\n') ? '\n' : '\n\n') + block;
        }
      }
    }

    const tips = `\n\n💡 _Tips: Ketik \`/rekap [nama bulan]\` (contoh: \`/rekap mei\`) untuk rekap per bulan, atau \`/rekapkas\` untuk seluruh kegiatan._`;
    if ((currentChunk + tips).length <= 3800) {
      currentChunk += tips;
      chunks.push(currentChunk.trim());
    } else {
      chunks.push(currentChunk.trim());
      chunks.push(tips.trim());
    }

    for (const chunk of chunks) {
      try {
        await ctx.reply(chunk, { parse_mode: 'Markdown' });
      } catch (err) {
        console.warn('Gagal kirim rekap Markdown, fallback plain text:', err);
        await ctx.reply(chunk.replace(/[*_`\\]/g, ''));
      }
    }
  } catch (error: any) {
    console.error('Error saat membuat rekap:', error);
    await ctx.reply(`⚠️ Gagal mengambil rekap: ${error?.message || 'Terjadi kesalahan sistem.'}`);
  }
}

// Helper: Mengirim pesan rekap seluruh kas & semua kegiatan
async function sendRekapKas(ctx: any, queryText: string = '') {
  try {
    await ctx.replyWithChatAction('typing');

    const monthInfo = parseMonthQuery(queryText);
    const globalSummary = await getAllSheetsSummary(
      monthInfo?.yearMonth,
      monthInfo?.label
    );

    let msg = `🏦 *Rekap Kas Keseluruhan (Semua Kegiatan)*\n`;
    msg += `🗓️ *Periode:* ${globalSummary.periodeLabel}\n\n`;
    msg += `🟢 *Total Pemasukan:* ${formatRupiah(globalSummary.totalPemasukan)}\n`;
    msg += `🔴 *Total Pengeluaran:* ${formatRupiah(globalSummary.totalPengeluaran)}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    const saldoLabel = globalSummary.saldo >= 0 ? '💰 *Total Saldo Kas:*' : '🔻 *Defisit Kas:*';
    msg += `${saldoLabel} ${formatRupiah(globalSummary.saldo)}\n`;
    msg += `📝 *Total Seluruh Transaksi:* ${globalSummary.count} transaksi\n`;

    if (globalSummary.books.length > 0) {
      msg += `\n📚 *Rincian per Buku / Kegiatan:*`;
      for (const b of globalSummary.books) {
        msg += `\n\n🔹 *${b.bookName}* (${b.count} transaksi):`;
        msg += `\n   • Masuk: ${formatRupiah(b.totalPemasukan)}`;
        msg += `\n   • Keluar: ${formatRupiah(b.totalPengeluaran)}`;
        const labelS = b.saldo >= 0 ? 'Sisa' : 'Defisit';
        msg += `\n   • ${labelS}: ${formatRupiah(b.saldo)}`;
      }
    }

    const expKeys = Object.keys(globalSummary.categoryExpenses);
    if (expKeys.length > 0) {
      msg += `\n\n🏷️ *Rincian Pengeluaran Gabungan:*`;
      for (const kat of expKeys.sort((a, b) => globalSummary.categoryExpenses[b] - globalSummary.categoryExpenses[a])) {
        msg += `\n • ${kat}: ${formatRupiah(globalSummary.categoryExpenses[kat])}`;
      }
    }

    await ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (error: any) {
    console.error('Error saat membuat rekap kas:', error);
    await ctx.reply(`⚠️ Gagal mengambil rekap kas: ${error?.message || 'Terjadi kesalahan sistem.'}`);
  }
}

// ============================================================
// HANDLER KAS ANGGOTA: /cekkas, /bayarkas, /anggota, dll.
// ============================================================

/**
 * Handler /cekkas
 * Bisa: /cekkas (bulan ini) | /cekkas januari | /cekkas said
 */
async function handleCekKas(ctx: any, query: string = '') {
  try {
    await ctx.replyWithChatAction('typing');
    const clean = query.trim();

    const currentYear = new Date().getFullYear();
    const yearMatch = clean.match(/\b(20\d\d)\b/);
    const tahun = yearMatch ? parseInt(yearMatch[1], 10) : currentYear;
    const cleanWithoutYear = clean.replace(/\b(20\d\d)\b/g, '').trim();

    // 1. Cek apakah pengguna mencari nama anggota spesifik
    if (cleanWithoutYear) {
      const daftarAnggota = await getDaftarAnggota();
      const matchedAnggota = daftarAnggota.find(
        (a) =>
          a.nama.toLowerCase() === cleanWithoutYear.toLowerCase() ||
          a.nama.toLowerCase().includes(cleanWithoutYear.toLowerCase())
      );

      // Jika cocok nama anggota dan bukan nama bulan
      const isBulan = normalisasiBulan(cleanWithoutYear);
      if (matchedAnggota && !isBulan) {
        const res = await cekStatusKasAnggota(matchedAnggota.nama, tahun);
        let msg = `👤 *Kartu Kas Anggota:* *${res.nama}*\n`;
        msg += `💼 *Jabatan:* ${res.jabatan}\n`;
        msg += `📌 *Status:* ${res.status === 'Aktif' ? '🟢 Aktif' : '⏸️ Nonaktif'}\n`;
        msg += `🗓️ *Tahun:* ${res.tahun}\n\n`;

        msg += `🟢 *Bulan Lunas (${res.bulanLunas.length}):*\n`;
        msg += res.bulanLunas.length > 0 ? res.bulanLunas.map((b) => ` • ${b}`).join('\n') : ` _Belum ada_\n`;

        msg += `\n🔴 *Bulan Belum Lunas (${res.bulanBelum.length}):*\n`;
        msg += res.bulanBelum.length > 0 ? res.bulanBelum.map((b) => ` • ${b}`).join('\n') : ` 🎉 _Semua bulan lunas!_\n`;

        msg += `\n━━━━━━━━━━━━━━━━━━━━━\n`;
        msg += `📊 *Ringkasan Iuran Tahun ${res.tahun}:*\n`;
        msg += `• 💰 *Sudah Bayar:* *${formatRupiah(res.totalBayar)}*\n`;
        msg += `• 🔻 *Kurang (Tunggakan):* *${formatRupiah(res.totalKurang)}*\n`;
        msg += `• 🎯 *Target Setahun:* *${formatRupiah(res.targetTahun)}* (${res.bulanLunas.length}/12 bulan lunas)`;

        await ctx.reply(msg, { parse_mode: 'Markdown' });
        return;
      }
    }

    // 2. Cek status kas per bulan
    const currentMonthName = DAFTAR_BULAN[new Date().getMonth()];
    const targetBulan = cleanWithoutYear ? normalisasiBulan(cleanWithoutYear) || currentMonthName : currentMonthName;

    const result = await cekStatusKasBulan(targetBulan, tahun);

    let msg = `📋 *Iuran Kas Anggota — ${result.bulan} ${result.tahun}*\n`;
    msg += `💵 *Tarif:* ${formatRupiah(NOMINAL_IURAN_DEFAULT)} / anggota\n\n`;

    msg += `🟢 *Sudah Bayar (${result.sudahBayar.length} orang):*\n`;
    if (result.sudahBayar.length > 0) {
      for (const s of result.sudahBayar) {
        const extraNote = s.bayar > NOMINAL_IURAN_DEFAULT
          ? ` _(Lunas + Lebih ${formatRupiah(s.bayar - NOMINAL_IURAN_DEFAULT)})_`
          : ` _(Lunas)_`;
        msg += ` • ${s.nama} — *Bayar:* ${formatRupiah(s.bayar)} | *Kurang:* Rp 0${extraNote}\n`;
      }
    } else {
      msg += ` _Belum ada yang membayar_\n`;
    }

    msg += `\n🔴 *Belum Bayar (${result.belumBayar.length} orang):*\n`;
    if (result.belumBayar.length > 0) {
      for (const b of result.belumBayar) {
        const statusKet = b.bayar > 0 ? `Nyicil` : `Belum Bayar`;
        msg += ` • ${b.nama} _(${b.jabatan})_\n    └ 💰 *Bayar:* ${formatRupiah(b.bayar)} | 🔻 *Kurang:* ${formatRupiah(b.kurang)} _(${statusKet})_\n`;
      }
    } else {
      msg += ` 🎉 _Semua anggota aktif sudah lunas!_\n`;
    }

    msg += `\n━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `📊 *Ringkasan Bulan ${result.bulan}:*\n`;
    msg += `• 💰 *Sudah Terbayar:* *${formatRupiah(result.totalTerkumpul)}*\n`;
    msg += `• 🔻 *Kurang (Tunggakan):* *${formatRupiah(result.totalTunggakan)}*\n`;
    msg += `• 🎯 *Target Kas (100%):* *${formatRupiah(result.targetKas)}*\n`;
    msg += `• 👥 *Anggota Aktif:* *${result.totalAnggotaAktif} orang* (${result.sudahBayar.length} lunas, ${result.belumBayar.length} belum)\n\n`;
    msg += `💡 _Tips:_ Ketik \`/cekkas [nama]\` (contoh: \`/cekkas Said\`) untuk cek histori per orang, atau \`/cekkas [nama bulan]\`.`;

    await ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (error: any) {
    console.error('Error saat cek kas:', error);
    await ctx.reply(`⚠️ Gagal memeriksa kas: ${error?.message || 'Terjadi kesalahan sistem.'}`);
  }
}

/**
 * Handler /bayarkas
 * Contoh: /bayarkas Said Januari 10000
 */
async function handleBayarKas(ctx: any, query: string = '') {
  const clean = query.trim();
  if (!clean) {
    await ctx.reply(
      `💡 *Format Mencatat Pembayaran Kas:*\n\n` +
        `Ketik: \`/bayarkas [Nama] [Bulan] [Nominal?]\`\n\n` +
        `*Contoh Penggunaan:*\n` +
        `• \`/bayarkas Said Rahman Januari\`\n` +
        `• \`/bayarkas Fajar Februari 10000\`\n` +
        `• Atau teks bebas: \`bayar kas sulis maret\`\n\n` +
        `_(Nominal default adalah Rp 10.000 jika tidak ditulis)_`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  try {
    await ctx.replyWithChatAction('typing');

    // Parse nominal (jika ada angka di query)
    const nominalMatch = clean.match(/\b(\d{4,7})\b/);
    const nominal = nominalMatch ? parseInt(nominalMatch[1], 10) : NOMINAL_IURAN_DEFAULT;
    let sisaText = clean.replace(/\b(\d{4,7})\b/g, '').trim();

    // Parse tahun (jika ada)
    const currentYear = new Date().getFullYear();
    const yearMatch = sisaText.match(/\b(20\d\d)\b/);
    const tahun = yearMatch ? parseInt(yearMatch[1], 10) : currentYear;
    sisaText = sisaText.replace(/\b(20\d\d)\b/g, '').trim();

    // Cari bulan
    let foundBulan: string | null = null;
    const tokens = sisaText.split(/\s+/);
    let bulanIndex = -1;

    for (let i = 0; i < tokens.length; i++) {
      const bNorm = normalisasiBulan(tokens[i]);
      if (bNorm) {
        foundBulan = bNorm;
        bulanIndex = i;
        break;
      }
    }

    if (!foundBulan) {
      // Default bulan saat ini jika tidak ditulis
      foundBulan = DAFTAR_BULAN[new Date().getMonth()];
    }

    // Nama anggota adalah sisa kata
    let namaAnggota = '';
    if (bulanIndex !== -1) {
      tokens.splice(bulanIndex, 1);
      namaAnggota = tokens.join(' ').replace(/^(untuk|bulan|kas)\s+/gi, '').trim();
    } else {
      namaAnggota = sisaText.replace(/^(untuk|bulan|kas)\s+/gi, '').trim();
    }

    if (!namaAnggota) {
      await ctx.reply('⚠️ Mohon sebutkan nama anggota yang membayar. Contoh: `/bayarkas Said Januari`', { parse_mode: 'Markdown' });
      return;
    }

    const res = await catatPembayaranKas(namaAnggota, foundBulan, tahun, nominal);
    if (!res.success) {
      await ctx.reply(res.message, { parse_mode: 'Markdown' });
      return;
    }

    await ctx.reply(
      `✅ *Pembayaran Kas Berhasil Dicatat!*\n\n` +
        `👤 *Anggota:* *${res.nama}*\n` +
        `🗓️ *Iuran Bulan:* *${res.bulan} ${res.tahun}*\n` +
        `💰 *Nominal:* *${formatRupiah(res.nominal)}*\n` +
        `📝 *Status:* Lunas\n\n` +
        `📊 _Tercatat di tab *Kas_Anggota* dan otomatis masuk sebagai Pemasukan di tab *Kas Utama*._`,
      { parse_mode: 'Markdown' }
    );
  } catch (error: any) {
    console.error('Error saat mencatat pembayaran kas:', error);
    await ctx.reply(`❌ Gagal mencatat kas: ${error?.message || 'Terjadi kesalahan sistem.'}`);
  }
}

/**
 * Handler /anggota
 */
async function handleDaftarAnggota(ctx: any) {
  try {
    await ctx.replyWithChatAction('typing');
    const anggota = await getDaftarAnggota();

    const aktif = anggota.filter((a) => a.status === 'Aktif');
    const nonaktif = anggota.filter((a) => a.status === 'Nonaktif');

    let msg = `👥 *Daftar Anggota Kas*\n\n`;

    msg += `🟢 *Anggota Aktif (${aktif.length} orang):*\n`;
    for (const a of aktif) {
      msg += ` • *${a.nama}* — _${a.jabatan}_\n`;
    }

    if (nonaktif.length > 0) {
      msg += `\n⏸️ *Anggota Nonaktif (${nonaktif.length} orang):*\n`;
      for (const a of nonaktif) {
        msg += ` • ~${a.nama}~ — _${a.jabatan}_\n`;
      }
    }

    msg += `\n━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `⚙️ *Perintah Pengelolaan Anggota:*\n`;
    msg += `• \`/tambahanggota [Nama]\` — Tambah anggota baru\n`;
    msg += `• \`/nonaktifanggota [Nama]\` — Nonaktifkan anggota\n`;
    msg += `• \`/aktifkananggota [Nama]\` — Aktifkan kembali anggota`;

    await ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (error: any) {
    console.error('Error saat mengambil daftar anggota:', error);
    await ctx.reply(`⚠️ Gagal mengambil daftar anggota: ${error?.message || 'Terjadi kesalahan sistem.'}`);
  }
}

/**
 * Handler /tambahanggota
 */
async function handleTambahAnggota(ctx: any, query: string = '') {
  const clean = query.trim();
  if (!clean) {
    await ctx.reply(
      `💡 *Format Tambah Anggota:*\nKetik: \`/tambahanggota [Nama Lengkap]\`\n\n_Contoh:_ \`/tambahanggota Budi Santoso\``,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  try {
    await ctx.replyWithChatAction('typing');
    const res = await tambahAnggota(clean);
    await ctx.reply(res.message, { parse_mode: 'Markdown' });
  } catch (error: any) {
    await ctx.reply(`❌ Gagal menambah anggota: ${error?.message}`);
  }
}

/**
 * Handler /nonaktifanggota
 */
async function handleNonaktifAnggota(ctx: any, query: string = '') {
  const clean = query.trim();
  if (!clean) {
    await ctx.reply(
      `💡 *Format Nonaktifkan Anggota:*\nKetik: \`/nonaktifanggota [Nama Anggota]\`\n\n_Contoh:_ \`/nonaktifanggota Zulfa\`\n\n_(Anggota nonaktif tidak akan ditagih iuran kas lagi)_`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  try {
    await ctx.replyWithChatAction('typing');
    const res = await ubahStatusAnggota(clean, 'Nonaktif');
    await ctx.reply(res.message, { parse_mode: 'Markdown' });
  } catch (error: any) {
    await ctx.reply(`❌ Gagal menonaktifkan anggota: ${error?.message}`);
  }
}

/**
 * Handler /aktifkananggota
 */
async function handleAktifkanAnggota(ctx: any, query: string = '') {
  const clean = query.trim();
  if (!clean) {
    await ctx.reply(
      `💡 *Format Aktifkan Anggota:*\nKetik: \`/aktifkananggota [Nama Anggota]\`\n\n_Contoh:_ \`/aktifkananggota Zulfa\``,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  try {
    await ctx.replyWithChatAction('typing');
    const res = await ubahStatusAnggota(clean, 'Aktif');
    await ctx.reply(res.message, { parse_mode: 'Markdown' });
  } catch (error: any) {
    await ctx.reply(`❌ Gagal mengaktifkan anggota: ${error?.message}`);
  }
}

// Command: /rekap & /recap
bot.command(['rekap', 'recap'], async (ctx) => {
  const text = ctx.message?.text || '';
  const parts = text.split(' ').slice(1).join(' ').trim();
  await sendRekap(ctx, parts);
});

// Command: /rekapkas (Rekap total seluruh kas dan semua kegiatan)
bot.command(['rekapkas', 'recapkas'], async (ctx) => {
  const text = ctx.message?.text || '';
  const parts = text.split(' ').slice(1).join(' ').trim();
  await sendRekapKas(ctx, parts);
});

async function handleCekFoto(ctx: any, customBook?: string) {
  const chatId = ctx.chat?.id || ctx.from?.id;
  const activeBook = customBook?.trim() || (await getUserActiveBook(chatId));

  const driveConfig = getDriveConfigStatus();

  let statusDriveText = '';
  if (driveConfig.mode === 'gas') {
    statusDriveText = '🟢 Google Apps Script Webhook';
  } else if (driveConfig.mode === 'service_account') {
    statusDriveText = '🟡 Service Account API';
  } else {
    statusDriveText = '🔴 Belum Dikonfigurasi';
  }

  const [items, allBooks] = await Promise.all([
    getRecentTransactionsWithNotes(activeBook, 6),
    getAllSheetBooks().catch(() => [DEFAULT_BOOK_NAME]),
  ]);

  if (items.length === 0) {
    const keyboard = new InlineKeyboard()
      .text('🔄 Segarkan', `cekfoto_refresh:${activeBook}`)
      .text('📡 Tes Koneksi Drive', 'cekfoto_test')
      .row();

    // Tombol untuk beralih ke tab buku lainnya di spreadsheet
    const otherBooks = allBooks.filter((b) => b.toLowerCase() !== activeBook.toLowerCase());
    if (otherBooks.length > 0) {
      otherBooks.forEach((b) => keyboard.text(`📖 Buka Buku [${b}]`, `cekfoto_refresh:${b}`));
      keyboard.row();
    }

    if (driveConfig.hasFolder) {
      keyboard.url('📁 Buka Folder Drive', driveConfig.folderUrl);
    }

    await ctx.reply(
      `📸 *Status Foto Nota & Bukti Transaksi*\n\n` +
        `📖 *Buku Kegiatan:* \`${activeBook}\` _(Tab Sheets: ${activeBook})_\n` +
        `📡 *Koneksi Drive:* ${statusDriveText}\n\n` +
        `_Belum ada transaksi yang tercatat di tab buku ini._\n\n` +
        `💡 *Tips:* Kirim foto struk/nota kasir ke bot ini untuk otomatis membaca transaksi dan menyimpan buktinya ke Google Drive!`,
      {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
        link_preview_options: { is_disabled: true },
      }
    );
    return;
  }

  let textList = '';
  let countPhoto = 0;
  let countNoPhoto = 0;

  items.forEach((item, idx) => {
    const num = idx + 1;
    const typeIcon = item.type.toLowerCase().includes('masuk') ? '🟢' : '🔴';
    const amountStr = formatRupiah(item.amount);

    let photoStatus = '';
    if (item.hasPhoto) {
      countPhoto++;
      photoStatus = `✅ [Buka Foto di Drive](${item.noteLink})`;
    } else {
      countNoPhoto++;
      photoStatus = `❌ _Belum ada foto / link kosong_`;
    }

    textList +=
      `*${num}.* ${item.date} — *${item.description}*\n` +
      `    ${typeIcon} ${amountStr} (${item.category || item.type})\n` +
      `    📎 *Foto:* ${photoStatus}\n\n`;
  });

  const keyboard = new InlineKeyboard()
    .text('🔄 Segarkan', `cekfoto_refresh:${activeBook}`)
    .text('📡 Tes Koneksi Drive', 'cekfoto_test')
    .row();

  if (countNoPhoto > 0) {
    keyboard.text(`📤 Unggah Ulang Foto (${activeBook})`, `reupload_list:${activeBook}`).row();
  }

  // Tombol untuk beralih ke tab buku lainnya di spreadsheet
  const otherBooks = allBooks.filter((b) => b.toLowerCase() !== activeBook.toLowerCase());
  if (otherBooks.length > 0) {
    otherBooks.forEach((b) => keyboard.text(`📖 Buka Buku [${b}]`, `cekfoto_refresh:${b}`));
    keyboard.row();
  }

  if (driveConfig.hasFolder) {
    keyboard.url('📁 Buka Folder Google Drive', driveConfig.folderUrl);
  }

  const summaryPhotoText =
    `📊 *Ringkasan ${items.length} Transaksi Terakhir:*\n` +
    `• 📸 *Ada Foto Terunggah:* ${countPhoto}\n` +
    `• ⚠️ *Tanpa Foto / Gagal:* ${countNoPhoto}`;

  await ctx.reply(
    `📸 *Status Foto Nota & Bukti Transaksi*\n\n` +
      `📖 *Buku Kegiatan:* \`${activeBook}\` _(Tab Sheets: ${activeBook})_\n` +
      `📡 *Koneksi Drive:* ${statusDriveText}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      textList +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `${summaryPhotoText}\n\n` +
      `💡 _Klik tautan [Buka Foto di Drive] untuk melihat struk langsung di Google Drive._`,
    {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
      link_preview_options: { is_disabled: true },
    }
  );
}

/**
 * Menampilkan daftar transaksi yang belum memiliki foto untuk dipilih dan diunggah ulang
 */
async function handlePilihUnggahUlang(ctx: any, customBook?: string) {
  const chatId = ctx.chat?.id || ctx.from?.id;
  const activeBook = customBook?.trim() || (await getUserActiveBook(chatId));

  const [items, allBooks] = await Promise.all([
    getRecentTransactionsWithNotes(activeBook, 15),
    getAllSheetBooks().catch(() => [DEFAULT_BOOK_NAME]),
  ]);
  const itemsWithoutPhoto = items.filter((it) => !it.hasPhoto);

  const keyboard = new InlineKeyboard();

  if (itemsWithoutPhoto.length === 0) {
    keyboard.text('📸 Cek Status Foto', `cekfoto_refresh:${activeBook}`);
    const otherBooks = allBooks.filter((b) => b.toLowerCase() !== activeBook.toLowerCase());
    if (otherBooks.length > 0) {
      keyboard.row();
      otherBooks.forEach((b) => keyboard.text(`📁 Cek Buku [${b}]`, `reupload_list:${b}`));
    }

    await ctx.reply(
      `🎉 *Luar Biasa!*\n` +
        `Semua transaksi di tab buku \`${activeBook}\` sudah memiliki bukti foto nota di Google Drive!\n\n` +
        (otherBooks.length > 0 ? `Anda dapat memeriksa tab buku lain melalui tombol di bawah:` : `Ketik /cekfoto untuk melihat daftar transaksi dan tautan foto.`),
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
    return;
  }

  itemsWithoutPhoto.slice(0, 8).forEach((it) => {
    const descShort = it.description.length > 22 ? it.description.slice(0, 20) + '..' : it.description;
    const btnLabel = `📤 #${it.rowNumber}: ${descShort} (${formatRupiah(it.amount)})`;
    keyboard.text(btnLabel, `reupload_pick:${activeBook}:${it.rowNumber}`).row();
  });

  const otherBooks = allBooks.filter((b) => b.toLowerCase() !== activeBook.toLowerCase());
  if (otherBooks.length > 0) {
    otherBooks.forEach((b) => keyboard.text(`📁 Cek Buku [${b}]`, `reupload_list:${b}`));
    keyboard.row();
  }

  keyboard.text('⬅️ Kembali ke Cek Foto', `cekfoto_refresh:${activeBook}`).row();

  await ctx.reply(
    `📤 *Unggah Ulang Foto Nota*\n\n` +
      `📖 *Buku Kegiatan:* \`${activeBook}\` _(Tab Sheets: ${activeBook})_\n\n` +
      `Ditemukan *${itemsWithoutPhoto.length} transaksi* yang belum memiliki foto bukti di Google Drive.\n` +
      `Silakan *klik salah satu tombol transaksi* di bawah untuk mengirimkan fotonya:`,
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
}

// Callback: Refresh cekfoto
bot.callbackQuery(/^cekfoto_refresh:(.+)$/, async (ctx) => {
  const targetBook = ctx.match[1];
  await ctx.answerCallbackQuery({ text: 'Memperbarui status foto...' });
  try {
    await handleCekFoto(ctx, targetBook);
  } catch (err: any) {
    await ctx.reply(`❌ Gagal memperbarui data: ${err?.message || err}`);
  }
});

// Callback: Daftar transaksi untuk unggah ulang foto
bot.callbackQuery(/^reupload_list:(.+)$/, async (ctx) => {
  const targetBook = ctx.match[1];
  await ctx.answerCallbackQuery();
  try {
    await handlePilihUnggahUlang(ctx, targetBook);
  } catch (err: any) {
    await ctx.reply(`❌ Gagal memuat daftar: ${err?.message || err}`);
  }
});

// Callback: Pilih transaksi tertentu untuk diunggah ulang fotonya
bot.callbackQuery(/^reupload_pick:([^:]+):(\d+)$/, async (ctx) => {
  const targetBook = ctx.match[1];
  const rowNum = parseInt(ctx.match[2], 10);
  const chatId = ctx.chat?.id || ctx.from?.id;

  if (!chatId) return;

  await ctx.answerCallbackQuery();

  const item = await getTransactionByRow(targetBook, rowNum);
  if (!item) {
    await ctx.reply('❌ Transaksi tidak ditemukan di Google Sheets.');
    return;
  }

  // Set state unggah ulang foto
  reuploadStates.set(chatId, {
    rowNumber: item.rowNumber,
    bookName: targetBook,
    description: item.description,
    amount: item.amount,
    date: item.date,
  });

  const keyboard = new InlineKeyboard().text('❌ Batalkan', 'reupload_cancel');

  await ctx.reply(
    `📸 *Siap Menerima Foto Nota!*\n\n` +
      `📖 *Buku:* \`${targetBook}\`\n` +
      `📝 *Transaksi:* *${item.description}*\n` +
      `💰 *Nominal:* ${formatRupiah(item.amount)} (${item.type})\n` +
      `📅 *Tanggal:* ${item.date}\n` +
      `📌 *Baris Sheets:* #${item.rowNumber}\n\n` +
      `👉 *Silakan kirimkan file foto nota/struk sekarang.*\n` +
      `Foto akan otomatis diunggah ke Google Drive dan tautannya disimpan di baris ini.`,
    {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    }
  );
});

// Callback: Batalkan mode unggah ulang foto
bot.callbackQuery('reupload_cancel', async (ctx) => {
  const chatId = ctx.chat?.id || ctx.from?.id;
  if (chatId) reuploadStates.delete(chatId);
  await ctx.answerCallbackQuery({ text: 'Unggah ulang dibatalkan.' });
  await ctx.reply('❌ Mode unggah ulang foto nota telah dibatalkan.');
});

// Callback: Tes koneksi upload Drive
bot.callbackQuery('cekfoto_test', async (ctx) => {
  await ctx.answerCallbackQuery({ text: 'Menguji koneksi upload ke Google Drive...' });
  const statusMsg = await ctx.reply('⏳ *Sedang menguji koneksi Google Drive...*', { parse_mode: 'Markdown' });

  const testResult = await testDriveUpload();

  const keyboard = new InlineKeyboard();
  if (testResult.url) {
    keyboard.url('📄 Buka File Uji Coba', testResult.url);
  }

  const resultIcon = testResult.success ? '✅' : '❌';
  await ctx.api.editMessageText(
    ctx.chat!.id,
    statusMsg.message_id,
    `${resultIcon} *Hasil Uji Coba Koneksi Google Drive:*\n\n` +
      `${testResult.message}\n` +
      (testResult.url ? `\n🔗 [Lihat File Test di Drive](${testResult.url})` : ''),
    {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
      link_preview_options: { is_disabled: true },
    }
  );
});

// Command: /cekfoto
bot.command(['cekfoto', 'foto', 'statusfoto', 'nota_foto'], async (ctx) => {
  const text = ctx.message?.text || '';
  const parts = text.split(' ').slice(1).join(' ').trim();
  await handleCekFoto(ctx, parts || undefined);
});

// Command: /unggahfoto (atau /unggahulang)
bot.command(['unggahfoto', 'unggahulang', 'reupload', 'uploadfoto'], async (ctx) => {
  const text = ctx.message?.text || '';
  const parts = text.split(' ').slice(1).join(' ').trim();
  await handlePilihUnggahUlang(ctx, parts || undefined);
});

// Command Kas Anggota
bot.command('cekkas', async (ctx) => {
  const text = ctx.message?.text || '';
  const parts = text.split(' ').slice(1).join(' ').trim();
  await handleCekKas(ctx, parts);
});

bot.command('bayarkas', async (ctx) => {
  const text = ctx.message?.text || '';
  const parts = text.split(' ').slice(1).join(' ').trim();
  await handleBayarKas(ctx, parts);
});

bot.command('anggota', async (ctx) => {
  await handleDaftarAnggota(ctx);
});

bot.command('tambahanggota', async (ctx) => {
  const text = ctx.message?.text || '';
  const parts = text.split(' ').slice(1).join(' ').trim();
  await handleTambahAnggota(ctx, parts);
});

bot.command(['nonaktifanggota', 'nonaktifkananggota'], async (ctx) => {
  const text = ctx.message?.text || '';
  const parts = text.split(' ').slice(1).join(' ').trim();
  await handleNonaktifAnggota(ctx, parts);
});

bot.command('aktifkananggota', async (ctx) => {
  const text = ctx.message?.text || '';
  const parts = text.split(' ').slice(1).join(' ').trim();
  await handleAktifkanAnggota(ctx, parts);
});

// Command: /pindahsaldo (dan alias)
bot.command(['pindahsaldo', 'transfersaldo', 'pindah', 'transfer'], async (ctx) => {
  const text = ctx.message?.text || '';
  const parts = text.split(' ').slice(1).join(' ').trim();
  await handleStartPindahSaldo(ctx, parts);
});

// ============================================================
// Command: /nota — mulai percakapan buat nota
// ============================================================
bot.command('nota', async (ctx) => {
  const chatId = ctx.chat.id;
  createBookStates.delete(chatId);
  transferStates.delete(chatId);
  notaStates.set(chatId, { step: 'invoice_no', data: { items: [] } });
  await ctx.reply(
    `📋 *Buat Nota AJP*\n\n` +
      `Masukkan *No. Invoice:*\n` +
      `_(contoh: 011/AJP/JJ/2026)_`,
    { parse_mode: 'Markdown' }
  );
});

// Proses setiap langkah percakapan /nota
async function processNotaStep(ctx: any, chatId: number, text: string): Promise<boolean> {
  const state = notaStates.get(chatId);
  if (!state) return false;

  switch (state.step) {
    case 'invoice_no':
      state.data.noInvoice = text;
      state.step = 'tanggal';
      await ctx.reply(
        `✅ No. Invoice: *${text}*\n\n` +
          `📅 Masukkan *Tanggal:*\n_(contoh: 22 September 2026)_`,
        { parse_mode: 'Markdown' }
      );
      break;

    case 'tanggal':
      state.data.tanggal = text;
      state.step = 'nama';
      await ctx.reply(
        `✅ Tanggal: *${text}*\n\n` +
          `👤 Masukkan *Nama penerima (Kepada Yth.):*`,
        { parse_mode: 'Markdown' }
      );
      break;

    case 'nama':
      state.data.namaKepada = text;
      state.step = 'alamat';
      await ctx.reply(
        `✅ Nama: *${text}*\n\n` +
          `📍 Masukkan *Alamat penerima:*`,
        { parse_mode: 'Markdown' }
      );
      break;

    case 'alamat':
      state.data.alamatKepada = text;
      state.step = 'catatan';
      await ctx.reply(
        `✅ Alamat: *${text}*\n\n` +
          `📝 Masukkan *Catatan nota:*\n_(keterangan kegiatan)_`,
        { parse_mode: 'Markdown' }
      );
      break;

    case 'catatan':
      state.data.catatan = text;
      state.step = 'items';
      await ctx.reply(
        `✅ Catatan dicatat.\n\n` +
          `⚖️ *Item 1 — Berat Bersih (kg):*\n_(ketik angka saja, contoh: \`54\`)_`,
        { parse_mode: 'Markdown' }
      );
      break;

    case 'items': {
      if (text.toLowerCase() === 'selesai' || text.toLowerCase() === 'done') {
        if (state.data.items.length === 0) {
          await ctx.reply('⚠️ Belum ada item yang ditambahkan. Masukkan berat (kg) minimal 1 item.');
          break;
        }
        notaStates.delete(chatId);
        await ctx.reply('⏳ _Sedang membuat nota PDF..._', { parse_mode: 'Markdown' });
        try {
          const pdfBuffer = await generateNotaPdf({
            noInvoice: state.data.noInvoice!,
            tanggal: state.data.tanggal!,
            namaKepada: state.data.namaKepada!,
            alamatKepada: state.data.alamatKepada!,
            catatan: state.data.catatan!,
            items: state.data.items,
          });
          const total = state.data.items.reduce((s, kg) => s + Math.round(kg * HARGA_PER_KG), 0);
          const filename = `Nota-${state.data.noInvoice!.replace(/\//g, '-')}.pdf`;
          await ctx.replyWithDocument(
            new InputFile(pdfBuffer, filename),
            {
              caption:
                `📄 *Nota Berhasil Dibuat!*\n` +
                `🔢 No. Invoice: *${state.data.noInvoice}*\n` +
                `📅 Tanggal: *${state.data.tanggal}*\n` +
                `👤 Kepada: *${state.data.namaKepada}*\n` +
                `💰 Total: *${rupiahFormat(total)}*`,
              parse_mode: 'Markdown',
            }
          );
        } catch (err: any) {
          console.error('Error generate nota PDF:', err);
          await ctx.reply(`❌ Gagal membuat nota: ${err.message}`);
        }
        break;
      }

      const kg = parseFloat(text.replace(',', '.'));
      if (isNaN(kg) || kg <= 0) {
        await ctx.reply(
          '⚠️ Format tidak dikenali. Masukkan angka berat dalam kg.\n' +
            `_(contoh: \`54\` atau \`12.5\`)_\n\n` +
            `Atau ketik *selesai* jika sudah selesai menambah item.`,
          { parse_mode: 'Markdown' }
        );
        break;
      }

      state.data.items.push(kg);
      const itemIdx = state.data.items.length;
      const jumlah = Math.round(kg * HARGA_PER_KG);
      const nextItemNum = itemIdx + 1;

      if (itemIdx >= 10) {
        notaStates.delete(chatId);
        await ctx.reply('✅ Item penuh (maks 10). Membuat nota...');
        const pdfBuffer = await generateNotaPdf({
          noInvoice: state.data.noInvoice!,
          tanggal: state.data.tanggal!,
          namaKepada: state.data.namaKepada!,
          alamatKepada: state.data.alamatKepada!,
          catatan: state.data.catatan!,
          items: state.data.items,
        });
        const total = state.data.items.reduce((s, k) => s + Math.round(k * HARGA_PER_KG), 0);
        const filename = `Nota-${state.data.noInvoice!.replace(/\//g, '-')}.pdf`;
        await ctx.replyWithDocument(
          new InputFile(pdfBuffer, filename),
          { caption: `📄 Nota selesai! Total: *${rupiahFormat(total)}*`, parse_mode: 'Markdown' }
        );
      } else {
        await ctx.reply(
          `✅ Item ${itemIdx}: *${kg} kg* × Rp 7.200 = *${rupiahFormat(jumlah)}*\n\n` +
            `⚖️ *Item ${nextItemNum}* _(atau ketik *selesai* jika sudah):_`,
          { parse_mode: 'Markdown' }
        );
      }
      break;
    }
  }
  return true;
}

// Handler: Pesan Teks
bot.on('message:text', async (ctx) => {
  const text = ctx.message.text.trim();
  const chatId = ctx.chat.id;

  // === 0. Cek apakah pengguna sedang dalam proses unggah ulang foto nota ===
  if (reuploadStates.has(chatId)) {
    if (text === '/batal' || text.toLowerCase() === 'batal') {
      reuploadStates.delete(chatId);
      await ctx.reply('❌ Mode unggah ulang foto nota telah dibatalkan.');
      return;
    }
    const state = reuploadStates.get(chatId)!;
    const keyboard = new InlineKeyboard().text('❌ Batalkan', 'reupload_cancel');
    await ctx.reply(
      `⚠️ Anda sedang dalam mode unggah ulang foto untuk:\n` +
        `📝 *${state.description}* (${formatRupiah(state.amount)})\n` +
        `📌 *Baris Sheets:* #${state.rowNumber}\n\n` +
        `👉 *Silakan kirimkan foto nota/struk*, atau klik tombol di bawah untuk membatalkan.`,
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
    return;
  }

  // === Cek jika pengguna me-REPLY foto lama dengan pesan teks 'upload' / 'unggah' / dll ===
  if (
    ctx.message.reply_to_message?.photo ||
    ctx.message.reply_to_message?.document?.mime_type?.startsWith('image/')
  ) {
    const isUploadCommand =
      /^(upload|unggah|drive|gas|reupload|foto|link|\/upload|\/unggah|\/unggahfoto|\/reupload)/i.test(text);

    if (isUploadCommand) {
      const repMsg = ctx.message.reply_to_message;
      let replyFileId: string | undefined;
      let replyFileName = `nota_${Date.now()}.jpg`;
      let replyMimeType = 'image/jpeg';

      if (repMsg.photo) {
        const photos = repMsg.photo;
        replyFileId = photos[photos.length - 1].file_id;
      } else if (repMsg.document?.mime_type?.startsWith('image/')) {
        replyFileId = repMsg.document.file_id;
        replyFileName = repMsg.document.file_name || replyFileName;
        replyMimeType = repMsg.document.mime_type;
      }

      if (replyFileId) {
        const activeBook = await getUserActiveBook(chatId);
        await ctx.reply(
          `⏳ *Membaca foto lama & mengunggah ke Google Drive...*`,
          { parse_mode: 'Markdown' }
        );
        await ctx.replyWithChatAction('upload_photo');

        try {
          const file = await ctx.api.getFile(replyFileId);
          if (!file.file_path) {
            throw new Error('Tidak dapat mengunduh file foto dari Telegram.');
          }

          const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
          const res = await fetch(fileUrl);
          if (!res.ok) {
            throw new Error(`Gagal fetch file dari Telegram: ${res.statusText}`);
          }

          const arrayBuffer = await res.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);

          // 1. Eksekusi OCR Gemini dan Upload ke Drive secara paralel (memangkas waktu 50%)
          const [parsed, driveLink] = await Promise.all([
            parseReceiptImage(buffer, replyMimeType, repMsg.caption).catch((err) => {
              console.warn('Gagal parseReceiptImage saat reply:', err);
              return null;
            }),
            uploadReceiptToDrive(buffer, replyFileName, replyMimeType).catch((err) => {
              console.error('Gagal uploadReceiptToDrive saat reply:', err);
              return null;
            }),
          ]);

          // Tentukan kriteria pencarian dari hasil Gemini atau caption pesan asli
          const searchAmount = parsed?.amount;
          const searchDesc = parsed?.description || repMsg.caption;

          // 2. Cari transaksi yang cocok di Google Sheets (di buku aktif, atau lintas tab)
          const matchResult = await findMatchingTransactionRowAcrossBooks(activeBook, {
            amount: searchAmount,
            description: searchDesc,
          });

          if (matchResult && driveLink) {
            const { item: matchingRow, bookName: targetBook } = matchResult;
            await updateTransactionNoteLink(matchingRow.rowNumber, driveLink, targetBook);

            const keyboard = new InlineKeyboard()
              .url('📸 Buka Foto di Drive', driveLink)
              .text('📸 Cek Foto Lainnya', `cekfoto_refresh:${targetBook}`);

            await ctx.reply(
              `✅ *Foto Nota Berhasil Ditautkan via Reply!*\n\n` +
                `📖 *Buku Kegiatan:* \`${targetBook}\` _(Tab Sheets: ${targetBook})_\n` +
                `📝 *Transaksi:* *${matchingRow.description}*\n` +
                `💰 *Nominal:* ${formatRupiah(matchingRow.amount)}\n` +
                `📌 *Baris Sheets:* #${matchingRow.rowNumber}\n\n` +
                `🔗 [Buka Foto di Google Drive](${driveLink})\n\n` +
                `_Tautan foto berhasil dicatat di Google Sheets pada tab \`${targetBook}\` Kolom F tanpa membuat transaksi dobel!_`,
              {
                parse_mode: 'Markdown',
                reply_markup: keyboard,
                link_preview_options: { is_disabled: true },
              }
            );
            return;
          } else if (driveLink) {
            // Upload ke Drive sukses tapi baris belum terdeteksi otomatis
            const keyboard = new InlineKeyboard()
              .url('📸 Buka Foto di Drive', driveLink)
              .text(`📤 Pilih Baris di [${activeBook}]`, `reupload_list:${activeBook}`);

            await ctx.reply(
              `📸 *Foto Berhasil Disimpan ke Google Drive!*\n\n` +
                `🔗 [Lihat Foto di Google Drive](${driveLink})\n\n` +
                `⚠️ Nominal yang terbaca (${searchAmount ? formatRupiah(searchAmount) : '?'}) belum cocok otomatis dengan daftar transaksi di tab \`${activeBook}\`.\n\n` +
                `💡 *Solusi Mudah:* Klik tombol di bawah atau ketik /unggahfoto untuk memilih baris transaksi secara langsung.`,
              {
                parse_mode: 'Markdown',
                reply_markup: keyboard,
                link_preview_options: { is_disabled: true },
              }
            );
            return;
          } else {
            await ctx.reply(
              `❌ Gagal mengunggah foto ke Google Drive. Silakan periksa koneksi Drive dengan mengetik /cekfoto.`,
              { parse_mode: 'Markdown' }
            );
            return;
          }
        } catch (replyErr: any) {
          console.error('Error saat proses reply upload:', replyErr);
          await ctx.reply(
            `❌ Terjadi kendala saat memproses foto: ${replyErr?.message || replyErr}\n` +
              `💡 Anda bisa gunakan perintah /unggahfoto untuk memilih baris transaksi secara manual.`
          );
          return;
        }
      }
    }
  }

  // === 1. Cek apakah pengguna sedang dalam proses /buat buku baru ===
  if (createBookStates.has(chatId)) {
    if (text.toLowerCase() === 'batal' || text === '/batal') {
      createBookStates.delete(chatId);
      await ctx.reply('❌ Pembuatan buku dibatalkan.');
      return;
    }

    const cleanName = sanitizeBookName(text);
    if (!cleanName || cleanName.length < 2) {
      await ctx.reply(
        '⚠️ Nama kegiatan terlalu pendek. Masukkan minimal 2 karakter, atau ketik *batal*:',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    await ctx.replyWithChatAction('typing');
    try {
      const result = await createSheetBook(cleanName);
      await setUserActiveBook(chatId, result.bookName);
      createBookStates.delete(chatId);

      // Sync menu command di background
      syncBotCommands(ctx.api).catch(() => {});

      const cmd = result.bookName.toLowerCase().replace(/[^a-z0-9_]/g, '');
      await ctx.reply(
        `🎉 *Buku Kegiatan Berhasil Dibuat!*\n\n` +
          `📖 *Buku Aktif Sekarang:* \`${result.bookName}\`\n` +
          `📊 Tab baru *${result.bookName}* telah siap di Google Sheets Anda.\n\n` +
          `Mulai sekarang:\n` +
          `• Chat transaksi & foto nota Anda akan dicatat ke buku ini.\n` +
          `• Ketik /rekap untuk melihat rekap kegiatan ini.\n` +
          `• Ketik /rekapkas untuk melihat rekap seluruh kas & kegiatan.\n` +
          `• Ketik /kas untuk kembali ke Kas Utama.\n` +
          `• Ketik /${cmd} kapan saja untuk berpindah ke buku ini.`,
        { parse_mode: 'Markdown' }
      );
    } catch (err: any) {
      console.error('Gagal membuat buku:', err);
      await ctx.reply(`❌ Gagal membuat buku: ${err.message}`);
    }
    return;
  }

  // === 2. Cek apakah pengguna sedang dalam mode /nota ===
  if (notaStates.has(chatId)) {
    await processNotaStep(ctx, chatId, text);
    return;
  }

  // === 3. Cek apakah pengguna sedang dalam proses input nominal /pindahsaldo ===
  const tState = transferStates.get(chatId);
  if (tState && tState.step === 'input_amount') {
    if (text.toLowerCase() === 'batal' || text === '/batal') {
      transferStates.delete(chatId);
      await ctx.reply('❌ Pemindahan saldo dibatalkan.');
      return;
    }

    const nominal = parseNominalInput(text);
    if (!nominal || nominal <= 0) {
      await ctx.reply(
        '⚠️ Format nominal tidak valid.\n' +
          'Silakan masukkan angka nominal (contoh: `50000` atau `75rb`), atau ketik *batal*:',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (nominal > tState.sourceBalance!) {
      await ctx.reply(
        `⚠️ Nominal melebihi saldo tersedia!\n` +
          `Sisa saldo di buku *${tState.sourceBook}* hanya *${formatRupiah(tState.sourceBalance!)}*.\n` +
          `Silakan masukkan nominal yang tidak melebihi sisa saldo, atau ketik *batal*:`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    tState.amount = nominal;
    tState.step = 'confirm';

    await ctx.reply(
      `⚠️ *Konfirmasi Pemindahan Saldo*\n\n` +
        `📤 *Dari:* \`${tState.sourceBook}\`\n` +
        `📥 *Ke:* \`${tState.targetBook}\`\n` +
        `💰 *Nominal:* *${formatRupiah(tState.amount)}*\n\n` +
        `ℹ️ _Saldo di buku \`${tState.sourceBook}\` akan tersisa *${formatRupiah(tState.sourceBalance! - tState.amount)}*._\n\n` +
        `Apakah Anda ingin melanjutkan pemindahan?`,
      {
        parse_mode: 'Markdown',
        reply_markup: buildTransferConfirmKeyboard(),
      }
    );
    return;
  }

  // === 4. Deteksi Perintah Cepat Kas Anggota & Pindah Saldo Berbasis Teks Bebas ===
  const textLower = text.toLowerCase();

  if (
    textLower.startsWith('pindah saldo') ||
    textLower.startsWith('pindahsaldo') ||
    textLower.startsWith('transfer saldo') ||
    textLower.startsWith('transfersaldo')
  ) {
    const q = text.replace(/^(pindah\s*saldo|pindahsaldo|transfer\s*saldo|transfersaldo)/i, '').trim();
    await handleStartPindahSaldo(ctx, q);
    return;
  }

  if (textLower.startsWith('cek kas') || textLower.startsWith('cekkas')) {
    const q = text.replace(/^(cek\s*kas|cekkas)/i, '').trim();
    await handleCekKas(ctx, q);
    return;
  }

  if (textLower.startsWith('bayar kas') || textLower.startsWith('bayarkas')) {
    const q = text.replace(/^(bayar\s*kas|bayarkas)/i, '').trim();
    await handleBayarKas(ctx, q);
    return;
  }

  if (textLower.startsWith('tambah anggota') || textLower.startsWith('tambahanggota')) {
    const q = text.replace(/^(tambah\s*anggota|tambahanggota)/i, '').trim();
    await handleTambahAnggota(ctx, q);
    return;
  }

  if (
    textLower.startsWith('nonaktifkan anggota') ||
    textLower.startsWith('nonaktif anggota') ||
    textLower.startsWith('nonaktifkan') ||
    textLower.startsWith('nonaktifanggota')
  ) {
    const q = text.replace(/^(nonaktifkan\s*anggota|nonaktif\s*anggota|nonaktifkan|nonaktifanggota)/i, '').trim();
    await handleNonaktifAnggota(ctx, q);
    return;
  }

  if (
    textLower.startsWith('aktifkan anggota') ||
    textLower.startsWith('aktifkan') ||
    textLower.startsWith('aktifkananggota')
  ) {
    const q = text.replace(/^(aktifkan\s*anggota|aktifkan|aktifkananggota)/i, '').trim();
    await handleAktifkanAnggota(ctx, q);
    return;
  }

  // === 4. Cek apakah ini perintah slash (misal /pwd, /jojo, /rekap, dll) ===
  if (text.startsWith('/')) {
    const rawCmd = text.slice(1).split(/[\s@]/)[0].toLowerCase();

    // Cek apakah perintah ini cocok dengan nama salah satu buku kegiatan yang ada (contoh: /pwd, /raimuna)
    const books = await getAllSheetBooks();
    const matchedBook = books.find((b) => {
      const bCmd = b.toLowerCase().replace(/[^a-z0-9_]/g, '');
      return bCmd === rawCmd || b.toLowerCase() === rawCmd;
    });

    if (matchedBook) {
      await setUserActiveBook(chatId, matchedBook);
      const isKas = matchedBook.toLowerCase() === DEFAULT_BOOK_NAME.toLowerCase();
      await ctx.reply(
        `📖 *Buku Aktif Diubah ke:* *${matchedBook}* ${isKas ? '(Kas Utama)' : ''}\n\n` +
          `Semua catatan transaksi & foto nota berikutnya akan disimpan ke tab *${matchedBook}*.\n` +
          `• Ketik /rekap untuk melihat rekap buku ini\n` +
          `• Ketik /rekapkas untuk seluruh rekap kas\n` +
          `• Ketik /kas untuk kembali ke Kas Utama`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Perintah yang sudah ditangani bot.command
    const standardCmds = [
      'start',
      'help',
      'buat',
      'pindahsaldo',
      'transfersaldo',
      'pindah',
      'transfer',
      'kas',
      'buku',
      'rekap',
      'recap',
      'rekapkas',
      'recapkas',
      'cekkas',
      'bayarkas',
      'anggota',
      'tambahanggota',
      'nonaktifanggota',
      'nonaktifkananggota',
      'aktifkananggota',
      'nota',
      'debug',
      'akses',
      'aksesbot',
      'kelolaakses',
      'invite',
      'undang',
      'izinkan',
      'approve',
      'cabut',
      'revoke',
      'linkuang',
      'linkweb',
      'dashboard',
      'website',
    ];

    if (!standardCmds.includes(rawCmd)) {
      await ctx.reply(
        '❓ Perintah tidak dikenali.\n' +
          '• Ketik /start untuk melihat menu dan daftar buku\n' +
          '• Ketik /cekkas untuk cek status iuran kas anggota\n' +
          '• Ketik /bayarkas untuk catat bayar kas'
      );
    }
    return;
  }

  // Trigger nota via teks bebas
  if (text.toLowerCase().startsWith('buat nota') || text.toLowerCase() === 'nota') {
    notaStates.set(chatId, { step: 'invoice_no', data: { items: [] } });
    await ctx.reply(
      `📋 *Buat Nota AJP*\n\nMasukkan *No. Invoice:*\n_(contoh: 011/AJP/JJ/2026)_`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Jika pengguna mengetik 'rekapkas' tanpa slash
  if (text.toLowerCase().startsWith('rekapkas') || text.toLowerCase().startsWith('recapkas')) {
    const parts = text.split(' ').slice(1).join(' ').trim();
    await sendRekapKas(ctx, parts);
    return;
  }

  // Jika pengguna mengetik 'rekap' tanpa slash
  if (text.toLowerCase().startsWith('rekap') || text.toLowerCase().startsWith('recap')) {
    const parts = text.split(' ').slice(1).join(' ').trim();
    await sendRekap(ctx, parts);
    return;
  }

  // === 5. Pencatatan Transaksi Normal Berbasis Teks ===
  try {
    await ctx.replyWithChatAction('typing');

    const activeBook = await getUserActiveBook(chatId);
    const parsed = await parseTextMessage(text);

    if (!parsed) {
      await ctx.reply(
        `🤔 Maaf, saya belum mengenali catatan keuangan dari pesan tersebut.\n` +
          `Contoh yang bisa dipahami:\n` +
          `• \`Makan sate 45rb\`\n` +
          `• \`Kemarin ganti oli motor 75.000\`\n` +
          `• \`bayar kas Said Januari\` (untuk iuran anggota)\n` +
          `• Ketik /cekkas untuk cek iuran kas anggota`
      );
      return;
    }

    const senderId = String(ctx.from?.id);
    const senderName = ctx.from?.first_name || 'Pengguna';
    const username = ctx.from?.username ? `@${ctx.from.username}` : '';
    const adminId = getAdminTelegramId();
    const isAdmin = senderId === adminId;

    // Tag PIC di keterangan Google Sheets agar transparan siapa penginputnya
    const picTag = username ? `(PIC: ${username})` : `(PIC: ${senderName})`;
    if (!parsed.description.toLowerCase().includes('pic:')) {
      parsed.description = `${parsed.description} ${picTag}`;
    }

    // Simpan ke sheet buku yang sedang aktif
    await appendTransaction(parsed, activeBook);

    const emoji = parsed.type === 'Pemasukan' ? '🟢' : '🔴';
    await ctx.reply(
      `✅ *Transaksi Berhasil Dicatat!*\n\n` +
        `📖 *Buku:* \`${activeBook}\`\n` +
        `📅 *Tanggal:* ${parsed.date}\n` +
        `${emoji} *Jenis:* ${parsed.type}\n` +
        `📂 *Kategori:* ${parsed.category}\n` +
        `💰 *Nominal:* ${formatRupiah(parsed.amount)}\n` +
        `📝 *Keterangan:* ${parsed.description}`,
      { parse_mode: 'Markdown' }
    );

    // Monitoring realtime: Kirim alert ke Admin jika penginput adalah anggota (bukan Admin sendiri)
    if (!isAdmin) {
      (async () => {
        try {
          const alertMsg =
            `🔔 *Pantauan Transaksi Anggota!*\n\n` +
            `👤 *Penginput:* ${senderName} ${username ? `(${username})` : ''}\n` +
            `🆔 *ID:* \`${senderId}\`\n` +
            `📖 *Buku:* \`${activeBook}\`\n` +
            `📅 *Tanggal:* ${parsed.date}\n` +
            `${emoji} *Jenis:* ${parsed.type} (${formatRupiah(parsed.amount)})\n` +
            `📂 *Kategori:* ${parsed.category}\n` +
            `📝 *Keterangan:* ${parsed.description}`;

          await ctx.api.sendMessage(adminId, alertMsg, { parse_mode: 'Markdown' });
        } catch (adminErr) {
          console.error('Gagal mengirim notifikasi pantauan transaksi ke Admin:', adminErr);
        }
      })();
    }

    // Kirim rekap singkat di background
    (async () => {
      try {
        const summary = await getMonthSummary(undefined, undefined, activeBook);
        const saldoLabel = summary.saldo >= 0 ? '💰 *Sisa:*' : '🔻 *Defisit:*';
        await ctx.reply(
          `━━━━━━━━━━━━━━━━━━━━━\n` +
            `📊 *Rekap Buku [${activeBook}]:*\n` +
            `🟢 Masuk: ${formatRupiah(summary.totalPemasukan)}\n` +
            `🔴 Keluar: ${formatRupiah(summary.totalPengeluaran)}\n` +
            `${saldoLabel} ${formatRupiah(Math.abs(summary.saldo))}`,
          { parse_mode: 'Markdown' }
        );
      } catch {
        // Abaikan jika rekap background gagal
      }
    })();
  } catch (error: any) {
    console.error('Error processing text transaction:', error);
    await ctx.reply(
      `❌ Gagal mencatat transaksi: ${error?.message || 'Terjadi gangguan internal.'}`
    );
  }
});

// Handler: Foto Nota / Struk
bot.on(['message:photo', 'message:document'], async (ctx) => {
  const chatId = ctx.chat.id;

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

    // === Cek jika pengguna sedang dalam mode UNGGAH ULANG foto nota ===
    if (reuploadStates.has(chatId)) {
      const state = reuploadStates.get(chatId)!;
      reuploadStates.delete(chatId);

      await ctx.reply(
        `⏳ *Mengunggah foto nota untuk [${state.description}] ke Google Drive...*`,
        { parse_mode: 'Markdown' }
      );
      await ctx.replyWithChatAction('upload_photo');

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

      const driveLink = await uploadReceiptToDrive(buffer, fileName, mimeType);
      if (driveLink) {
        await updateTransactionNoteLink(state.rowNumber, driveLink, state.bookName);

        const keyboard = new InlineKeyboard()
          .url('🔗 Buka Foto di Drive', driveLink)
          .text('📸 Cek Status Foto', `cekfoto_refresh:${state.bookName}`);

        await ctx.reply(
          `✅ *Foto Nota Berhasil Diunggah Ulang!*\n\n` +
            `📖 *Buku:* \`${state.bookName}\`\n` +
            `📝 *Transaksi:* *${state.description}*\n` +
            `💰 *Nominal:* ${formatRupiah(state.amount)}\n` +
            `📌 *Baris Sheets:* #${state.rowNumber}\n\n` +
            `🔗 [Buka Foto di Google Drive](${driveLink})\n\n` +
            `_Tautan foto otomatis tersimpan di tabel Google Sheets Anda._`,
          {
            parse_mode: 'Markdown',
            reply_markup: keyboard,
            link_preview_options: { is_disabled: true },
          }
        );
      } else {
        await ctx.reply(
          `❌ *Gagal Mengunggah Foto ke Google Drive.*\n\n` +
            `Pastikan koneksi Google Drive Webhook aktif melalui perintah /cekfoto lalu coba kembali.`,
          { parse_mode: 'Markdown' }
        );
      }
      return;
    }

    const activeBook = await getUserActiveBook(chatId);

    await ctx.reply(
      `🔍 *Menganalisis foto nota untuk buku [${activeBook}] & mengunggah ke Google Drive...*`,
      { parse_mode: 'Markdown' }
    );
    await ctx.replyWithChatAction('upload_photo');

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

    // === Cek jika pengguna me-REPLY pesan transaksi lama untuk menautkan foto ===
    const replyMsg = ctx.message.reply_to_message;
    if (replyMsg && (replyMsg.text || replyMsg.caption)) {
      const replyText = replyMsg.text || replyMsg.caption || '';

      const isBotTxMsg =
        replyText.includes('Transaksi Berhasil Dicatat') ||
        replyText.includes('Total Nominal:') ||
        replyText.includes('Item:');

      if (isBotTxMsg) {
        // Ekstrak buku
        const bookMatch = replyText.match(/Buku:\s*`?([^`\n]+)`?/i);
        const targetBook = bookMatch ? bookMatch[1].trim() : activeBook;

        // Ekstrak nominal
        const nominalMatch =
          replyText.match(/Nominal:\s*(?:Rp\s*)?([0-9.,]+)/i) ||
          replyText.match(/\(Rp\s*([0-9.,]+)\)/i);
        const parsedNominal = nominalMatch
          ? parseInt(nominalMatch[1].replace(/[^0-9]/g, ''), 10)
          : undefined;

        // Ekstrak keterangan
        const descMatch =
          replyText.match(/Keterangan:\s*([^\n]+)/i) ||
          replyText.match(/Item:\s*([^\n(]+)/i);
        const parsedDesc = descMatch ? descMatch[1].trim() : undefined;

        // Ekstrak tanggal
        const dateMatch = replyText.match(/Tanggal:\s*([0-9-]+)/i);
        const parsedDate = dateMatch ? dateMatch[1].trim() : undefined;

        await ctx.reply(
          `⏳ *Menautkan foto ke transaksi [${parsedDesc || 'lama'}] di Google Sheets & Drive...*`,
          { parse_mode: 'Markdown' }
        );

        // Cari transaksi yang cocok di Sheets (di targetBook atau buku lain)
        const matchResult = await findMatchingTransactionRowAcrossBooks(targetBook, {
          amount: parsedNominal,
          description: parsedDesc,
          date: parsedDate,
        });

        if (matchResult) {
          const { item: matchingRow, bookName: finalBook } = matchResult;
          const driveLink = await uploadReceiptToDrive(buffer, fileName, mimeType);
          if (driveLink) {
            await updateTransactionNoteLink(matchingRow.rowNumber, driveLink, finalBook);

            const keyboard = new InlineKeyboard()
              .url('📸 Buka Foto di Drive', driveLink)
              .text('📸 Cek Foto Lainnya', `cekfoto_refresh:${finalBook}`);

            await ctx.reply(
              `✅ *Foto Nota Berhasil Ditautkan via Reply!*\n\n` +
                `📖 *Buku Kegiatan:* \`${finalBook}\` _(Tab Sheets: ${finalBook})_\n` +
                `📝 *Transaksi:* *${matchingRow.description}*\n` +
                `💰 *Nominal:* ${formatRupiah(matchingRow.amount)}\n` +
                `📌 *Baris Sheets:* #${matchingRow.rowNumber}\n\n` +
                `🔗 [Buka Foto di Google Drive](${driveLink})\n\n` +
                `_Tautan foto berhasil dicatat di Google Sheets pada tab \`${finalBook}\` Kolom F tanpa membuat transaksi dobel!_`,
              {
                parse_mode: 'Markdown',
                reply_markup: keyboard,
                link_preview_options: { is_disabled: true },
              }
            );
            return;
          } else {
            await ctx.reply(
              `❌ Gagal mengunggah foto ke Google Drive. Cek koneksi via /cekfoto.`,
              { parse_mode: 'Markdown' }
            );
            return;
          }
        }
      }
    }

    // OCR Gemini dan Upload ke Google Drive secara paralel (memangkas waktu 50%)
    const [parsed, driveLink] = await Promise.all([
      parseReceiptImage(buffer, mimeType, ctx.message.caption).catch((err) => {
        console.warn('Gagal parseReceiptImage:', err);
        return null;
      }),
      uploadReceiptToDrive(buffer, fileName, mimeType).catch((uploadErr) => {
        console.error('Error saat upload foto ke Drive:', uploadErr);
        return null;
      }),
    ]);

    if (!parsed) {
      if (driveLink) {
        const keyboard = new InlineKeyboard()
          .url('📸 Buka Foto di Drive', driveLink)
          .text(`📤 Hubungkan Manual`, `reupload_list:${activeBook}`);

        await ctx.reply(
          `📸 *Foto Berhasil Disimpan di Drive!*\n\n` +
            `🔗 [Lihat Foto di Google Drive](${driveLink})\n\n` +
            `⚠️ Foto tidak terdeteksi otomatis sebagai nota belanja/transfer (atau teks buram).\n` +
            `💡 Anda bisa klik tombol di bawah untuk menautkan foto ini ke salah satu transaksi lama.`,
          { parse_mode: 'Markdown', reply_markup: keyboard }
        );
        return;
      }

      await ctx.reply(
        '⚠️ Gambar tidak terdeteksi sebagai nota/struk belanja atau bukti transfer yang valid. Mohon pastikan foto cukup jelas dan mencakup nominal transaksi.'
      );
      return;
    }

    const senderId = String(ctx.from?.id);
    const senderName = ctx.from?.first_name || 'Pengguna';
    const username = ctx.from?.username ? `@${ctx.from.username}` : '';
    const adminId = getAdminTelegramId();
    const isAdmin = senderId === adminId;

    // Tag PIC di keterangan Google Sheets agar jelas siapa penginputnya
    const picTag = username ? `(PIC: ${username})` : `(PIC: ${senderName})`;
    if (!parsed.description.toLowerCase().includes('pic:')) {
      parsed.description = `${parsed.description} ${picTag}`;
    }

    if (driveLink) {
      parsed.noteLink = driveLink;
    }

    // Simpan ke Google Sheets (sudah otomatis menyertakan link Drive di kolom F)
    const rowNumber = await appendTransaction(parsed, activeBook);

    const emoji = parsed.type === 'Pemasukan' ? '🟢' : '🔴';
    const driveStatusText = driveLink
      ? `📎 *Foto Nota:* [Lihat Foto di Google Drive](${driveLink})`
      : `⚠️ *Foto Nota:* _Belum tersimpan di Drive (Ketik /unggahfoto untuk melengkapi)_`;

    const keyboard = new InlineKeyboard();
    if (driveLink) {
      keyboard.url('📸 Buka Foto di Drive', driveLink);
    } else if (rowNumber) {
      keyboard.text('📤 Unggah Ulang Foto Ini', `reupload_pick:${activeBook}:${rowNumber}`);
    }

    await ctx.reply(
      `🧾 *Transaksi Berhasil Dicatat!*\n\n` +
        `📖 *Buku Kegiatan:* \`${activeBook}\` _(Tersimpan di Tab Sheets: ${activeBook})_\n` +
        `📅 *Tanggal:* ${parsed.date}\n` +
        `${emoji} *Jenis:* ${parsed.type}\n` +
        `📂 *Kategori:* ${parsed.category}\n` +
        `💰 *Total Nominal:* ${formatRupiah(parsed.amount)}\n` +
        `📝 *Keterangan:* ${parsed.description}\n\n` +
        `${driveStatusText}\n\n` +
        `💡 _Tips: Jika ingin mencatat transaksi ke buku/tab lain (seperti tab pwd), ketik /pwd atau /buku._`,
      {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
        link_preview_options: { is_disabled: true },
      }
    );

    // Monitoring realtime: Notifikasi ke Admin jika penginput adalah anggota
    if (!isAdmin) {
      try {
        const alertMsg =
          `🧾 *Pantauan Transaksi Nota Anggota!*\n\n` +
          `👤 *Penginput:* ${senderName} ${username ? `(${username})` : ''}\n` +
          `🆔 *ID:* \`${senderId}\`\n` +
          `📖 *Buku:* \`${activeBook}\`\n` +
          `📅 *Tanggal:* ${parsed.date}\n` +
          `${emoji} *Jenis:* ${parsed.type} (${formatRupiah(parsed.amount)})\n` +
          `📂 *Kategori:* ${parsed.category}\n` +
          `📝 *Keterangan:* ${parsed.description}\n` +
          (driveLink ? `📎 [Lihat Foto Nota di Drive](${driveLink})` : `⚠️ _Foto belum tersimpan di Drive_`);

        await ctx.api.sendMessage(adminId, alertMsg, {
          parse_mode: 'Markdown',
          link_preview_options: { is_disabled: true },
        });
      } catch (adminErr) {
        console.error('Gagal mengirim notif awal nota anggota ke Admin:', adminErr);
      }
    }

    // Rekap singkat buku aktif (awaited)
    try {
      const summary = await getMonthSummary(undefined, undefined, activeBook);
      const saldoLabel = summary.saldo >= 0 ? '💰 *Sisa:*' : '🔻 *Defisit:*';
      await ctx.reply(
        `━━━━━━━━━━━━━━━━━━━━━\n` +
          `📊 *Rekap Buku [${activeBook}]:*\n` +
          `🟢 Masuk: ${formatRupiah(summary.totalPemasukan)}\n` +
          `🔴 Keluar: ${formatRupiah(summary.totalPengeluaran)}\n` +
          `${saldoLabel} ${formatRupiah(Math.abs(summary.saldo))}`,
        { parse_mode: 'Markdown' }
      );
    } catch {
      // Abaikan jika rekap background gagal
    }
  } catch (error: any) {
    console.error('Error processing receipt:', error);
    const isRateLimit =
      error?.status === 429 ||
      error?.message?.includes('429') ||
      error?.message?.includes('quota') ||
      error?.message?.includes('Too Many Requests');

    if (isRateLimit) {
      await ctx.reply(
        '⏳ *Batas Kecepatan AI (429)*\n\n' +
          'Google Gemini sedang mencapai batas kuota per menit.\n' +
          'Silakan tunggu sekitar *15-30 detik*, lalu kirim ulang foto Anda ya!',
        { parse_mode: 'Markdown' }
      );
    } else {
      await ctx.reply(
        `❌ Gagal memproses foto: ${error?.message || 'Terjadi kesalahan sistem.'}`
      );
    }
  }
});
