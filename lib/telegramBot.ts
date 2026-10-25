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
import { uploadReceiptToDrive } from './googleDrive';
import { formatPrivateKey, getGoogleAuth } from './googleAuth';
import { generateNotaPdf, HARGA_PER_KG, rupiahFormat } from './generateNota';
import { ExpenseDetail } from './types';

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
      { command: 'kas', description: 'Beralih ke buku Kas Utama' },
      { command: 'buku', description: 'Daftar & ganti buku kegiatan' },
      { command: 'cekkas', description: 'Cek kas anggota (lunas & belum bayar)' },
      { command: 'bayarkas', description: 'Catat pembayaran kas anggota' },
      { command: 'anggota', description: 'Daftar & kelola anggota kas' },
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

// Middleware Keamanan: Whitelist Telegram User ID
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

  const [activeBook, books] = await Promise.all([
    getUserActiveBook(chatId),
    getAllSheetBooks(),
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

  await ctx.reply(
    `👋 *Halo! Saya Bot Pencatat Keuangan & Kas Anggota.*\n\n` +
      `📌 *Buku Aktif Saat Ini:* \`${activeBook}\`\n` +
      `_(Semua chat transaksi & struk nota akan dicatat ke buku ini)_\n\n` +
      `⚙️ *Menu Pembukuan & Rekap:*\n` +
      `• /buat — *Buat Catatan/Buku Baru* (tab baru Sheets)\n` +
      `• /pindahsaldo — *Pindah Saldo* (sisa kegiatan ke Kas/lainnya)\n` +
      `• /rekap — *Rekap Buku Aktif* (\`${activeBook}\`)\n` +
      `• /rekapkas — *Rekap Seluruh Kas* (semua kegiatan + kas)\n` +
      `• /kas — Beralih ke Buku *Kas Utama*\n` +
      `• /buku — Daftar & tombol ganti buku\n\n` +
      `👥 *Menu Iuran Kas Anggota:*\n` +
      `• /cekkas — *Cek Pembayaran Kas* (siapa yang lunas & belum)\n` +
      `• /bayarkas — *Catat Bayar Kas Anggota* (otomatis masuk ke Kas)\n` +
      `• /anggota — *Kelola Anggota* (daftar, tambah, nonaktifkan)\n\n` +
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
        msg += `💰 *Total Kas Telah Dibayar:* *${formatRupiah(res.totalBayar)}*`;

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
        msg += ` • ${s.nama} _(Lunas)_\n`;
      }
    } else {
      msg += ` _Belum ada yang membayar_\n`;
    }

    msg += `\n🔴 *Belum Bayar (${result.belumBayar.length} orang):*\n`;
    if (result.belumBayar.length > 0) {
      for (const b of result.belumBayar) {
        msg += ` • ${b.nama} _(${b.jabatan})_\n`;
      }
    } else {
      msg += ` 🎉 _Semua anggota aktif sudah lunas!_\n`;
    }

    msg += `\n━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `📊 *Ringkasan Bulan ${result.bulan}:*\n`;
    msg += `• 💰 Terkumpul: *${formatRupiah(result.totalTerkumpul)}*\n`;
    msg += `• 🔻 Tunggakan: *${formatRupiah(result.totalTunggakan)}*\n`;
    msg += `• 👥 Anggota Aktif: *${result.totalAnggotaAktif} orang*\n\n`;
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

    // OCR dengan Gemini
    const parsed = await parseReceiptImage(buffer, mimeType, ctx.message.caption);

    if (!parsed) {
      await ctx.reply(
        '⚠️ Gambar tidak terdeteksi sebagai nota/struk belanja atau bukti transfer yang valid. Mohon pastikan foto cukup jelas dan mencakup nominal transaksi.'
      );
      return;
    }

    // Simpan segera ke Google Sheets pada sheet buku yang aktif
    const rowNumber = await appendTransaction(parsed, activeBook);

    const emoji = parsed.type === 'Pemasukan' ? '🟢' : '🔴';
    await ctx.reply(
      `🧾 *Transaksi Berhasil Dicatat!*\n\n` +
        `📖 *Buku:* \`${activeBook}\`\n` +
        `📅 *Tanggal:* ${parsed.date}\n` +
        `${emoji} *Jenis:* ${parsed.type}\n` +
        `📂 *Kategori:* ${parsed.category}\n` +
        `💰 *Total Nominal:* ${formatRupiah(parsed.amount)}\n` +
        `📝 *Keterangan:* ${parsed.description}\n\n` +
        `⏳ _Foto sedang diunggah ke Google Drive di latar belakang..._`,
      { parse_mode: 'Markdown' }
    );

    // Upload ke Drive & rekap di latar belakang
    (async () => {
      // Rekap singkat
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

      // Upload ke Google Drive
      try {
        const driveLink = await uploadReceiptToDrive(buffer, fileName, mimeType);
        if (driveLink) {
          if (rowNumber) {
            await updateTransactionNoteLink(rowNumber, driveLink, activeBook).catch(console.error);
          }
          await ctx.reply(
            `📎 *Foto Tersimpan di Google Drive!*\n` +
              `📖 *Buku:* ${activeBook}\n` +
              `📝 *Item:* ${parsed.description} (${formatRupiah(parsed.amount)})\n` +
              `🔗 [Buka Foto di Google Drive](${driveLink})`,
            { parse_mode: 'Markdown', link_preview_options: { is_disabled: true } }
          ).catch(console.error);
        } else {
          await ctx.reply(
            `⚠️ *Peringatan Google Drive:*\n` +
              `Transaksi berhasil dicatat ke Sheets, tetapi foto nota *gagal tersimpan ke Google Drive*.\n\n` +
              `💡 *Penyebab:* Folder Drive belum dibagikan ke email robot:\n` +
              `\`${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || 'bot-uang-dkc@catat-keuangan-509403.iam.gserviceaccount.com'}\`\n\n` +
              `Silakan buka folder Google Drive Anda lalu share folder tersebut ke email robot dengan akses *Editor*.`,
            { parse_mode: 'Markdown' }
          ).catch(console.error);
        }
      } catch (uploadErr) {
        console.error('Error saat upload background ke Drive:', uploadErr);
      }
    })();
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
