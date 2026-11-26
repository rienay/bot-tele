import { Bot, InputFile, InlineKeyboard } from 'grammy';
import dns from 'dns';
import { google } from 'googleapis';
import { parseTextMessage, parseReceiptImage, parseDocumentSurat, parseMultipleDocumentsSurat, ParsedSurat, getLocalTodayDateString } from './gemini';
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
import {
  getAllInventaris,
  getInventarisStats,
  tambahInventaris,
  cariInventaris,
  generateNextItemCode,
  normalisasiUnit,
  getUnitPrefix,
  DAFTAR_UNIT,
  InventarisItem,
} from './inventaris';
import {
  getAllSurat,
  getSuratStats,
  tambahSurat,
  cariSurat,
  SuratSearchResult,
  SuratItem,
  JenisSurat,
  SHEET_SURAT,
} from './surat';
import { uploadReceiptToDrive, getDriveConfigStatus, testDriveUpload, downloadDriveFile } from './googleDrive';
import { formatPrivateKey, getGoogleAuth } from './googleAuth';
import { generateNotaPdf, HARGA_PER_KG, rupiahFormat } from './generateNota';
import { ExpenseDetail, UserRole } from './types';
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
  getUserRole,
  isUserInventoryOnly,
  isUserAllowedFinance,
  setUserRole,
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

export const WEB_SURAT_URL = 'https://bot-tele-topaz.vercel.app/surat';
export const WEB_INVENTARIS_URL = 'https://bot-tele-topaz.vercel.app/inventaris';

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
// BUFFER: Telegram Media Group (Album foto multi-halaman surat DKC)
// ============================================================
interface MediaGroupSuratItem {
  ctx: any;
  fileId: string;
  fileName: string;
  mimeType: string;
  caption?: string;
}
const mediaGroupSuratMap = new Map<string, {
  chatId: number;
  items: MediaGroupSuratItem[];
  timer: NodeJS.Timeout;
}>();

async function handleMediaGroupFinish(mediaGroupId: string) {
  const group = mediaGroupSuratMap.get(mediaGroupId);
  mediaGroupSuratMap.delete(mediaGroupId);
  if (!group || group.items.length === 0) return;

  const primaryCtx = group.items[0].ctx;
  const groupCaption = group.items.find((it) => it.caption?.trim())?.caption || '';

  const isInventaris =
    groupCaption.startsWith('/tambahbarang') ||
    groupCaption.startsWith('/barang') ||
    /^(unit:|nama:|barang:)/i.test(groupCaption.trim());

  if (isInventaris) {
    const first = group.items[0];
    await handleTambahBarangWithPhoto(primaryCtx, first.fileId, groupCaption, first.mimeType);
    return;
  }

  // Multi-halaman surat resmi DKC (misal 2, 3, atau lebih foto)
  await handleMultipleSuratDocuments(primaryCtx, group.items, groupCaption);
}

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

// State: Sesi pencarian surat via /cari
const cariSuratStates = new Map<number, boolean>();

interface SuratSearchSession {
  query: string;
  results: SuratSearchResult[];
  page?: number;
  timestamp: number;
}
const suratSearchSessions = new Map<number, SuratSearchSession>();

function formatRupiah(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount);
}

function escapeMd(text?: string): string {
  if (!text) return '';
  return text.replace(/([_*`\[\]])/g, '\\$1');
}

function safeUsername(uname?: string): string {
  if (!uname) return '';
  const clean = uname.startsWith('@') ? uname.slice(1) : uname;
  return `@${clean.replace(/([_*`\[\]])/g, '\\$1')}`;
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
      { command: 'inventaris', description: 'Inventaris barang DKC & Unit' },
      { command: 'tambahbarang', description: 'Tambah data barang inventaris baru' },
      { command: 'izinkaninv', description: 'Undang/izinkan anggota (Inv & Surat)' },
      { command: 'akses', description: 'Kelola hak akses & anggota bot' },
      { command: 'invite', description: 'Cara undang anggota baru' },
      { command: 'linkuang', description: 'Link website keuangan transparan' },
      { command: 'linkinventaris', description: 'Link tabel web inventaris barang' },
      { command: 'surat', description: 'Agenda surat masuk & keluar DKC' },
      { command: 'cari', description: 'Cari surat & download berkas Drive' },
      { command: 'linksurat', description: 'Link tabel web persuratan DKC' },
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
  const username = ctx.from?.username || '';

  const accessStatus = await checkUserAccess(senderId);

  if (accessStatus === 'Aktif') {
    await next();
    return;
  }

  if (accessStatus === 'Menunggu') {
    try {
      await ctx.reply(
        `⏳ *Permintaan Akses Sedang Menunggu Persetujuan Admin*\n\n` +
          `Halo *${escapeMd(senderName)}*, permintaan akses untuk akun Anda (ID: \`${senderId}\`) telah dikirimkan ke Admin.\n` +
          `Mohon ditunggu ya! Begitu Admin menekan tombol izinkan, Anda akan otomatis mendapatkan notifikasi di sini. 😊`,
        { parse_mode: 'Markdown' }
      );
    } catch {
      await ctx.reply(
        `⏳ Permintaan Akses Sedang Menunggu Persetujuan Admin\n\n` +
          `Halo ${senderName}, permintaan akses untuk akun Anda (ID: ${senderId}) telah dikirimkan ke Admin.\n` +
          `Mohon ditunggu ya!`
      );
    }
    return;
  }

  if (accessStatus === 'Ditolak' || accessStatus === 'Nonaktif') {
    try {
      await ctx.reply(
        `⛔ *Akses Tidak Diizinkan*\n\n` +
          `Akun Telegram Anda (ID: \`${senderId}\`) saat ini berstatus *${accessStatus}*.\n` +
          `Silakan hubungi Admin jika Anda memerlukan akses kembali ke bot ini.`,
        { parse_mode: 'Markdown' }
      );
    } catch {
      await ctx.reply(
        `⛔ Akses Tidak Diizinkan\n\n` +
          `Akun Telegram Anda (ID: ${senderId}) saat ini berstatus ${accessStatus}.\n` +
          `Silakan hubungi Admin jika Anda memerlukan akses kembali ke bot ini.`
      );
    }
    return;
  }

  // Jika status 'Belum_Ada': Daftarkan permintaan baru dan kirim tombol interaktif ke Admin
  try {
    await registerUserRequest(senderId, senderName, username);
  } catch (err) {
    console.error('Error saat pendaftaran user baru ke Sheet:', err);
  }

  // Beri respon ke calon anggota bahwa permintaan telah dikirim
  try {
    await ctx.reply(
      `⏳ *Permintaan Akses Terkirim!*\n\n` +
        `Halo *${escapeMd(senderName)}*! Bot pencatat keuangan ini bersifat privat.\n` +
        `Permintaan akses Anda telah otomatis diteruskan ke Admin untuk disetujui.\n\n` +
        `Mohon ditunggu sebentar ya! Anda akan otomatis menerima notifikasi di sini begitu akses dibuka oleh Admin. 😊\n\n` +
        `🆔 _ID Telegram Anda:_ \`${senderId}\``,
      { parse_mode: 'Markdown' }
    );
  } catch {
    await ctx.reply(
      `⏳ Permintaan Akses Terkirim!\n\n` +
        `Halo ${senderName}! Bot pencatat keuangan ini bersifat privat.\n` +
        `Permintaan akses Anda telah otomatis diteruskan ke Admin untuk disetujui.\n\n` +
        `Mohon ditunggu sebentar ya! Anda akan otomatis menerima notifikasi di sini begitu akses dibuka oleh Admin. 😊\n\n` +
        `ID Telegram Anda: ${senderId}`
    );
  }

  // Kirim notifikasi ke Admin
  try {
    const adminId = getAdminTelegramId();
    const adminKb = new InlineKeyboard()
      .text('💼 Bendahara (Kas, Inv, Surat)', `user_access:approve:${senderId}:Member`)
      .row()
      .text('👥 Anggota (Inventaris & Surat)', `user_access:approve:${senderId}:Inventaris`)
      .row()
      .text('❌ Tolak', `user_access:reject:${senderId}`);

    const nowJakarta = new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      dateStyle: 'short',
      timeStyle: 'medium',
    }).format(new Date());

    const notifMarkdown =
      `🔔 *Permintaan Akses Anggota Baru!*\n\n` +
      `Ada pengguna baru yang ingin bergabung dan menggunakan bot:\n` +
      `👤 *Nama:* ${escapeMd(senderName)}\n` +
      `🔗 *Username:* ${safeUsername(username) || '_(tidak ada)_'}\n` +
      `🆔 *Telegram ID:* \`${senderId}\`\n` +
      `📅 *Waktu:* ${nowJakarta}\n\n` +
      `Silakan pilih tingkat hak akses untuk pengguna ini:`;

    try {
      await ctx.api.sendMessage(adminId, notifMarkdown, {
        parse_mode: 'Markdown',
        reply_markup: adminKb,
      });
    } catch (mdErr) {
      // Fallback tanpa Markdown jika ada karakter spesial yang membuat parser gagal
      await ctx.api.sendMessage(
        adminId,
        `🔔 Permintaan Akses Anggota Baru!\n\n` +
          `Ada pengguna baru yang ingin bergabung dan menggunakan bot:\n` +
          `Nama: ${senderName}\n` +
          `Username: ${username ? `@${username}` : '(tidak ada)'}\n` +
          `Telegram ID: ${senderId}\n` +
          `Waktu: ${nowJakarta}\n\n` +
          `Silakan pilih tingkat hak akses untuk pengguna ini:`,
        { reply_markup: adminKb }
      );
    }
  } catch (adminErr) {
    console.error('Gagal mengirim notifikasi ke admin:', adminErr);
  }
});

// Helper: Pengecekan izin akses modul keuangan
async function checkFinancePermission(ctx: any): Promise<boolean> {
  const senderId = String(ctx.from?.id);
  const isAllowed = await isUserAllowedFinance(senderId);
  if (!isAllowed) {
    const kb = new InlineKeyboard()
      .text('📦 Inventaris', 'inv_main')
      .text('📑 Persuratan', 'surat_main')
      .row()
      .text('🔍 Cari Surat', 'surat_cari_prompt');
    await ctx.reply(
      `⛔ *Akses Khusus Bendahara:*\n\n` +
        `Fitur pencatatan dan rekap kas/keuangan ini dibatasi khusus untuk *Bendahara / Admin*.\n\n` +
        `✨ *Fitur yang dapat Anda gunakan:*\n` +
        `• 📦 *Inventaris Barang:* /inventaris, /tambahbarang, /linkinventaris\n` +
        `• 📑 *Persuratan DKC:* /surat, /cari, /suratmasuk, /suratkeluar, /linksurat`,
      { parse_mode: 'Markdown', reply_markup: kb }
    );
    return false;
  }
  return true;
}

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

  // Jika user anggota biasa (non-Bendahara), tampilkan menu Inventaris & Persuratan
  const userRole = await getUserRole(senderId || 0);
  if (userRole === 'Inventaris') {
    const memberKeyboard = new InlineKeyboard()
      .text('📦 Inventaris Barang', 'inv_main')
      .text('📑 Arsip Persuratan', 'surat_main')
      .row()
      .text('🔍 Cari Surat Drive', 'surat_cari_prompt')
      .text('➕ Tambah Barang', 'inv_help_add')
      .row()
      .url('🌐 Web Inventaris', WEB_INVENTARIS_URL)
      .url('🌐 Web Persuratan', WEB_SURAT_URL);

    await ctx.reply(
      `👋 *Halo! Selamat Datang di Bot DKC Cilacap.*\n\n` +
        `Akun Anda terdaftar sebagai *Anggota DKC Cilacap*.\n` +
        `Anda dapat mengakses modul *Inventaris Logistik* dan *Persuratan Resmi*.\n\n` +
        `📦 *Menu Inventaris Barang:*\n` +
        `• /inventaris — Lihat dan cari data barang per unit (DKC, CYJI, Paspanca, Ubaloka, UNPASA)\n` +
        `• /tambahbarang — Tambah barang baru (bisa langsung kirim foto barang)\n` +
        `• /linkinventaris — Buka tabel inventaris lengkap di website\n\n` +
        `📑 *Menu Persuratan DKC:*\n` +
        `• /surat — Menu & ringkasan agenda surat masuk/keluar\n` +
        `• /cari [kata kunci] — Cari & download berkas surat di Drive (contoh: \`/cari surat ijin orang tua\`, atau ketik \`/cari semua\`)\n` +
        `• /suratmasuk — Catat & lihat daftar surat masuk\n` +
        `• /suratkeluar — Catat & lihat daftar surat keluar\n` +
        `• /linksurat — Buka tabel agenda surat resmi di website\n\n` +
        `💡 *Upload Cepat via Foto/Dokumen:*\n` +
        `• Kirim foto barang + format teks untuk input inventaris\n` +
        `• Kirim file PDF/Word/foto surat untuk arsip otomatis\n\n` +
        `ℹ️ _Catatan: Pembukuan dan rekap kas keuangan dibatasi khusus untuk Bendahara / Admin._\n\n` +
        `🆔 _ID Telegram Anda: \`${senderId}\`_`,
      {
        parse_mode: 'Markdown',
        reply_markup: memberKeyboard,
      }
    );
    return;
  }

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
      `• /izinkaninv <ID> [Nama] — *Undang khusus inventaris saja*\n` +
      `• /izinkan <ID> [Nama] — Izinkan akses anggota (Full)\n` +
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
      `📦 *Menu Inventaris Barang:*\n` +
      `• /inventaris — *Inventaris Logistik* (DKC, CYJI, Paspanca, Ubaloka, UNPASA)\n` +
      `• /tambahbarang — *Tambah Barang Baru* (kode otomatis D0001, C0001, dst)\n` +
      `• /linkinventaris — *Tabel Web Inventaris* (tampilan tabel Word putih-biru)\n\n` +
      `📑 *Menu Persuratan DKC Cilacap:*\n` +
      `• /surat — *Arsip Persuratan* (Surat Masuk & Surat Keluar)\n` +
      `• /cari [kata kunci] — *Cari Surat & Download Berkas* (contoh: \`/cari surat ijin orang tua\`)\n` +
      `• /suratmasuk — *Daftar Surat Masuk* terbaru\n` +
      `• /suratkeluar — *Daftar Surat Keluar* terbaru\n` +
      `• /linksurat — *Tabel Web Persuratan* (agenda surat resmi DKC)\n` +
      `• _Kirim foto dokumen, berkas PDF, atau Word (.docx) untuk auto-catat AI!_\n\n` +
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
  if (!(await checkFinancePermission(ctx))) return;
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
  if (!(await checkFinancePermission(ctx))) return;
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
  if (!(await checkFinancePermission(ctx))) return;
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
  if (!(await checkFinancePermission(ctx))) return;
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

// Callback: Persetujuan akses anggota baru oleh Admin (Full / Khusus Inventaris)
bot.callbackQuery(/^user_access:approve:([^:]+)(?::([^:]+))?$/, async (ctx) => {
  const targetId = ctx.match[1];
  const chosenRole = (ctx.match[2] as UserRole) || 'Member';
  const adminId = String(ctx.from?.id);
  const isAdmin = await isUserAdmin(adminId);

  if (!isAdmin) {
    await ctx.answerCallbackQuery({ text: '⛔ Hanya Admin yang dapat menyetujui akses!', show_alert: true });
    return;
  }

  try {
    await approveUser(targetId, undefined, undefined, chosenRole);
    const roleTitle = chosenRole === 'Inventaris' ? 'Anggota (Inventaris & Surat)' : 'Bendahara / Full (Semua Fitur)';
    await ctx.answerCallbackQuery({ text: `✅ Akses disetujui: ${roleTitle}` });

    const targetUser = await getUserRecord(targetId);
    const targetName = targetUser?.name || 'Anggota';
    const targetUname = targetUser?.username ? `(${safeUsername(targetUser.username)})` : '';

    try {
      await ctx.editMessageText(
        `✅ *Akses Berhasil Disetujui!*\n\n` +
          `👤 *Nama:* ${escapeMd(targetName)} ${targetUname}\n` +
          `🆔 *Telegram ID:* \`${targetId}\`\n` +
          `Peran: *${roleTitle}*\n\n` +
          (chosenRole === 'Inventaris'
            ? `Pengguna ini memiliki hak akses ke modul Inventaris Barang dan Persuratan DKC (fitur kas & keuangan dibatasi untuk Bendahara).`
            : `Pengguna memiliki hak akses penuh termasuk pembukuan kas & keuangan, inventaris, dan persuratan.`),
        { parse_mode: 'Markdown' }
      );
    } catch {}

    // Kirim notifikasi ke anggota yang disetujui
    if (chosenRole === 'Inventaris') {
      try {
        await ctx.api.sendMessage(
          targetId,
          `🎉 *Selamat! Akses Anda Telah Disetujui Admin!* 🚀\n\n` +
            `Halo *${escapeMd(targetName)}*, akun Anda telah aktif sebagai *Anggota DKC Cilacap*.\n\n` +
            `✨ *Fitur yang dapat Anda gunakan:*\n` +
            `• 📦 *Inventaris:* /inventaris, /tambahbarang, /linkinventaris\n` +
            `• 📑 *Persuratan:* /surat, /cari, /suratmasuk, /suratkeluar, /linksurat\n\n` +
            `Ketik /start untuk membuka menu bot.`,
          { parse_mode: 'Markdown' }
        );
      } catch {
        await ctx.api.sendMessage(
          targetId,
          `🎉 Selamat! Akses Anda Telah Disetujui Admin! 🚀\n\n` +
            `Halo ${targetName}, akun Anda telah aktif sebagai Anggota DKC Cilacap (Inventaris & Surat).\n\n` +
            `Ketik /start untuk membuka menu bot.`
        ).catch(() => {});
      }
    } else {
      try {
        await ctx.api.sendMessage(
          targetId,
          `🎉 *Selamat! Akses Anda Telah Disetujui Admin sebagai Bendahara!* 💼\n\n` +
            `Halo *${escapeMd(targetName)}*, Anda memiliki akses penuh mencakup pencatatan keuangan/kas, inventaris, dan persuratan.\n\n` +
            `💡 *Cara Cepat Mencatat Keuangan:*\n` +
            `• Kirim teks biasa: \`makan siang 35rb\`, \`beli bensin 50rb\`\n` +
            `• Kirim foto struk/nota belanja: otomatis dibaca AI!\n` +
            `• Ketik /start untuk melihat menu buku kas dan fitur lainnya.`,
          { parse_mode: 'Markdown' }
        );
      } catch {
        await ctx.api.sendMessage(
          targetId,
          `🎉 Selamat! Akses Anda Telah Disetujui Admin! 🚀\n\n` +
            `Halo ${targetName}, sekarang Anda sudah dapat menggunakan bot ini untuk mencatat keuangan & kas.\n\n` +
            `Ketik /start untuk melihat menu buku kas dan fitur lainnya.`
        ).catch(() => {});
      }
    }
  } catch (error: any) {
    console.error('Error approving user:', error);
    await ctx.answerCallbackQuery({ text: `Gagal: ${error?.message || 'Error internal'}`, show_alert: true });
  }
});

// Callback: Mengubah peran anggota (Full / Khusus Inventaris)
bot.callbackQuery(/^user_access:setrole:([^:]+):([^:]+)$/, async (ctx) => {
  const targetId = ctx.match[1];
  const newRole = ctx.match[2] as UserRole;
  const adminId = String(ctx.from?.id);
  const isAdmin = await isUserAdmin(adminId);

  if (!isAdmin) {
    await ctx.answerCallbackQuery({ text: '⛔ Hanya Admin yang dapat mengubah hak akses!', show_alert: true });
    return;
  }

  try {
    await setUserRole(targetId, newRole);
    const roleName = newRole === 'Inventaris' ? 'Anggota (Inventaris & Surat)' : 'Bendahara / Full (Semua Fitur)';
    await ctx.answerCallbackQuery({ text: `✅ Peran diubah ke: ${roleName}` });

    const targetUser = await getUserRecord(targetId);
    const targetName = targetUser?.name || 'Anggota';

    try {
      await ctx.editMessageText(
        `✅ *Peran Anggota Berhasil Diperbarui!*\n\n` +
          `👤 *Nama:* ${targetName}\n` +
          `🆔 *Telegram ID:* \`${targetId}\`\n` +
          `Peran Baru: *${roleName}*\n\n` +
          `Ketik /akses untuk melihat daftar anggota kembali.`,
        { parse_mode: 'Markdown' }
      );
    } catch {}

    // Kirim notifikasi ke anggota
    if (newRole === 'Inventaris') {
      await ctx.api.sendMessage(
        targetId,
        `ℹ️ *Pemberitahuan Hak Akses:*\nAkun Anda disetel sebagai *Anggota (Inventaris & Persuratan)*.\nAnda dapat mengakses /inventaris, /tambahbarang, /surat, dan /cari surat.`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    } else {
      await ctx.api.sendMessage(
        targetId,
        `ℹ️ *Pemberitahuan Hak Akses:*\nAkun Anda sekarang memiliki akses *Bendahara / Full*.\nAnda dapat mengelola pencatatan kas/keuangan, rekap, inventaris, dan persuratan.`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    }
  } catch (err: any) {
    await ctx.answerCallbackQuery({ text: `Gagal: ${err?.message || 'Error internal'}`, show_alert: true });
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
      const roleLabel = u.role === 'Inventaris' ? '👥 Anggota (Inv & Surat)' : '💼 Bendahara (Kas, Inv, Surat)';
      const uSafe = u.username ? `(${safeUsername(u.username)})` : '';
      text += `${i + 1}. *${escapeMd(u.name)}* ${uSafe} — \`${u.id}\`\n   Peran: _${roleLabel}_\n`;
      if (u.role === 'Inventaris') {
        keyboard
          .text(`💼 Jadikan Bendahara`, `user_access:setrole:${u.id}:Member`)
          .text(`❌ Cabut`, `user_access:revoke:${u.id}`)
          .row();
      } else {
        keyboard
          .text(`👥 Jadikan Anggota`, `user_access:setrole:${u.id}:Inventaris`)
          .text(`❌ Cabut`, `user_access:revoke:${u.id}`)
          .row();
      }
    });
    text += `\n`;
  } else {
    text += `👥 *Anggota Aktif:* _(Belum ada anggota luar yang diizinkan)_\n\n`;
  }

  if (pendingMembers.length > 0) {
    text += `⏳ *Menunggu Persetujuan (${pendingMembers.length}):*\n`;
    pendingMembers.forEach((u, i) => {
      const uSafe = u.username ? `(${safeUsername(u.username)})` : '';
      text += `${i + 1}. *${escapeMd(u.name)}* ${uSafe} — \`${u.id}\`\n`;
      keyboard
        .text(`💼 Bendahara`, `user_access:approve:${u.id}:Member`)
        .text(`👥 Anggota (Inv & Surat)`, `user_access:approve:${u.id}:Inventaris`)
        .text(`❌ Tolak`, `user_access:reject:${u.id}`)
        .row();
    });
    text += `\n`;
  }

  if (inactiveMembers.length > 0) {
    text += `🚫 *Nonaktif / Ditolak (${inactiveMembers.length}):*\n`;
    inactiveMembers.forEach((u, i) => {
      text += `${i + 1}. ${escapeMd(u.name)} — \`${u.id}\` (${u.status})\n`;
      keyboard
        .text(`💼 Pulihkan (Bendahara)`, `user_access:approve:${u.id}:Member`)
        .text(`👥 Pulihkan (Anggota)`, `user_access:approve:${u.id}:Inventaris`)
        .row();
    });
    text += `\n`;
  }

  text += `💡 *Perintah Cepat Admin:*\n` +
    `• Ketik /invite untuk petunjuk mengundang teman\n` +
    `• Ketik \`/izinkaninv <ID> [Nama]\` — Izinkan *Anggota (Inventaris & Surat)*\n` +
    `• Ketik \`/izinkan <ID> [Nama]\` — Izinkan *Bendahara / Full*\n` +
    `• Ketik \`/cabut <ID>\` — Cabut akses manual`;

  try {
    await ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  } catch {
    // Fallback teks polos jika ada karakter khusus tak terduga
    await ctx.reply(
      text.replace(/[*_`]/g, ''),
      { reply_markup: keyboard }
    );
  }
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
      `   Kirimkan link bot ini ke rekan Anda:\n` +
      `   👉 ${link}\n\n` +
      `2. *Teman Menekan Tombol /start:*\n` +
      `   Minta rekan Anda membuka bot tersebut lalu klik tombol *Start*.\n\n` +
      `3. *Persetujuan Realtime (Pilih Hak Akses):*\n` +
      `   Bot akan otomatis mengirimkan notifikasi ke chat Anda ini dengan pilihan:\n` +
      `   • [ 💼 *Bendahara (Kas, Inv, Surat)* ] — Full akses termasuk pencatatan kas & rekap\n` +
      `   • [ 👥 *Anggota (Inventaris & Surat)* ] — Akses modul inventaris barang & persuratan DKC\n` +
      `   • [ ❌ *Tolak* ]\n\n` +
      `4. *Atau Izinkan Manual Langsung (Tanpa Tunggu Rekan Chat):*\n` +
      `   • *Anggota (Inventaris & Surat):*\n` +
      `     \`/izinkaninv <ID_Telegram> [Nama]\`\n` +
      `     _Contoh:_ \`/izinkaninv 12345678 Oki\`\n\n` +
      `   • *Bendahara / Full (Semua Fitur):*\n` +
      `     \`/izinkan <ID_Telegram> [Nama]\`\n` +
      `     _Contoh:_ \`/izinkan 12345678 Sulis\``,
    { parse_mode: 'Markdown', link_preview_options: { is_disabled: true } }
  );
});

// Command: /izinkaninv (Undang / izinkan anggota modul inventaris & surat)
bot.command(['izinkaninv', 'approveinv', 'undanginv', 'inviteinv'], async (ctx) => {
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
      `💡 *Format Mengundang Anggota (Inventaris & Surat):*\n` +
        `\`/izinkaninv <ID_Telegram> [Nama]\`\n\n` +
        `Contoh:\n` +
        `\`/izinkaninv 12345678 Oki\`\n\n` +
        `_Pengguna akan memiliki akses ke modul Inventaris & Persuratan DKC (fitur kas dibatasi untuk Bendahara)._`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  try {
    await approveUser(targetId, targetName, undefined, 'Inventaris');
    await ctx.reply(
      `✅ *Berhasil!* Pengguna *${targetName}* (\`${targetId}\`) telah diberikan izin akses *Anggota (Inventaris & Surat)*.\n\n` +
        `📌 Akun ini dapat mengelola inventaris dan persuratan resmi DKC (fitur kas keuangan dibatasi untuk Bendahara).`,
      { parse_mode: 'Markdown' }
    );

    await ctx.api.sendMessage(
      targetId,
      `🎉 *Selamat! Akun Anda telah diizinkan oleh Admin.* 🚀\n\n` +
        `Anda didaftarkan sebagai *Anggota DKC Cilacap*.\n\n` +
        `📋 *Fitur yang dapat Anda gunakan:*\n` +
        `• /inventaris — Lihat dan cari data barang logistik\n` +
        `• /tambahbarang — Tambah barang baru\n` +
        `• /surat — Agenda persuratan resmi DKC\n` +
        `• /cari — Cari & download berkas surat di Drive\n\n` +
        `Ketik /start untuk membuka menu lengkap.`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  } catch (err: any) {
    await ctx.reply(`❌ Gagal memberikan izin anggota: ${err?.message || 'Error internal'}`);
  }
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

  if (!targetId || !/^\d+$/.test(targetId)) {
    await ctx.reply(
      `💡 *Format Perintah:*\n` +
        `• Bendahara / Full: \`/izinkan <ID_Telegram> [Nama]\`\n` +
        `• Anggota (Inv & Surat): \`/izinkaninv <ID_Telegram> [Nama]\`\n\n` +
        `Contoh: \`/izinkan 12345678 Sulis\``,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const lastPart = parts[parts.length - 1]?.toLowerCase();
  const isInv = lastPart === 'inv' || lastPart === 'inventaris';
  const role: UserRole = isInv ? 'Inventaris' : 'Member';
  const targetName = isInv
    ? parts.slice(1, -1).join(' ').trim() || 'Anggota'
    : parts.slice(1).join(' ').trim() || 'Bendahara';

  try {
    await approveUser(targetId, targetName, undefined, role);
    const roleDesc = role === 'Inventaris' ? 'Anggota (Inventaris & Surat)' : 'Bendahara / Full (Semua Fitur)';
    await ctx.reply(
      `✅ *Berhasil!* Pengguna *${targetName}* (\`${targetId}\`) telah diberikan izin akses *${roleDesc}*.`,
      { parse_mode: 'Markdown' }
    );

    if (role === 'Inventaris') {
      await ctx.api.sendMessage(
        targetId,
        `🎉 *Selamat! Akun Anda telah diizinkan oleh Admin.* 🚀\n\n` +
          `Anda didaftarkan sebagai *Anggota DKC Cilacap*.\n\n` +
          `📋 *Fitur yang dapat Anda gunakan:*\n` +
          `• /inventaris — Kelola inventaris barang\n` +
          `• /surat — Kelola & cari arsip persuratan\n\n` +
          `Ketik /start untuk membuka menu.`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    } else {
      await ctx.api.sendMessage(
        targetId,
        `🎉 *Selamat! Akun Anda telah diizinkan oleh Admin sebagai Bendahara.* 💼\n\nSekarang Anda dapat menggunakan bot ini untuk mencatat kas, pembukuan keuangan, inventaris, dan persuratan.\nKetik /start untuk memulai.`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    }
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
  if (!(await checkFinancePermission(ctx))) return;
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

// Command: /kodeakses (Melihat kode akses web Ini Sanggar)
bot.command(['kodeakses', 'aksesweb'], async (ctx) => {
  const senderId = String(ctx.from?.id || '');
  const allowedFinance = senderId ? await isUserAllowedFinance(senderId) : false;
  const adminId = getAdminTelegramId();
  const isAdmin = senderId === adminId;

  const codeBendahara = (process.env.WEB_ACCESS_BENDAHARA || 'bendahara').split(',')[0].trim();
  const codeDkc = (process.env.WEB_ACCESS_DKC || 'dkc').split(',')[0].trim();
  const codeCyber = (process.env.WEB_ACCESS_CYBER || 'cyber').split(',')[0].trim();
  const codePaspanca = (process.env.WEB_ACCESS_PASPANCA || 'paspanca').split(',')[0].trim();
  const codeUbaloka = (process.env.WEB_ACCESS_UBALOKA || 'ubaloka').split(',')[0].trim();
  const codeUnpasa = (process.env.WEB_ACCESS_UNPASA || 'unpasa').split(',')[0].trim();

  const lines: string[] = [
    `🔐 *Kode Akses Web Ini Sanggar*`,
    `🌐 Link: https://bot-tele-topaz.vercel.app`,
    ``,
  ];

  if (isAdmin || allowedFinance) {
    lines.push(`• 🔵 *Bendahara (Keuangan):* \`${codeBendahara}\``);
  }
  lines.push(`• 🟢 *DKC (Inventaris & Surat):* \`${codeDkc}\``);
  lines.push(`• 🔷 *Unit Cyber:* \`${codeCyber}\``);
  lines.push(`• 🔴 *Unit Paspanca:* \`${codePaspanca}\``);
  lines.push(`• 🟠 *Unit Ubaloka:* \`${codeUbaloka}\``);
  lines.push(`• 🟡 *Unit UNPASA:* \`${codeUnpasa}\``);
  lines.push(``);
  lines.push(`_Jangan bagikan kode akses Bendahara ke pihak yang tidak berkepentingan._`);

  await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
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
  if (!(await checkFinancePermission(ctx))) return;
  const text = ctx.message?.text || '';
  const parts = text.split(' ').slice(1).join(' ').trim();
  await sendRekap(ctx, parts);
});

// Command: /rekapkas (Rekap total seluruh kas dan semua kegiatan)
bot.command(['rekapkas', 'recapkas'], async (ctx) => {
  if (!(await checkFinancePermission(ctx))) return;
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
  if (!(await checkFinancePermission(ctx))) return;
  const text = ctx.message?.text || '';
  const parts = text.split(' ').slice(1).join(' ').trim();
  await handleCekFoto(ctx, parts || undefined);
});

// Command: /unggahfoto (atau /unggahulang)
bot.command(['unggahfoto', 'unggahulang', 'reupload', 'uploadfoto'], async (ctx) => {
  if (!(await checkFinancePermission(ctx))) return;
  const text = ctx.message?.text || '';
  const parts = text.split(' ').slice(1).join(' ').trim();
  await handlePilihUnggahUlang(ctx, parts || undefined);
});

// Command Kas Anggota
bot.command('cekkas', async (ctx) => {
  if (!(await checkFinancePermission(ctx))) return;
  const text = ctx.message?.text || '';
  const parts = text.split(' ').slice(1).join(' ').trim();
  await handleCekKas(ctx, parts);
});

bot.command('bayarkas', async (ctx) => {
  if (!(await checkFinancePermission(ctx))) return;
  const text = ctx.message?.text || '';
  const parts = text.split(' ').slice(1).join(' ').trim();
  await handleBayarKas(ctx, parts);
});

bot.command('anggota', async (ctx) => {
  if (!(await checkFinancePermission(ctx))) return;
  await handleDaftarAnggota(ctx);
});

bot.command('tambahanggota', async (ctx) => {
  if (!(await checkFinancePermission(ctx))) return;
  const text = ctx.message?.text || '';
  const parts = text.split(' ').slice(1).join(' ').trim();
  await handleTambahAnggota(ctx, parts);
});

bot.command(['nonaktifanggota', 'nonaktifkananggota'], async (ctx) => {
  if (!(await checkFinancePermission(ctx))) return;
  const text = ctx.message?.text || '';
  const parts = text.split(' ').slice(1).join(' ').trim();
  await handleNonaktifAnggota(ctx, parts);
});

bot.command('aktifkananggota', async (ctx) => {
  if (!(await checkFinancePermission(ctx))) return;
  const text = ctx.message?.text || '';
  const parts = text.split(' ').slice(1).join(' ').trim();
  await handleAktifkanAnggota(ctx, parts);
});

// Command: /pindahsaldo (dan alias)
bot.command(['pindahsaldo', 'transfersaldo', 'pindah', 'transfer'], async (ctx) => {
  if (!(await checkFinancePermission(ctx))) return;
  const text = ctx.message?.text || '';
  const parts = text.split(' ').slice(1).join(' ').trim();
  await handleStartPindahSaldo(ctx, parts);
});

// ============================================================
// MODUL INVENTARISASI LOGISTIK (DKC, CYJI, Paspanca, Ubaloka, UNPASA)
// ============================================================

/**
 * Parsing teks format formulir penambahan barang inventaris
 */
function parseInventarisText(text: string) {
  const getField = (regex: RegExp) => {
    const m = text.match(regex);
    return m ? m[1].trim() : '';
  };

  const rawUnit = getField(/(?:Unit|Bagian|Penyelenggara):\s*([^\n]+)/i) || 'DKC';
  const unit = normalisasiUnit(rawUnit);
  const nama = getField(/(?:Nama|Nama Barang|Barang|Item):\s*([^\n]+)/i);
  const jumlah = getField(/(?:Jumlah|Qty|Banyaknya):\s*([^\n]+)/i) || '1';
  const tahun = getField(/(?:Tahun|Thn):\s*([0-9]{4})/i) || String(new Date().getFullYear());
  const sumber = getField(/(?:Sumber|Sumber Barang|Asal|Dari):\s*([^\n]+)/i) || 'Pembelian Kas';
  const kondisi = getField(/(?:Kondisi|Status):\s*([^\n]+)/i) || 'Baik';
  const keterangan = getField(/(?:Keterangan|Ket|Catatan|Lokasi):\s*([^\n]+)/i) || '-';

  return { unit, nama, jumlah, tahun, sumber, kondisi, keterangan };
}

/**
 * Menampilkan ringkasan atau rincian inventaris barang per unit
 */
async function handleInventaris(ctx: any, filterParam?: string) {
  const q = filterParam?.trim();

  // Jika parameter merupakan nama unit yang valid
  if (q && ['dkc', 'cyji', 'paspanca', 'ubaloka', 'unpasa', 'protokol', 'jurnalis'].includes(q.toLowerCase())) {
    const unitNorm = normalisasiUnit(q);
    const items = await getAllInventaris(unitNorm);
    const unitConfig = DAFTAR_UNIT.find((u) => u.id === unitNorm);
    const unitName = unitConfig?.name || unitNorm;
    const prefix = unitConfig?.prefix || 'D';

    if (items.length === 0) {
      const keyboard = new InlineKeyboard()
        .text('⬅️ Semua Unit', 'inv_main')
        .text('➕ Tambah Barang', `inv_add:${unitNorm}`)
        .row()
        .url('🌐 Buka Tabel Web', WEB_INVENTARIS_URL);

      await ctx.reply(
        `📦 *Daftar Inventaris: ${unitName}*\n` +
          `🏷️ *Prefix Kode:* \`${prefix}0001+\`\n\n` +
          `_Belum ada barang yang tercatat untuk unit ${unitName}._\n\n` +
          `💡 Ketik /tambahbarang untuk mendata barang baru!`,
        { parse_mode: 'Markdown', reply_markup: keyboard }
      );
      return;
    }

    let textList =
      `📦 *Daftar Inventaris: ${unitName}*\n` +
      `🏷️ *Prefix Kode:* \`${prefix}0001+\` | Total: *${items.length} Barang*\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n\n`;

    items.slice(0, 15).forEach((it, idx) => {
      const isBaik = it.kondisi.toLowerCase().includes('baik');
      const iconKondisi = isBaik ? '🟢' : '🔴';
      const fotoText = it.foto ? ` | 📎 [Foto Drive](${it.foto})` : '';

      textList +=
        `*${idx + 1}.* \`${it.kodeBarang}\` — *${it.namaBarang}*\n` +
        `   • Jumlah: *${it.jumlah}* | Thn: ${it.tahun}\n` +
        `   • Sumber: ${it.sumber}\n` +
        `   • Kondisi: ${iconKondisi} *${it.kondisi}*${fotoText}\n` +
        `   • Lokasi/Ket: _${it.keterangan || '-' }_\n\n`;
    });

    if (items.length > 15) {
      textList += `_...dan ${items.length - 15} barang lainnya. Lihat seluruhnya di website._\n\n`;
    }

    const keyboard = new InlineKeyboard()
      .text('⬅️ Semua Unit', 'inv_main')
      .text('➕ Tambah Barang', `inv_add:${unitNorm}`)
      .row()
      .url('🌐 Buka Tabel Web Inventaris', WEB_INVENTARIS_URL);

    await ctx.reply(textList, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
      link_preview_options: { is_disabled: true },
    });
    return;
  }

  // Jika query pencarian bebas (misal: /barang tenda atau /inventaris D0001)
  if (q) {
    const searchResults = await cariInventaris(q);
    if (searchResults.length === 0) {
      await ctx.reply(`⚠️ Tidak ditemukan barang inventaris dengan kata kunci *"${q}"*.`);
      return;
    }

    let textRes =
      `🔍 *Hasil Pencarian Inventaris: "${q}"*\n` +
      `Ditemukan *${searchResults.length} barang*:\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n\n`;

    searchResults.slice(0, 10).forEach((it, idx) => {
      const isBaik = it.kondisi.toLowerCase().includes('baik');
      const iconKondisi = isBaik ? '🟢' : '🔴';
      const fotoText = it.foto ? ` | 📎 [Foto Drive](${it.foto})` : '';

      textRes +=
        `*${idx + 1}.* \`${it.kodeBarang}\` — *${it.namaBarang}* (${it.unit})\n` +
        `   • Jumlah: *${it.jumlah}* | Thn: ${it.tahun} | ${iconKondisi} ${it.kondisi}${fotoText}\n` +
        `   • Ket: _${it.keterangan || '-' }_\n\n`;
    });

    const keyboard = new InlineKeyboard()
      .text('⬅️ Menu Inventaris', 'inv_main')
      .url('🌐 Buka Tabel Web', WEB_INVENTARIS_URL);

    await ctx.reply(textRes, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
      link_preview_options: { is_disabled: true },
    });
    return;
  }

  // Tampilkan ringkasan seluruh unit
  const [stats, items] = await Promise.all([
    getInventarisStats(),
    getAllInventaris(),
  ]);

  let unitsText = '';
  for (const u of DAFTAR_UNIT) {
    const dataU = stats.byUnit[u.id] || { count: 0, totalQty: 0 };
    unitsText += `• *${u.name}* (Kode \`${u.prefix}0001+\`): *${dataU.count} Jenis* (${dataU.totalQty} unit fisik)\n`;
  }

  const keyboard = new InlineKeyboard()
    .text('🏛️ DKC (D)', 'inv_unit:DKC')
    .text('📰 CYJI (C)', 'inv_unit:CYJI')
    .row()
    .text('🛡️ Paspanca (PS)', 'inv_unit:Paspanca')
    .text('🚨 Ubaloka (U)', 'inv_unit:Ubaloka')
    .row()
    .text('🎖️ UNPASA (P)', 'inv_unit:UNPASA')
    .text('➕ Tambah Barang', 'inv_help_add')
    .row()
    .url('🌐 Buka Tabel Web Inventaris', WEB_INVENTARIS_URL)
    .text('🔄 Refresh', 'inv_main');

  await ctx.reply(
    `📦 *SISTEM INVENTARISASI BARANG LOGISTIK*\n` +
      `*Kwarcab 11.01 Cilacap*\n\n` +
      `📊 *Ringkasan Seluruh Unit:*\n` +
      unitsText + `\n` +
      `📈 *Total Inventaris:* *${items.length} Jenis Barang* (${stats.totalQuantity} unit fisik)\n` +
      `🟢 Kondisi Baik: *${stats.byKondisi.Baik || 0}*\n` +
      `🔴 Rusak / Perbaikan: *${(stats.byKondisi['Rusak Ringan'] || 0) + (stats.byKondisi['Rusak Berat'] || 0)}*\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `👇 *Pilih unit di bawah untuk melihat rincian barang:*`,
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
}

/**
 * Menangani penambahan barang inventaris lewat teks
 */
async function handleTambahBarang(ctx: any, textParam: string) {
  const parsed = parseInventarisText(textParam);

  if (!parsed.nama) {
    await ctx.reply(
      `➕ *Formulir Tambah Barang Inventaris*\n\n` +
        `Anda dapat mencatat barang inventaris baru dengan mengirimkan format berikut:\n\n` +
        `\`\`\`\n` +
        `/tambahbarang\n` +
        `Unit: DKC\n` +
        `Nama: Tenda Dome Kapasitas 4 Orang\n` +
        `Jumlah: 2 Unit\n` +
        `Tahun: 2024\n` +
        `Sumber: Hibah Kwarcab\n` +
        `Kondisi: Baik\n` +
        `Keterangan: Lemari logistik\n` +
        `\`\`\`\n\n` +
        `💡 *Pilihan Unit & Kode Otomatis:*\n` +
        `• *DKC* ➔ Prefix \`D0001, D0002...\`\n` +
        `• *CYJI* ➔ Prefix \`C0001, C0002...\`\n` +
        `• *Paspanca* ➔ Prefix \`PS0001, PS0002...\`\n` +
        `• *Ubaloka* ➔ Prefix \`U0001, U0002...\`\n` +
        `• *UNPASA* ➔ Prefix \`P0001, P0002...\`\n\n` +
        `📸 *Bisa juga kirim FOTO BARANG* lalu beri caption dengan format di atas, foto akan otomatis tersimpan ke Google Drive!\n\n` +
        `🌐 _Atau gunakan formulir web langsung di:_ ${WEB_INVENTARIS_URL}`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const itemCode = await generateNextItemCode(parsed.unit);
  const newItem = await tambahInventaris({
    kodeBarang: itemCode,
    namaBarang: parsed.nama,
    unit: parsed.unit,
    jumlah: parsed.jumlah,
    tahun: parsed.tahun,
    sumber: parsed.sumber,
    kondisi: parsed.kondisi,
    foto: '',
    keterangan: parsed.keterangan,
  });

  const keyboard = new InlineKeyboard()
    .text(`📦 Lihat Barang ${parsed.unit}`, `inv_unit:${parsed.unit}`)
    .url('🌐 Buka Tabel Web', WEB_INVENTARIS_URL);

  await ctx.reply(
    `✅ *Barang Inventaris Berhasil Dicatat!*\n\n` +
      `🏷️ *Kode Barang:* \`${newItem.kodeBarang}\`\n` +
      `📦 *Nama Barang:* *${newItem.namaBarang}*\n` +
      `🏛️ *Unit:* ${newItem.unit}\n` +
      `🔢 *Jumlah:* ${newItem.jumlah}\n` +
      `📅 *Tahun:* ${newItem.tahun}\n` +
      `💰 *Sumber:* ${newItem.sumber}\n` +
      `🟢 *Kondisi:* ${newItem.kondisi}\n` +
      `📍 *Keterangan:* ${newItem.keterangan}\n\n` +
      `_Data tersimpan otomatis di Google Sheets tab \`Inventaris\` dan langsung tampil di website._`,
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
}

/**
 * Menangani penambahan barang inventaris saat pengguna mengirim foto dengan caption
 */
async function handleTambahBarangWithPhoto(
  ctx: any,
  fileId: string,
  caption: string,
  mimeType: string = 'image/jpeg'
) {
  const parsed = parseInventarisText(caption);

  if (!parsed.nama) {
    await ctx.reply(
      `⚠️ *Nama barang belum dicantumkan!*\n\n` +
        `Silakan kirim ulang foto dengan caption format:\n\n` +
        `\`\`\`\n` +
        `/tambahbarang\n` +
        `Unit: DKC\n` +
        `Nama: Nama Barang Anda\n` +
        `Jumlah: 1 Unit\n` +
        `Tahun: 2024\n` +
        `Sumber: Pembelian Kas\n` +
        `Kondisi: Baik\n` +
        `Keterangan: Lemari logistik\n` +
        `\`\`\``,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  await ctx.reply(`⏳ *Mengunggah foto barang ke Google Drive & mencatat data inventaris...*`, {
    parse_mode: 'Markdown',
  });
  await ctx.replyWithChatAction('upload_photo');

  const file = await ctx.api.getFile(fileId);
  if (!file.file_path) {
    throw new Error('Tidak dapat mengunduh foto dari Telegram.');
  }

  const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
  const res = await fetch(fileUrl);
  if (!res.ok) {
    throw new Error(`Gagal fetch file dari Telegram: ${res.statusText}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const itemCode = await generateNextItemCode(parsed.unit);
  const fileName = `inventaris_${itemCode}_${Date.now()}.jpg`;

  const driveLink = await uploadReceiptToDrive(buffer, fileName, mimeType).catch((err) => {
    console.error('Error upload foto inventaris:', err);
    return null;
  });

  const newItem = await tambahInventaris({
    kodeBarang: itemCode,
    namaBarang: parsed.nama,
    unit: parsed.unit,
    jumlah: parsed.jumlah,
    tahun: parsed.tahun,
    sumber: parsed.sumber,
    kondisi: parsed.kondisi,
    foto: driveLink || '',
    keterangan: parsed.keterangan,
  });

  const keyboard = new InlineKeyboard();
  if (driveLink) {
    keyboard.url('📸 Buka Foto di Drive', driveLink);
  }
  keyboard.row().url('🌐 Buka Tabel Web Inventaris', WEB_INVENTARIS_URL);

  const photoStatus = driveLink
    ? `📎 *Foto Barang:* [Lihat Foto di Google Drive](${driveLink})`
    : `⚠️ *Foto Barang:* _Gagal terunggah ke Drive_`;

  await ctx.reply(
    `✅ *Barang Inventaris Berhasil Dicatat!*\n\n` +
      `🏷️ *Kode Barang:* \`${newItem.kodeBarang}\`\n` +
      `📦 *Nama Barang:* *${newItem.namaBarang}*\n` +
      `🏛️ *Unit:* ${newItem.unit}\n` +
      `🔢 *Jumlah:* ${newItem.jumlah}\n` +
      `📅 *Tahun:* ${newItem.tahun}\n` +
      `💰 *Sumber:* ${newItem.sumber}\n` +
      `🟢 *Kondisi:* ${newItem.kondisi}\n` +
      `📍 *Keterangan:* ${newItem.keterangan}\n\n` +
      `${photoStatus}\n\n` +
      `_Data tersimpan otomatis di Google Sheets tab \`Inventaris\` dan tampil di tabel website._`,
    {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
      link_preview_options: { is_disabled: true },
    }
  );
}

// Command: /inventaris dan /barang
bot.command(['inventaris', 'barang'], async (ctx) => {
  const text = ctx.message?.text || '';
  const parts = text.split(' ').slice(1).join(' ').trim();
  await handleInventaris(ctx, parts || undefined);
});

// Command: /tambahbarang dan /tambahinventaris
bot.command(['tambahbarang', 'tambahinventaris'], async (ctx) => {
  const text = ctx.message?.text || '';
  const parts = text.split(' ').slice(1).join(' ').trim();
  await handleTambahBarang(ctx, parts);
});

// Command: /linkinventaris dan /linkbarang
bot.command(['linkinventaris', 'linkbarang'], async (ctx) => {
  const keyboard = new InlineKeyboard().url('📦 Buka Tabel Web Inventaris', WEB_INVENTARIS_URL);
  await ctx.reply(
    `📦 *Website Tabel Inventaris Barang*\n\n` +
      `Buka tabel data inventaris seluruh unit (DKC, Unit CYJI, Unit Paspanca, Unit Ubaloka, dan Unit UNPASA):\n\n` +
      `👉 [${WEB_INVENTARIS_URL}](${WEB_INVENTARIS_URL})\n\n` +
      `💡 _Tampilan dalam bentuk tabel bersih bertema Word (putih & biru), memuat foto barang, kode otomatis (D0001, C0001, U0001, P0001, PS0001), jumlah, tahun, sumber, dan kondisi barang._`,
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
});

// Callback queries untuk Inventaris
bot.callbackQuery('inv_main', async (ctx) => {
  await ctx.answerCallbackQuery();
  await handleInventaris(ctx);
});

bot.callbackQuery(/^inv_unit:(.+)$/, async (ctx) => {
  const targetUnit = ctx.match[1];
  await ctx.answerCallbackQuery();
  await handleInventaris(ctx, targetUnit);
});

bot.callbackQuery('inv_help_add', async (ctx) => {
  await ctx.answerCallbackQuery();
  await handleTambahBarang(ctx, '');
});

bot.callbackQuery(/^inv_add:(.+)$/, async (ctx) => {
  const targetUnit = ctx.match[1];
  await ctx.answerCallbackQuery();
  await handleTambahBarang(ctx, `Unit: ${targetUnit}`);
});

// ============================================================
// MODUL PERSURATAN RESMI DKC CILACAP (Surat Masuk & Surat Keluar)
// ============================================================

/**
 * Menampilkan ringkasan agenda persuratan DKC Cilacap
 */
async function handleMenuSurat(ctx: any) {
  await ctx.replyWithChatAction('typing');

  try {
    const stats = await getSuratStats();
    const keyboard = new InlineKeyboard()
      .text(`📥 Surat Masuk (${stats.totalMasuk})`, 'surat_masuk')
      .text(`📤 Surat Keluar (${stats.totalKeluar})`, 'surat_keluar')
      .row()
      .text('🔍 Cari Surat / Berkas Drive', 'surat_cari_prompt')
      .row()
      .url('🌐 Buka Tabel Web Persuratan', WEB_SURAT_URL);

    await ctx.reply(
      `📑 *Buku Agenda Persuratan Resmi — DKC Cilacap*\n\n` +
        `Kwartir Cabang Gerakan Pramuka Cilacap\n\n` +
        `📊 *Ringkasan Arsip Persuratan:*\n` +
        `• *Total Arsip:* ${stats.totalSurat} Berkas\n` +
        `• *Surat Masuk:* ${stats.totalMasuk} Surat (Bulan ini: ${stats.bulanIniMasuk})\n` +
        `• *Surat Keluar:* ${stats.totalKeluar} Surat (Bulan ini: ${stats.bulanIniKeluar})\n` +
        `• *Sifat Penting / Segera:* ${stats.totalPenting} Surat\n\n` +
        `🔍 *Fitur Pencarian Surat & Berkas Drive:*\n` +
        `Ketik /cari untuk mencari surat atau langsung dengan kata kunci:\n` +
        `Contoh: \`/cari surat ijin orang tua\`, \`/cari dispensasi\`\n\n` +
        `💡 *Cara Cepat Catat / Arsipkan Surat:*\n` +
        `Cukup kirimkan *Foto Dokumen*, berkas *PDF*, atau berkas *Word (.docx)* surat ke chat bot ini.\n` +
        `AI akan otomatis membaca Nomor Surat, Perihal, Pengirim, dan mengunggahnya ke Google Drive! ✨`,
      {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      }
    );
  } catch (err: any) {
    console.error('Gagal memuat persuratan:', err);
    await ctx.reply(`❌ Gagal memuat data persuratan: ${err?.message || err}`);
  }
}

/**
 * Menampilkan daftar 5 surat terbaru berdasarkan jenis
 */
async function handleListSurat(ctx: any, jenisFilter?: JenisSurat) {
  await ctx.replyWithChatAction('typing');

  try {
    const all = await getAllSurat();
    const filtered = jenisFilter ? all.filter((it) => it.jenis === jenisFilter) : all;
    const latest = filtered.slice(0, 5);

    const title = jenisFilter ? `Daftar ${jenisFilter} DKC Cilacap` : 'Daftar Persuratan DKC Cilacap';

    if (latest.length === 0) {
      const keyboard = new InlineKeyboard().url('🌐 Buka Tabel Web', WEB_SURAT_URL);
      await ctx.reply(
        `ℹ️ Belum ada data ${jenisFilter || 'surat'} yang tercatat di Google Sheets.\n\n` +
          `Kirimkan berkas PDF/Word atau foto surat ke bot untuk mulai mencatat.`,
        { reply_markup: keyboard }
      );
      return;
    }

    let text = `📑 *${title}* (5 Terkini)\n\n`;

    latest.forEach((it, idx) => {
      const isMasuk = it.jenis === 'Surat Masuk';
      text +=
        `*${idx + 1}. [${it.kodeArsip}]* ${isMasuk ? '📥' : '📤'} *${it.nomorSurat}*\n` +
        `• *Perihal:* ${it.perihal}\n` +
        `• *${isMasuk ? 'Dari' : 'Kepada'}:* ${isMasuk ? it.pengirim : it.tujuan}\n` +
        `• *Tanggal:* ${it.tanggalSurat} | *Sifat:* ${it.sifat}\n` +
        (it.berkas ? `• 🔗 [Lihat Dokumen di Drive](${it.berkas})\n` : '') +
        `\n`;
    });

    const keyboard = new InlineKeyboard()
      .text('📥 Surat Masuk', 'surat_masuk')
      .text('📤 Surat Keluar', 'surat_keluar')
      .row()
      .text('🔙 Menu Persuratan', 'surat_main')
      .url('🌐 Buka Tabel Web', WEB_SURAT_URL);

    await ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
      link_preview_options: { is_disabled: true },
    });
  } catch (err: any) {
    console.error('Error listing surat:', err);
    await ctx.reply(`❌ Gagal mengambil daftar surat: ${err?.message || err}`);
  }
}

/**
 * Menangani berkas surat (bisa 1 atau banyak foto halaman sekaligus, PDF, atau Word .docx)
 */
async function handleMultipleSuratDocuments(
  ctx: any,
  fileItems: Array<{ fileId: string; fileName: string; mimeType: string }>,
  caption?: string
) {
  const senderName = ctx.from?.first_name || 'Pengguna';
  const username = ctx.from?.username ? `@${ctx.from.username}` : '';
  const pic = username ? `${senderName} (${username})` : senderName;
  const count = fileItems.length;

  const waitMsg =
    count > 1
      ? `📑 *Menganalisis ${count} foto surat & mengunggah ke Google Drive...*\n_AI membaca seluruh halaman dokumen secara simultan..._`
      : `📑 *Menganalisis dokumen surat dengan AI & mengunggah ke Google Drive...*\n_Mohon tunggu beberapa saat..._`;

  await ctx.reply(waitMsg, { parse_mode: 'Markdown' });
  await ctx.replyWithChatAction('upload_document');

  try {
    const timestamp = Date.now();

    // 1. Download seluruh berkas dari Telegram
    const downloadedFiles = await Promise.all(
      fileItems.map(async (item, idx) => {
        const file = await ctx.api.getFile(item.fileId);
        if (!file.file_path) {
          throw new Error(`Tidak dapat mengunduh berkas ${idx + 1} dari Telegram.`);
        }
        const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
        const response = await fetch(fileUrl);
        if (!response.ok) {
          throw new Error(`Gagal fetch berkas ${idx + 1} dari Telegram: ${response.statusText}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        return {
          buffer: Buffer.from(arrayBuffer),
          mimeType: item.mimeType,
          fileName: item.fileName,
        };
      })
    );

    // 2. Upload seluruh berkas ke Google Drive secara paralel
    const uploadPromises = downloadedFiles.map((f, idx) => {
      const ext = f.fileName.split('.').pop() || 'jpg';
      const driveFileName =
        count > 1
          ? `surat_dkc_${timestamp}_hal${idx + 1}.${ext}`
          : `surat_dkc_${timestamp}.${ext}`;
      return uploadReceiptToDrive(f.buffer, driveFileName, f.mimeType).catch((err) => {
        console.error(`Error upload berkas ${idx + 1} ke Drive:`, err);
        return null;
      });
    });

    // 3. Analisis AI Gemini secara simultan mencakup seluruh halaman
    const aiPromise = parseMultipleDocumentsSurat(downloadedFiles, caption).catch((err) => {
      console.error('Error AI parse surat:', err);
      return null;
    });

    const [driveUrls, parsedSurat] = await Promise.all([
      Promise.all(uploadPromises),
      aiPromise,
    ]);

    const validUrls = driveUrls.filter((u): u is string => Boolean(u));

    // Tentukan jenis surat (Surat Masuk atau Surat Keluar)
    let jenis: JenisSurat = 'Surat Masuk';
    const capLower = (caption || '').toLowerCase();
    if (capLower.includes('keluar') || capLower.includes('sk')) {
      jenis = 'Surat Keluar';
    } else if (parsedSurat?.jenis) {
      jenis = parsedSurat.jenis;
    }

    const nomorSurat = parsedSurat?.nomorSurat && parsedSurat.nomorSurat !== '-' ? parsedSurat.nomorSurat : '-';
    const perihal =
      parsedSurat?.perihal ||
      caption?.replace(/^(\/surat|\/arsip|surat\s*masuk|surat\s*keluar)/i, '').trim() ||
      'Berkas Dokumen Resmi DKC';
    const pengirim = parsedSurat?.pengirim || (jenis === 'Surat Keluar' ? 'DKC Cilacap' : '-');
    const tujuan = parsedSurat?.tujuan || (jenis === 'Surat Masuk' ? 'DKC Cilacap' : '-');
    const tanggalSurat = parsedSurat?.tanggalSurat || new Date().toISOString().slice(0, 10);
    const tanggalDiterima = parsedSurat?.tanggalDiterima || new Date().toISOString().slice(0, 10);
    const kategori = parsedSurat?.kategori || 'Lain-lain';
    const sifat = parsedSurat?.sifat || 'Biasa';
    const ringkasan = parsedSurat?.ringkasan || '-';

    const newItem = await tambahSurat({
      jenis,
      nomorSurat,
      tanggalSurat,
      tanggalDiterima,
      pengirim,
      tujuan,
      perihal,
      kategori,
      sifat,
      ringkasan,
      berkas: validUrls,
      pic,
    });

    const keyboard = new InlineKeyboard();
    if (validUrls.length === 1) {
      keyboard.url('📄 Buka Berkas di Drive', validUrls[0]);
    } else if (validUrls.length > 1) {
      validUrls.slice(0, 4).forEach((u, idx) => {
        keyboard.url(`📄 Hal ${idx + 1}`, u);
      });
      keyboard.row();
    }
    keyboard.url('🌐 Buka Tabel Web Persuratan', WEB_SURAT_URL);

    // Format tampilan rincian sesuai instruksi pengguna:
    // Surat Masuk: tanggal masuk surat, asal surat, no surat, tanggal surat, perihal
    // Surat Keluar: tanggal surat, no surat, kepada, perihal
    let headerText = '';
    let mainFieldsText = '';

    if (newItem.jenis === 'Surat Masuk') {
      headerText = `✅ *Surat Masuk Berhasil Dicatat ke Arsip DKC!*`;
      mainFieldsText =
        `🏷️ *Kode Arsip:* \`${newItem.kodeArsip}\`\n` +
        `📂 *Jenis:* *Surat Masuk*\n` +
        `📥 *Tanggal Masuk Surat:* ${newItem.tanggalDiterima}\n` +
        `🏢 *Asal Surat:* ${newItem.pengirim}\n` +
        `🔢 *No Surat:* \`${newItem.nomorSurat}\`\n` +
        `📅 *Tanggal Surat:* ${newItem.tanggalSurat}\n` +
        `📋 *Perihal:* *${newItem.perihal}*`;
    } else {
      headerText = `✅ *Surat Keluar Berhasil Dicatat ke Arsip DKC!*`;
      mainFieldsText =
        `🏷️ *Kode Arsip:* \`${newItem.kodeArsip}\`\n` +
        `📂 *Jenis:* *Surat Keluar*\n` +
        `📅 *Tanggal Surat:* ${newItem.tanggalSurat}\n` +
        `🔢 *No Surat:* \`${newItem.nomorSurat}\`\n` +
        `🎯 *Kepada:* ${newItem.tujuan}\n` +
        `📋 *Perihal:* *${newItem.perihal}*`;
    }

    let extraDetails =
      `\n🏷️ *Kategori & Sifat:* ${newItem.kategori} (${newItem.sifat})\n` +
      (newItem.ringkasan && newItem.ringkasan !== '-' ? `📝 *Ringkasan:* _${newItem.ringkasan}_\n` : '');

    let driveLinksText = '';
    if (validUrls.length === 1) {
      driveLinksText = `\n📁 *Berkas:* [Buka di Google Drive](${validUrls[0]})\n`;
    } else if (validUrls.length > 1) {
      driveLinksText =
        `\n📁 *Berkas Terunggah (${validUrls.length} Foto Halaman):*\n` +
        validUrls.map((u, i) => `  ${i + 1}. [Halaman ${i + 1} di Google Drive](${u})`).join('\n') +
        '\n';
    }

    const singlePhotoTip = count === 1
      ? `\n💡 _Tips: Jika surat memiliki lebih dari 1 halaman (2, 3, atau lebih foto), Anda bisa memilih & mengirimkan beberapa foto sekaligus dalam satu album di Telegram._\n`
      : '';

    await ctx.reply(
      `${headerText}\n\n` +
        `${mainFieldsText}\n` +
        `${extraDetails}` +
        `${driveLinksText}` +
        `\n👤 *PIC Input:* ${pic}\n` +
        `${singlePhotoTip}\n` +
        `_Data tersimpan di tab Google Sheets **${SHEET_SURAT}** dan tabel web persuratan._`,
      {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
        link_preview_options: { is_disabled: true },
      }
    );
  } catch (err: any) {
    console.error('Error handling multiple surat documents:', err);
    await ctx.reply(`❌ Terjadi kendala saat memproses berkas surat: ${err?.message || err}`);
  }
}

/**
 * Menangani single dokumen surat yang diunggah ke Telegram
 */
async function handleSuratDocument(
  ctx: any,
  fileId: string,
  fileName: string,
  mimeType: string,
  caption?: string
) {
  return handleMultipleSuratDocuments(ctx, [{ fileId, fileName, mimeType }], caption);
}

// Commands: Persuratan DKC
bot.command(['surat', 'persuratan', 'arsip'], async (ctx) => {
  await handleMenuSurat(ctx);
});

bot.command(['suratmasuk', 'masuk'], async (ctx) => {
  await handleListSurat(ctx, 'Surat Masuk');
});

bot.command(['suratkeluar', 'keluar'], async (ctx) => {
  await handleListSurat(ctx, 'Surat Keluar');
});

bot.command(['linksurat', 'websurat'], async (ctx) => {
  const keyboard = new InlineKeyboard().url('📑 Buka Tabel Web Persuratan', WEB_SURAT_URL);
  await ctx.reply(
    `📑 *Website Arsip Persuratan DKC Cilacap*\n\n` +
      `Buka buku agenda surat masuk & keluar resmi DKC Cilacap:\n\n` +
      `👉 [${WEB_SURAT_URL}](${WEB_SURAT_URL})\n\n` +
      `💡 _Tampilan tabel bersih bertema Word (putih & biru), memuat berkas surat asli di Google Drive, kode arsip otomatis (SM-0001, SK-0001), tanggal, perihal, dan ringkasan isi surat._`,
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
});

// Callbacks Persuratan
bot.callbackQuery('surat_main', async (ctx) => {
  await ctx.answerCallbackQuery();
  await handleMenuSurat(ctx);
});

bot.callbackQuery('surat_masuk', async (ctx) => {
  await ctx.answerCallbackQuery();
  await handleListSurat(ctx, 'Surat Masuk');
});

bot.callbackQuery('surat_keluar', async (ctx) => {
  await ctx.answerCallbackQuery();
  await handleListSurat(ctx, 'Surat Keluar');
});

bot.command(['cari', 'carisurat', 'searchsurat'], async (ctx) => {
  const text = ctx.message?.text || '';
  const query = text.replace(/^\/(cari|carisurat|searchsurat)(?:@\w+)?/i, '').trim();
  if (query) {
    await handleCariSurat(ctx, query);
  } else {
    await handlePromptCariSurat(ctx);
  }
});

/**
 * Meminta pengguna memasukkan kata kunci pencarian surat
 */
async function handlePromptCariSurat(ctx: any) {
  const chatId = ctx.chat?.id;
  if (chatId) cariSuratStates.set(chatId, true);

  const keyboard = new InlineKeyboard()
    .text('📋 Tampilkan Semua Surat', 'surat_cari_semua')
    .row()
    .text('❌ Batal', 'surat_cari_batal')
    .url('🌐 Buka Tabel Web', WEB_SURAT_URL);

  await ctx.reply(
    `🔍 *Pencarian Arsip Persuratan & Berkas DKC*\n\n` +
      `Silakan ketik kata kunci surat yang ingin dicari:\n` +
      `_(contoh: \`surat ijin orang tua\`, \`undangan\`, \`dispensasi\`, \`sk\`, atau nomor surat)_\n\n` +
      `💡 _Sistem otomatis mencari di data Google Sheets dan seluruh berkas Google Drive DKC._\n` +
      `_Atau tekan tombol *Tampilkan Semua Surat* di bawah untuk melihat seluruh arsip:_`,
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
}

/**
 * Menampilkan daftar hasil pencarian surat dengan penomoran rapi dan pagination jika banyak
 */
async function renderSuratList(
  ctx: any,
  session: { query: string; results: SuratSearchResult[]; page?: number },
  page: number = 0,
  isEdit: boolean = false
) {
  const PAGE_SIZE = 10;
  const results = session.results;
  const total = results.length;
  const totalPages = Math.ceil(total / PAGE_SIZE) || 1;
  const currentPage = Math.max(0, Math.min(page, totalPages - 1));
  session.page = currentPage;

  const startIndex = currentPage * PAGE_SIZE;
  const pageResults = results.slice(startIndex, startIndex + PAGE_SIZE);

  let text =
    `🔍 *Hasil Pencarian Surat: "${session.query}"*\n` +
    `Ditemukan *${total} surat/berkas*` +
    (totalPages > 1 ? ` _(Halaman ${currentPage + 1} dari ${totalPages})_` : '') +
    `:\n\n`;

  pageResults.forEach((it, idx) => {
    const globalIdx = startIndex + idx;
    const numIcon =
      globalIdx === 0
        ? '1️⃣'
        : globalIdx === 1
        ? '2️⃣'
        : globalIdx === 2
        ? '3️⃣'
        : globalIdx === 3
        ? '4️⃣'
        : globalIdx === 4
        ? '5️⃣'
        : globalIdx === 5
        ? '6️⃣'
        : globalIdx === 6
        ? '7️⃣'
        : globalIdx === 7
        ? '8️⃣'
        : globalIdx === 8
        ? '9️⃣'
        : `${globalIdx + 1}.`;

    const badge =
      it.source === 'drive'
        ? '📁 Google Drive'
        : it.jenis === 'Surat Masuk'
        ? '📥 Surat Masuk'
        : '📤 Surat Keluar';
    const kode = it.kodeArsip ? `\`[${it.kodeArsip}]\` ` : '';
    const noStr =
      it.nomorSurat && it.nomorSurat !== '-' ? `\n   🔢 No: \`${it.nomorSurat}\`` : '';
    const tanggalStr =
      it.tanggalSurat && it.tanggalSurat !== '-' ? ` | 📅 ${it.tanggalSurat}` : '';
    const pihak =
      it.pengirim && it.pengirim !== '-' && it.pengirim !== 'Google Drive DKC'
        ? `\n   🏢 Pengirim: ${it.pengirim}`
        : '';

    text += `${numIcon} *${kode}${it.perihal}*\n   🏷️ ${badge}${tanggalStr}${noStr}${pihak}\n\n`;
  });

  text +=
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `👇 *Pilih nomor surat di bawah untuk melihat rincian & mendownload berkas:*`;

  const keyboard = new InlineKeyboard();
  pageResults.forEach((_, idx) => {
    const globalIdx = startIndex + idx;
    keyboard.text(`📄 Surat ${globalIdx + 1}`, `surat_pick:${globalIdx}`);
    if ((idx + 1) % 3 === 0) keyboard.row();
  });

  if (pageResults.length % 3 !== 0) keyboard.row();

  // Tombol navigasi jika ada lebih dari 1 halaman
  if (totalPages > 1) {
    if (currentPage > 0) {
      keyboard.text('⬅️ Sebelumnya', `surat_page:${currentPage - 1}`);
    }
    keyboard.text(`📄 Hal ${currentPage + 1}/${totalPages}`, 'noop_page');
    if (currentPage < totalPages - 1) {
      keyboard.text('Berikutnya ➡️', `surat_page:${currentPage + 1}`);
    }
    keyboard.row();
  }

  keyboard.text('🔍 Cari Kata Kunci Lain', 'surat_cari_prompt');
  keyboard.url('🌐 Buka Tabel Web', WEB_SURAT_URL);

  if (isEdit) {
    try {
      await ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
        link_preview_options: { is_disabled: true },
      });
      return;
    } catch {}
  }

  await ctx.reply(text, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
    link_preview_options: { is_disabled: true },
  });
}

/**
 * Menjalankan pencarian surat & menampilkan seluruh daftar bernomor
 */
async function handleCariSurat(ctx: any, query: string) {
  const chatId = ctx.chat?.id;
  await ctx.replyWithChatAction('typing');

  try {
    const results = await cariSurat(query);
    if (chatId) {
      suratSearchSessions.set(chatId, {
        query,
        results,
        page: 0,
        timestamp: Date.now(),
      });
    }

    if (results.length === 0) {
      const keyboard = new InlineKeyboard()
        .text('📋 Tampilkan Semua Surat', 'surat_cari_semua')
        .row()
        .text('🔍 Cari Kata Kunci Lain', 'surat_cari_prompt')
        .url('🌐 Buka Web Persuratan', WEB_SURAT_URL);

      await ctx.reply(
        `🔍 *Hasil Pencarian Surat: "${query}"*\n\n` +
          `❌ Tidak ditemukan surat atau berkas dokumen yang cocok dengan kata kunci tersebut.\n\n` +
          `💡 *Tips Pencarian:*\n` +
          `• Gunakan kata kunci yang lebih ringkas (misal: \`ijin\`, \`izin\`, \`dispensasi\`, \`undangan\`, \`sk\`).\n` +
          `• Atau tekan tombol *Tampilkan Semua Surat* di bawah untuk melihat seluruh arsip surat:`,
        { parse_mode: 'Markdown', reply_markup: keyboard }
      );
      return;
    }

    const session = chatId ? suratSearchSessions.get(chatId) : null;
    if (session) {
      await renderSuratList(ctx, session, 0, false);
    }
  } catch (err: any) {
    console.error('Error saat mencari surat:', err);
    await ctx.reply(`❌ Terjadi kendala saat mencari surat: ${err?.message || err}`);
  }
}

bot.callbackQuery('surat_cari_semua', async (ctx) => {
  await ctx.answerCallbackQuery('Memuat seluruh daftar surat...');
  await handleCariSurat(ctx, 'semua');
});

bot.callbackQuery(/^surat_page:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const chatId = ctx.chat?.id;
  const page = parseInt(ctx.match[1], 10);
  const session = chatId ? suratSearchSessions.get(chatId) : null;
  if (!session || session.results.length === 0) {
    await handlePromptCariSurat(ctx);
    return;
  }
  await renderSuratList(ctx, session, page, true);
});

bot.callbackQuery('noop_page', async (ctx) => {
  await ctx.answerCallbackQuery();
});

bot.callbackQuery('surat_cari_prompt', async (ctx) => {
  await ctx.answerCallbackQuery();
  await handlePromptCariSurat(ctx);
});

bot.callbackQuery('surat_cari_batal', async (ctx) => {
  await ctx.answerCallbackQuery('Pencarian dibatalkan');
  const chatId = ctx.chat?.id;
  if (chatId) cariSuratStates.delete(chatId);
  await ctx.reply('❌ Pencarian surat dibatalkan. Ketik /surat atau /cari kapan saja saat dibutuhkan.');
});

bot.callbackQuery('surat_back_list', async (ctx) => {
  await ctx.answerCallbackQuery();
  const chatId = ctx.chat?.id;
  const session = chatId ? suratSearchSessions.get(chatId) : null;
  if (!session || session.results.length === 0) {
    await handlePromptCariSurat(ctx);
    return;
  }

  await renderSuratList(ctx, session, session.page || 0, false);
});

bot.callbackQuery(/^surat_pick:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const chatId = ctx.chat?.id;
  const index = parseInt(ctx.match[1], 10);
  const session = chatId ? suratSearchSessions.get(chatId) : null;

  if (!session || !session.results[index]) {
    await ctx.reply(
      '⚠️ Sesi pencarian telah kedaluwarsa. Silakan ketik /cari untuk mencari kembali.'
    );
    return;
  }

  const it = session.results[index];
  const badge = it.source === 'drive' ? '📁 Berkas Google Drive' : it.jenis;

  const detailText =
    `📑 *Rincian Dokumen Surat #${index + 1}*\n\n` +
    `📋 *Perihal:* *${it.perihal}*\n` +
    (it.kodeArsip ? `🏷️ *Kode Arsip:* \`${it.kodeArsip}\`\n` : '') +
    `📂 *Jenis Dokumen:* *${badge}*\n` +
    (it.nomorSurat && it.nomorSurat !== '-' ? `🔢 *Nomor Surat:* \`${it.nomorSurat}\`\n` : '') +
    (it.tanggalSurat && it.tanggalSurat !== '-' ? `📅 *Tanggal Surat:* ${it.tanggalSurat}\n` : '') +
    (it.tanggalDiterima && it.tanggalDiterima !== '-' ? `📥 *Tanggal Diterima:* ${it.tanggalDiterima}\n` : '') +
    (it.pengirim && it.pengirim !== '-' ? `🏢 *Pengirim / Asal:* ${it.pengirim}\n` : '') +
    (it.tujuan && it.tujuan !== '-' ? `🎯 *Tujuan / Penerima:* ${it.tujuan}\n` : '') +
    (it.kategori && it.kategori !== '-' ? `🏷️ *Kategori & Sifat:* ${it.kategori} (${it.sifat || 'Biasa'})\n` : '') +
    (it.ringkasan && it.ringkasan !== '-' ? `📝 *Ringkasan:* _${it.ringkasan}_\n` : '') +
    (it.pic && it.pic !== '-' ? `👤 *PIC Input:* ${it.pic}\n` : '') +
    (it.berkas ? `\n🔗 *Status Berkas:* [Tersedia untuk Diunduh](${it.berkas})` : '\n⚠️ *Status Berkas:* _Tautan berkas belum tersedia_') +
    `\n\n━━━━━━━━━━━━━━━━━━━━━\n` +
    `📥 *PILIHAN DOWNLOAD SURAT:*\n` +
    (it.berkas
      ? `Silakan tekan tombol di bawah ini untuk mengunduh dokumen:`
      : `_Berkas fisik belum diunggah untuk surat ini._`);

  const keyboard = new InlineKeyboard();
  if (it.berkas) {
    keyboard.text('📥 Download Surat (Kirim ke Chat)', `surat_sendfile:${index}`);
    keyboard.row();
    keyboard.url('🌐 Buka / Download di Google Drive', it.berkas);
    keyboard.row();
  }
  keyboard.text('⬅️ Kembali ke Daftar Surat', 'surat_back_list');
  keyboard.text('🔍 Cari Surat Lain', 'surat_cari_prompt');

  await ctx.reply(detailText, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
    link_preview_options: { is_disabled: true },
  });
});

bot.callbackQuery(/^surat_sendfile:(\d+)$/, async (ctx) => {
  const chatId = ctx.chat?.id;
  const index = parseInt(ctx.match[1], 10);
  const session = chatId ? suratSearchSessions.get(chatId) : null;

  if (!session || !session.results[index]) {
    await ctx.answerCallbackQuery('Sesi kedaluwarsa. Silakan ketik /cari kembali.');
    return;
  }

  const it = session.results[index];
  if (!it.berkas) {
    await ctx.answerCallbackQuery('Berkas tidak tersedia.');
    return;
  }

  await ctx.answerCallbackQuery('Mengunduh berkas surat...');
  await ctx.replyWithChatAction('upload_document');

  const waitMsg = await ctx.reply(
    `⏳ *Mengunduh dokumen surat dari Google Drive & mengirim ke chat...*\n` +
      `_Mohon tunggu sebentar..._`,
    { parse_mode: 'Markdown' }
  );

  try {
    const fileData = await downloadDriveFile(it.berkas);
    if (fileData) {
      const cleanBase = (fileData.fileName || it.perihal).replace(/[/\\?%*:|"<>]/g, '_').trim();
      const ext = fileData.fileName && fileData.fileName.includes('.')
        ? fileData.fileName.split('.').pop()
        : fileData.mimeType.includes('word') ? 'docx' : 'pdf';
      const sendFileName = cleanBase.toLowerCase().endsWith(`.${ext?.toLowerCase()}`)
        ? cleanBase
        : `${cleanBase}.${ext}`;

      await ctx.replyWithDocument(new InputFile(fileData.buffer, sendFileName), {
        caption:
          `✅ *File Surat Berhasil Diunduh!*\n\n` +
          `📄 *Nama Berkas:* *${it.perihal}*\n` +
          (it.nomorSurat && it.nomorSurat !== '-' ? `🔢 *No. Surat:* \`${it.nomorSurat}\`\n` : '') +
          (it.kodeArsip ? `🏷️ *Kode Arsip:* \`${it.kodeArsip}\`\n` : '') +
          `🔗 [Tautan di Google Drive](${it.berkas})\n\n` +
          `_Ketuk berkas di atas untuk langsung membuka atau menyimpan di perangkat Anda._`,
        parse_mode: 'Markdown',
      });

      try {
        if (chatId) await ctx.api.deleteMessage(chatId, waitMsg.message_id);
      } catch {}
    } else {
      const keyboard = new InlineKeyboard().url('🌐 Buka di Google Drive', it.berkas);
      await ctx.reply(
        `ℹ️ Berkas tidak dapat dikirim otomatis sebagai file chat (kemungkinan folder atau dibatasi Google Drive).\n` +
          `Silakan buka dan download langsung melalui Google Drive di bawah ini:`,
        { reply_markup: keyboard }
      );
    }
  } catch (dlErr: any) {
    console.error('Gagal mengunduh file Drive:', dlErr);
    const keyboard = new InlineKeyboard().url('🌐 Buka di Google Drive', it.berkas);
    await ctx.reply(
      `⚠️ Terjadi kendala saat mengunduh berkas: ${dlErr?.message || dlErr}\n` +
        `Silakan unduh langsung dari Google Drive:`,
      { reply_markup: keyboard }
    );
  }
});


// ============================================================
// Command: /nota — mulai percakapan buat nota
// ============================================================
bot.command('nota', async (ctx) => {
  if (!(await checkFinancePermission(ctx))) return;
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
      if (!(await checkFinancePermission(ctx))) return;
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

  // === 1.5 Cek apakah pengguna sedang dalam proses input kata kunci /cari surat ===
  if (cariSuratStates.has(chatId)) {
    if (text.toLowerCase() === 'batal' || text === '/batal') {
      cariSuratStates.delete(chatId);
      await ctx.reply('❌ Pencarian surat dibatalkan. Ketik /cari untuk memulai kembali.');
      return;
    }
    cariSuratStates.delete(chatId);
    await handleCariSurat(ctx, text);
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

  // Trigger inventaris via teks bebas
  if (
    textLower.startsWith('tambah barang') ||
    textLower.startsWith('tambahbarang') ||
    textLower.startsWith('tambah inventaris') ||
    textLower.startsWith('tambahinventaris') ||
    /^(unit:|nama:|barang:)/i.test(text.trim())
  ) {
    const q = text.replace(/^(tambah\s*barang|tambahbarang|tambah\s*inventaris|tambahinventaris)/i, '').trim();
    await handleTambahBarang(ctx, q || text);
    return;
  }

  if (
    textLower.startsWith('inventaris') ||
    textLower.startsWith('daftar barang') ||
    textLower.startsWith('cek barang') ||
    textLower.startsWith('cari barang')
  ) {
    const q = text.replace(/^(inventaris|daftar\s*barang|cek\s*barang|cari\s*barang)/i, '').trim();
    await handleInventaris(ctx, q || undefined);
    return;
  }

  if (textLower === 'link inventaris' || textLower === 'linkinventaris' || textLower === 'web inventaris') {
    const keyboard = new InlineKeyboard().url('📦 Buka Tabel Web Inventaris', WEB_INVENTARIS_URL);
    await ctx.reply(
      `📦 *Website Tabel Inventaris Barang*\n\n` +
        `Buka tabel data inventaris seluruh unit (DKC, Unit CYJI, Unit Paspanca, Unit Ubaloka, dan Unit UNPASA):\n\n` +
        `👉 [${WEB_INVENTARIS_URL}](${WEB_INVENTARIS_URL})\n\n` +
        `💡 _Tampilan dalam bentuk tabel Word (putih & biru), memuat foto barang, kode otomatis (D0001, C0001, U0001, P0001, PS0001), jumlah, tahun, sumber, dan kondisi barang._`,
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
    return;
  }

  // Trigger persuratan via teks bebas
  if (textLower.startsWith('surat masuk') || textLower.startsWith('suratmasuk')) {
    await handleListSurat(ctx, 'Surat Masuk');
    return;
  }

  if (textLower.startsWith('surat keluar') || textLower.startsWith('suratkeluar')) {
    await handleListSurat(ctx, 'Surat Keluar');
    return;
  }

  if (
    textLower === 'surat' ||
    textLower === 'persuratan' ||
    textLower === 'arsip' ||
    textLower === 'agenda surat' ||
    textLower === 'arsip surat'
  ) {
    await handleMenuSurat(ctx);
    return;
  }

  if (textLower === 'link surat' || textLower === 'linksurat' || textLower === 'web surat' || textLower === 'websurat') {
    const keyboard = new InlineKeyboard().url('📑 Buka Tabel Web Persuratan', WEB_SURAT_URL);
    await ctx.reply(
      `📑 *Website Arsip Persuratan DKC Cilacap*\n\n` +
        `Buka buku agenda surat masuk & keluar resmi DKC Cilacap:\n\n` +
        `👉 [${WEB_SURAT_URL}](${WEB_SURAT_URL})`,
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
    return;
  }

  if (
    textLower.startsWith('cari surat') ||
    textLower.startsWith('carisurat') ||
    textLower.startsWith('cari berkas') ||
    textLower.startsWith('cari dokumen')
  ) {
    const q = text.replace(/^(cari\s*surat|carisurat|cari\s*berkas|cari\s*dokumen)/i, '').trim();
    if (q) {
      await handleCariSurat(ctx, q);
    } else {
      await handlePromptCariSurat(ctx);
    }
    return;
  }

  if (
    textLower.startsWith('pindah saldo') ||
    textLower.startsWith('pindahsaldo') ||
    textLower.startsWith('transfer saldo') ||
    textLower.startsWith('transfersaldo')
  ) {
    if (!(await checkFinancePermission(ctx))) return;
    const q = text.replace(/^(pindah\s*saldo|pindahsaldo|transfer\s*saldo|transfersaldo)/i, '').trim();
    await handleStartPindahSaldo(ctx, q);
    return;
  }

  if (textLower.startsWith('cek kas') || textLower.startsWith('cekkas')) {
    if (!(await checkFinancePermission(ctx))) return;
    const q = text.replace(/^(cek\s*kas|cekkas)/i, '').trim();
    await handleCekKas(ctx, q);
    return;
  }

  if (textLower.startsWith('bayar kas') || textLower.startsWith('bayarkas')) {
    if (!(await checkFinancePermission(ctx))) return;
    const q = text.replace(/^(bayar\s*kas|bayarkas)/i, '').trim();
    await handleBayarKas(ctx, q);
    return;
  }

  if (textLower.startsWith('tambah anggota') || textLower.startsWith('tambahanggota')) {
    if (!(await checkFinancePermission(ctx))) return;
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
    if (!(await checkFinancePermission(ctx))) return;
    const q = text.replace(/^(nonaktifkan\s*anggota|nonaktif\s*anggota|nonaktifkan|nonaktifanggota)/i, '').trim();
    await handleNonaktifAnggota(ctx, q);
    return;
  }

  if (
    textLower.startsWith('aktifkan anggota') ||
    textLower.startsWith('aktifkan') ||
    textLower.startsWith('aktifkananggota')
  ) {
    if (!(await checkFinancePermission(ctx))) return;
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
      if (!(await checkFinancePermission(ctx))) return;
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
      'izinkaninv',
      'approveinv',
      'undanginv',
      'inviteinv',
      'cabut',
      'revoke',
      'linkuang',
      'linkweb',
      'dashboard',
      'website',
      'inventaris',
      'barang',
      'tambahbarang',
      'tambahinventaris',
      'linkinventaris',
      'linkbarang',
      'cekfoto',
      'unggahfoto',
      'surat',
      'persuratan',
      'arsip',
      'suratmasuk',
      'suratkeluar',
      'masuk',
      'keluar',
      'linksurat',
      'websurat',
      'cari',
      'carisurat',
      'searchsurat',
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
    if (!(await checkFinancePermission(ctx))) return;
    notaStates.set(chatId, { step: 'invoice_no', data: { items: [] } });
    await ctx.reply(
      `📋 *Buat Nota AJP*\n\nMasukkan *No. Invoice:*\n_(contoh: 011/AJP/JJ/2026)_`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Jika pengguna mengetik 'rekapkas' tanpa slash
  if (text.toLowerCase().startsWith('rekapkas') || text.toLowerCase().startsWith('recapkas')) {
    if (!(await checkFinancePermission(ctx))) return;
    const parts = text.split(' ').slice(1).join(' ').trim();
    await sendRekapKas(ctx, parts);
    return;
  }

  // Jika pengguna mengetik 'rekap' tanpa slash
  if (text.toLowerCase().startsWith('rekap') || text.toLowerCase().startsWith('recap')) {
    if (!(await checkFinancePermission(ctx))) return;
    const parts = text.split(' ').slice(1).join(' ').trim();
    await sendRekap(ctx, parts);
    return;
  }

  // === 5. Pencatatan Transaksi Normal Berbasis Teks ===
  try {
    const senderId = String(ctx.from?.id);
    const [allowed, activeBook, parsed] = await Promise.all([
      senderId ? isUserAllowedFinance(senderId) : Promise.resolve(true),
      getUserActiveBook(chatId),
      parseTextMessage(text),
    ]);

    if (!allowed) {
      const kb = new InlineKeyboard()
        .text('📦 Inventaris', 'inv_main')
        .text('📑 Persuratan', 'surat_main')
        .row()
        .text('🔍 Cari Surat', 'surat_cari_prompt');
      await ctx.reply(
        `⛔ *Akses Khusus Bendahara*\n\n` +
          `Pencatatan kas dan transaksi keuangan dibatasi khusus untuk *Bendahara / Admin*.\n\n` +
          `✨ *Fitur yang dapat Anda gunakan:*\n` +
          `• 📦 *Inventaris:* /inventaris, /tambahbarang, /linkinventaris\n` +
          `• 📑 *Persuratan:* /surat, /cari, /suratmasuk, /suratkeluar, /linksurat`,
        { parse_mode: 'Markdown', reply_markup: kb }
      );
      return;
    }

    await ctx.replyWithChatAction('typing').catch(() => {});

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
            `👤 *Penginput:* ${escapeMd(senderName)} ${username ? `(${safeUsername(username)})` : ''}\n` +
            `🆔 *ID:* \`${senderId}\`\n` +
            `📖 *Buku:* \`${activeBook}\`\n` +
            `📅 *Tanggal:* ${parsed.date}\n` +
            `${emoji} *Jenis:* ${parsed.type} (${formatRupiah(parsed.amount)})\n` +
            `📂 *Kategori:* ${escapeMd(parsed.category)}\n` +
            `📝 *Keterangan:* ${escapeMd(parsed.description)}`;

          try {
            await ctx.api.sendMessage(adminId, alertMsg, { parse_mode: 'Markdown' });
          } catch {
            await ctx.api.sendMessage(
              adminId,
              `🔔 Pantauan Transaksi Anggota!\n\n` +
                `Penginput: ${senderName} (${username || '-'})\n` +
                `ID: ${senderId}\n` +
                `Buku: ${activeBook}\n` +
                `Tanggal: ${parsed.date}\n` +
                `Jenis: ${parsed.type} (${formatRupiah(parsed.amount)})\n` +
                `Kategori: ${parsed.category}\n` +
                `Keterangan: ${parsed.description}`
            );
          }
        } catch (adminErr) {
          console.error('Gagal mengirim notifikasi pantauan transaksi ke Admin:', adminErr);
        }
      })();
    }

    // Kirim rekap singkat (diawait agar tidak beku di serverless Vercel)
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
      // Abaikan jika rekap gagal
    }
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
      fileId = doc.file_id;
      fileName = doc.file_name || `dokumen_${Date.now()}`;
      mimeType = doc.mime_type || 'application/octet-stream';
    }

    if (!fileId) {
      await ctx.reply('⚠️ Mohon kirimkan berkas berupa foto nota, dokumen surat, atau file PDF/Word.');
      return;
    }

    const rawCaption = ctx.message.caption || '';

    // === Cek jika pesan ini adalah bagian dari Album Foto / Media Group (Multi-halaman surat DKC) ===
    const mediaGroupId = ctx.message.media_group_id;
    if (mediaGroupId) {
      const existing = mediaGroupSuratMap.get(mediaGroupId);
      if (existing) {
        clearTimeout(existing.timer);
        existing.items.push({ ctx, fileId, fileName, mimeType, caption: rawCaption });
        existing.timer = setTimeout(() => {
          handleMediaGroupFinish(mediaGroupId);
        }, 1200);
      } else {
        const timer = setTimeout(() => {
          handleMediaGroupFinish(mediaGroupId);
        }, 1200);
        mediaGroupSuratMap.set(mediaGroupId, {
          chatId,
          items: [{ ctx, fileId, fileName, mimeType, caption: rawCaption }],
          timer,
        });
      }
      return;
    }

    // === Cek jika ini adalah berkas persuratan DKC (Surat Masuk / Surat Keluar) ===
    const isDocxOrPdf =
      mimeType === 'application/pdf' ||
      mimeType.includes('wordprocessingml') ||
      mimeType.includes('msword') ||
      fileName.toLowerCase().endsWith('.docx') ||
      fileName.toLowerCase().endsWith('.pdf') ||
      fileName.toLowerCase().endsWith('.doc');

    const isSuratCaption =
      /^(surat|arsip|\/surat|\/arsip|surat\s*masuk|surat\s*keluar|sm|sk)/i.test(rawCaption.trim()) ||
      rawCaption.toLowerCase().includes('surat masuk') ||
      rawCaption.toLowerCase().includes('surat keluar') ||
      rawCaption.toLowerCase().includes('nomor surat') ||
      rawCaption.toLowerCase().includes('no. surat');

    if (isSuratCaption || (isDocxOrPdf && !rawCaption.toLowerCase().includes('nota'))) {
      await handleSuratDocument(ctx, fileId, fileName, mimeType, rawCaption);
      return;
    }

    // === Cek jika ini adalah foto untuk Inventaris Barang ===
    if (
      rawCaption.startsWith('/tambahbarang') ||
      rawCaption.startsWith('/tambahinventaris') ||
      rawCaption.startsWith('/barang') ||
      /^(unit:|nama:|barang:)/i.test(rawCaption.trim())
    ) {
      await handleTambahBarangWithPhoto(ctx, fileId, rawCaption, mimeType);
      return;
    }

    // === Cek hak akses keuangan untuk unggah foto nota ===
    const senderId = String(ctx.from?.id);
    if (senderId && !(await isUserAllowedFinance(senderId))) {
      await ctx.reply(
        `⛔ *Akses Khusus Bendahara*\n\n` +
          `Unggah foto nota belanja & pencatatan kas dibatasi khusus untuk *Bendahara / Admin*.\n\n` +
          `✨ *Anda dapat mengunggah berkas untuk:*\n\n` +
          `1. 📦 *Foto Barang Inventaris*\n` +
          `Sertakan rincian pada keterangan foto:\n` +
          `\`\`\`\n` +
          `Nama: Tenda Regu Dome\n` +
          `Unit: DKC\n` +
          `Jumlah: 2 Unit\n` +
          `Kondisi: Baik\n` +
          `\`\`\`\n\n` +
          `2. 📑 *Dokumen Surat (PDF/Word/Foto Surat)*\n` +
          `Kirim berkas dengan keterangan:\n` +
          `\`Surat Masuk\` atau \`Surat Keluar\`\n\n` +
          `_Ketik /start untuk membuka menu lengkap._`,
        { parse_mode: 'Markdown' }
      );
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
      // Cek apakah berkas/foto ini adalah dokumen persuratan resmi DKC (hanya jika ada indikasi surat atau berkas dokumen)
      const mightBeSurat =
        mimeType === 'application/pdf' ||
        mimeType.includes('word') ||
        fileName.toLowerCase().endsWith('.pdf') ||
        fileName.toLowerCase().endsWith('.docx') ||
        /^(surat|arsip|undangan|edaran|sk|mandat|dokumen|nota dinas)/i.test(rawCaption.trim()) ||
        rawCaption.toLowerCase().includes('surat');

      if (mightBeSurat) {
        const parsedSurat = await parseDocumentSurat(buffer, mimeType, fileName, rawCaption).catch(() => null);
        if (parsedSurat && parsedSurat.isSurat) {
          const jenis = parsedSurat.jenis || 'Surat Masuk';
          const senderName = ctx.from?.first_name || 'Pengguna';
          const username = ctx.from?.username ? `@${ctx.from.username}` : '';
          const pic = username ? `${senderName} (${username})` : senderName;

          const newSurat = await tambahSurat({
            jenis,
            nomorSurat: parsedSurat.nomorSurat || '-',
            tanggalSurat: parsedSurat.tanggalSurat,
            tanggalDiterima: parsedSurat.tanggalDiterima,
            pengirim: parsedSurat.pengirim,
            tujuan: parsedSurat.tujuan,
            perihal: parsedSurat.perihal,
            kategori: parsedSurat.kategori,
            sifat: parsedSurat.sifat,
            ringkasan: parsedSurat.ringkasan,
            berkas: driveLink || '',
            pic,
          });

          const keyboard = new InlineKeyboard();
          if (driveLink) keyboard.url('📄 Buka Berkas di Drive', driveLink);
          keyboard.url('🌐 Buka Tabel Web Persuratan', WEB_SURAT_URL);

          await ctx.reply(
            `📑 *Terdeteksi Dokumen Surat Resmi!*\n\n` +
              `AI mendeteksi berkas ini sebagai dokumen persuratan dan otomatis mencatatnya ke arsip DKC:\n\n` +
              `🏷️ *Kode Arsip:* \`${newSurat.kodeArsip}\`\n` +
              `📂 *Jenis Surat:* *${newSurat.jenis}*\n` +
              `🔢 *No. Surat:* \`${newSurat.nomorSurat}\`\n` +
              `📅 *Tanggal:* ${newSurat.tanggalSurat}\n` +
              `🏢 *Pengirim:* ${newSurat.pengirim}\n` +
              `🎯 *Tujuan:* ${newSurat.tujuan}\n` +
              `📋 *Perihal:* *${newSurat.perihal}*\n` +
              `🏷️ *Kategori & Sifat:* ${newSurat.kategori} (${newSurat.sifat})\n` +
              (newSurat.ringkasan && newSurat.ringkasan !== '-' ? `📝 *Ringkasan:* _${newSurat.ringkasan}_\n` : '') +
              (driveLink ? `\n🔗 [Buka Berkas di Google Drive](${driveLink})\n\n` : '\n') +
              `_Data otomatis tersimpan di tab Google Sheets **${SHEET_SURAT}**._`,
            { parse_mode: 'Markdown', reply_markup: keyboard, link_preview_options: { is_disabled: true } }
          );
          return;
        }
      }

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

    // === Cek apakah foto ini cocok dengan transaksi teks HARI INI pada buku aktif yang belum ada fotonya ===
    // Menghindari duplikasi transaksi jika pengguna mencatat teks terlebih dahulu baru mengirimkan fotonya
    const todayStr = getLocalTodayDateString();
    const matchExisting = await findMatchingTransactionRow(activeBook, {
      amount: parsed.amount,
      description: parsed.description,
      date: todayStr,
      todayOnly: true,
    });

    if (matchExisting && !matchExisting.hasPhoto) {
      const matchingRow = matchExisting;
      const targetBook = activeBook;
      if (driveLink) {
        await updateTransactionNoteLink(matchingRow.rowNumber, driveLink, targetBook);
      }

      const keyboard = new InlineKeyboard();
      if (driveLink) {
        keyboard.url('📸 Buka Foto di Drive', driveLink);
      }
      keyboard.text('📸 Cek Foto Lainnya', `cekfoto_refresh:${targetBook}`);

      await ctx.reply(
        `✅ *Foto Nota Berhasil Ditautkan Langsung ke Transaksi!*\n\n` +
          `📖 *Buku Kegiatan:* \`${targetBook}\` _(Tab Sheets: ${targetBook})_\n` +
          `📝 *Transaksi:* *${matchingRow.description}*\n` +
          `💰 *Total Nominal:* ${formatRupiah(matchingRow.amount)}\n` +
          `📌 *Baris Sheets:* #${matchingRow.rowNumber}\n\n` +
          (driveLink ? `🔗 [Buka Foto di Google Drive](${driveLink})\n\n` : '') +
          `_Tautan foto otomatis masuk ke Google Sheets pada baris transaksi tersebut tanpa membuat catatan dobel!_`,
        {
          parse_mode: 'Markdown',
          reply_markup: keyboard,
          link_preview_options: { is_disabled: true },
        }
      );
      return;
    }

    // Jika tidak ditemukan transaksi lama yang cocok, simpan sebagai transaksi baru di Google Sheets
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
          `👤 *Penginput:* ${escapeMd(senderName)} ${username ? `(${safeUsername(username)})` : ''}\n` +
          `🆔 *ID:* \`${senderId}\`\n` +
          `📖 *Buku:* \`${activeBook}\`\n` +
          `📅 *Tanggal:* ${parsed.date}\n` +
          `${emoji} *Jenis:* ${parsed.type} (${formatRupiah(parsed.amount)})\n` +
          `📂 *Kategori:* ${escapeMd(parsed.category)}\n` +
          `📝 *Keterangan:* ${escapeMd(parsed.description)}\n` +
          (driveLink ? `📎 [Lihat Foto Nota di Drive](${driveLink})` : `⚠️ _Foto belum tersimpan di Drive_`);

        try {
          await ctx.api.sendMessage(adminId, alertMsg, {
            parse_mode: 'Markdown',
            link_preview_options: { is_disabled: true },
          });
        } catch {
          await ctx.api.sendMessage(
            adminId,
            `🧾 Pantauan Transaksi Nota Anggota!\n\n` +
              `Penginput: ${senderName} (${username || '-'})\n` +
              `ID: ${senderId}\n` +
              `Buku: ${activeBook}\n` +
              `Tanggal: ${parsed.date}\n` +
              `Jenis: ${parsed.type} (${formatRupiah(parsed.amount)})\n` +
              `Kategori: ${parsed.category}\n` +
              `Keterangan: ${parsed.description}\n` +
              (driveLink ? `Foto Drive: ${driveLink}` : '')
          );
        }
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

bot.catch((err) => {
  console.error('Unhandled Grammy bot error:', err.error);
});
