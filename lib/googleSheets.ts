import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth';
import {
  ParsedTransaction,
  SummaryReport,
  GlobalSummaryReport,
  BookSummary,
  ExpenseDetail,
  TransferBalanceParams,
  TransferBalanceResult,
  WebFinanceData,
  WebTransactionItem,
} from './types';

export const DEFAULT_BOOK_NAME = 'Kas';

const SHEET_COLUMNS = [
  'Tanggal',
  'Jenis',
  'Kategori',
  'Nominal',
  'Keterangan',
  'Link Nota',
  'Waktu Input',
];

const SESSION_SHEET_NAME = '_Sessions';

function getSpreadsheetId(): string {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) {
    throw new Error('GOOGLE_SHEET_ID belum dikonfigurasi di file .env');
  }
  return spreadsheetId;
}

// In-memory cache untuk sesi buku aktif pengguna (chatId -> bookName)
const activeBookCache = new Map<string, string>();
// In-memory cache daftar sheets dengan timestamp (TTL 30 detik)
let cachedSheetList: { list: string[]; timestamp: number } | null = null;
const CACHE_TTL_MS = 30_000;

/**
 * Membersihkan nama sheet agar valid di Google Sheets
 */
export function sanitizeBookName(rawName: string): string {
  return rawName
    .trim()
    .replace(/[\\/\?\*\[\]:]/g, '') // Karakter terlarang di Google Sheets
    .replace(/\s+/g, ' ')
    .slice(0, 30);
}

/**
 * Memastikan header kolom sudah dibuat di Google Sheet jika masih kosong.
 */
export async function ensureHeaderRow(sheetName: string = DEFAULT_BOOK_NAME): Promise<void> {
  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = getSpreadsheetId();

  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetName}'!A1:G1`,
    });

    const values = res.data.values;
    if (!values || values.length === 0 || values[0].length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${sheetName}'!A1:G1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [SHEET_COLUMNS],
        },
      });
    }
  } catch (error: any) {
    // Jika sheet belum ada, buatkan sheet baru
    if (
      error?.message?.includes('Unable to parse range') ||
      error?.message?.includes('not found')
    ) {
      try {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [
              {
                addSheet: {
                  properties: { title: sheetName },
                },
              },
            ],
          },
        });
        // Tulis header
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `'${sheetName}'!A1:G1`,
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [SHEET_COLUMNS],
          },
        });
        // Invalidate cache sheet list
        cachedSheetList = null;
      } catch (innerErr) {
        console.error(`Gagal membuat sheet baru '${sheetName}':`, innerErr);
        throw innerErr;
      }
    } else {
      throw error;
    }
  }
}

/**
 * Mengambil daftar seluruh buku/kegiatan yang ada di spreadsheet.
 * Mengabaikan tab internal (_Sessions) dan tab default kosong.
 */
export async function getAllSheetBooks(forceRefresh = false): Promise<string[]> {
  const now = Date.now();
  if (!forceRefresh && cachedSheetList && now - cachedSheetList.timestamp < CACHE_TTL_MS) {
    return cachedSheetList.list;
  }

  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = getSpreadsheetId();

  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetsList = meta.data.sheets || [];

  const validBooks: string[] = [];
  for (const s of sheetsList) {
    const title = s.properties?.title;
    if (!title) continue;
    // Abaikan sheet internal yang diawali underscore
    if (title.startsWith('_')) continue;
    if (title.toLowerCase() === 'sheet1') continue;
    if (
      title.toLowerCase() === 'anggota' ||
      title.toLowerCase() === 'kas_anggota' ||
      title.toLowerCase() === 'dashboard'
    )
      continue;
    validBooks.push(title);
  }

  // Pastikan 'Kas' ada dalam list
  const hasKas = validBooks.some((b) => b.toLowerCase() === DEFAULT_BOOK_NAME.toLowerCase());
  if (!hasKas) {
    validBooks.unshift(DEFAULT_BOOK_NAME);
  } else {
    // Taruh 'Kas' di urutan pertama
    const kasIdx = validBooks.findIndex((b) => b.toLowerCase() === DEFAULT_BOOK_NAME.toLowerCase());
    if (kasIdx > 0) {
      const [kasItem] = validBooks.splice(kasIdx, 1);
      validBooks.unshift(kasItem);
    }
  }

  cachedSheetList = { list: validBooks, timestamp: now };
  return validBooks;
}

/**
 * Membuat sheet buku/kegiatan baru jika belum ada.
 */
export async function createSheetBook(
  rawName: string
): Promise<{ created: boolean; bookName: string }> {
  const cleanName = sanitizeBookName(rawName);
  if (!cleanName) {
    throw new Error('Nama kegiatan tidak boleh kosong.');
  }

  const books = await getAllSheetBooks(true);
  const existing = books.find((b) => b.toLowerCase() === cleanName.toLowerCase());
  if (existing) {
    return { created: false, bookName: existing };
  }

  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = getSpreadsheetId();

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: { title: cleanName },
          },
        },
      ],
    },
  });

  // Tulis header kolom
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${cleanName}'!A1:G1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [SHEET_COLUMNS],
    },
  });

  cachedSheetList = null;
  return { created: true, bookName: cleanName };
}

/**
 * Memastikan sheet _Sessions tersedia untuk menyimpan status buku aktif per pengguna
 */
async function ensureSessionSheet(): Promise<void> {
  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = getSpreadsheetId();

  try {
    await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${SESSION_SHEET_NAME}'!A1:C1`,
    });
  } catch (error: any) {
    if (
      error?.message?.includes('Unable to parse range') ||
      error?.message?.includes('not found')
    ) {
      try {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [
              {
                addSheet: {
                  properties: { title: SESSION_SHEET_NAME },
                },
              },
            ],
          },
        });
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `'${SESSION_SHEET_NAME}'!A1:C1`,
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [['Chat ID', 'Active Book', 'Updated At']],
          },
        });
      } catch (e) {
        console.warn('Gagal membuat session sheet:', e);
      }
    }
  }
}

/**
 * Mengambil nama buku aktif untuk pengguna tertentu
 */
export async function getUserActiveBook(chatId: number | string): Promise<string> {
  const strId = String(chatId);
  if (activeBookCache.has(strId)) {
    return activeBookCache.get(strId)!;
  }

  try {
    await ensureSessionSheet();
    const auth = getGoogleAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = getSpreadsheetId();

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${SESSION_SHEET_NAME}'!A2:B`,
    });

    const rows = res.data.values || [];
    for (const row of rows) {
      if (row[0] && String(row[0]).trim() === strId && row[1]) {
        const book = String(row[1]).trim();
        activeBookCache.set(strId, book);
        return book;
      }
    }
  } catch (err) {
    console.warn('Gagal membaca active book dari sheet, fallback default:', err);
  }

  activeBookCache.set(strId, DEFAULT_BOOK_NAME);
  return DEFAULT_BOOK_NAME;
}

/**
 * Mengubah nama buku aktif untuk pengguna tertentu
 */
export async function setUserActiveBook(
  chatId: number | string,
  bookName: string
): Promise<void> {
  const strId = String(chatId);
  activeBookCache.set(strId, bookName);

  // Simpan secara persisten ke sheet _Sessions
  try {
    await ensureSessionSheet();
    const auth = getGoogleAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = getSpreadsheetId();

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${SESSION_SHEET_NAME}'!A2:C`,
    });

    const rows = res.data.values || [];
    let existingRowIndex = -1;

    for (let i = 0; i < rows.length; i++) {
      if (rows[i][0] && String(rows[i][0]).trim() === strId) {
        existingRowIndex = i + 2; // baris ke- (1-indexed + header)
        break;
      }
    }

    const nowJakarta = new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      dateStyle: 'short',
      timeStyle: 'medium',
    }).format(new Date());

    if (existingRowIndex > 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${SESSION_SHEET_NAME}'!B${existingRowIndex}:C${existingRowIndex}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [[bookName, nowJakarta]],
        },
      });
    } else {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `'${SESSION_SHEET_NAME}'!A:C`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: [[strId, bookName, nowJakarta]],
        },
      });
    }
  } catch (err) {
    console.error('Gagal menyimpan sesi aktif pengguna ke Google Sheet:', err);
  }
}

/**
 * Menambahkan data transaksi ke baris baru Google Sheets pada buku/halaman tertentu
 */
export async function appendTransaction(
  tx: ParsedTransaction,
  sheetName: string = DEFAULT_BOOK_NAME
): Promise<number | null> {
  await ensureHeaderRow(sheetName);

  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = getSpreadsheetId();

  const nowJakarta = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(new Date());

  const formattedDate = tx.date.startsWith("'") ? tx.date : `'${tx.date}`;

  const rowValues = [
    formattedDate,
    tx.type,
    tx.category,
    tx.amount,
    tx.description,
    tx.noteLink || '-',
    nowJakarta,
  ];

  const res = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${sheetName}'!A:G`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [rowValues],
    },
  });

  const updatedRange = res.data.updates?.updatedRange;
  if (updatedRange) {
    const match = updatedRange.match(/!A(\d+)/);
    if (match) {
      return parseInt(match[1], 10);
    }
  }
  return null;
}

/**
 * Membantu normalisasi berbagai format tanggal ke YYYY-MM
 */
export function normalizeDateToYearMonth(val: any): string {
  if (!val) return '';
  const str = String(val).trim().replace(/^'/, '');

  if (/^\d{5}$/.test(str)) {
    const serial = parseInt(str, 10);
    const date = new Date((serial - 25569) * 86400 * 1000);
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }

  const ymd = str.match(/^(\d{4})[/-](\d{1,2})/);
  if (ymd) {
    return `${ymd[1]}-${ymd[2].padStart(2, '0')}`;
  }

  const dmy = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, '0')}`;
  }

  return str;
}

/**
 * Memperbarui link foto nota di kolom F pada baris tertentu
 */
export async function updateTransactionNoteLink(
  rowNumber: number,
  noteLink: string,
  sheetName: string = DEFAULT_BOOK_NAME
): Promise<void> {
  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = getSpreadsheetId();

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${sheetName}'!F${rowNumber}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[noteLink]],
    },
  });
}

/**
 * Mengambil rekap transaksi untuk 1 buku/halaman tertentu
 */
export async function getMonthSummary(
  yearMonthPrefix?: string,
  customLabel?: string,
  sheetName: string = DEFAULT_BOOK_NAME
): Promise<SummaryReport & { bookName: string }> {
  await ensureHeaderRow(sheetName);

  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = getSpreadsheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetName}'!A2:G`,
  });

  const rows = res.data.values || [];
  let totalPengeluaran = 0;
  let totalPemasukan = 0;
  let count = 0;
  const categoryExpenses: Record<string, number> = {};
  const categoryIncome: Record<string, number> = {};
  const expenseDetails: ExpenseDetail[] = [];
  const incomeDetails: ExpenseDetail[] = [];

  const isAllTime = !yearMonthPrefix;

  for (const row of rows) {
    const [tglRaw, jenis, katRaw, nominalRaw, keteranganRaw, noteLinkRaw] = row;
    if (!tglRaw || !nominalRaw) continue;

    const cleanNominal =
      typeof nominalRaw === 'number'
        ? nominalRaw
        : parseFloat(String(nominalRaw).replace(/[^0-9.-]+/g, '')) || 0;

    const isPengeluaran = jenis?.toLowerCase().includes('pengeluaran');
    const isPemasukan = jenis?.toLowerCase().includes('pemasukan');
    const kategori = katRaw?.trim() || 'Lain-lain';
    const keterangan = keteranganRaw ? String(keteranganRaw).trim() : '';
    const noteLink = noteLinkRaw ? String(noteLinkRaw).trim() : '';

    const cleanDate = String(tglRaw).trim().replace(/^'/, '');

    if (!isAllTime) {
      const ym = normalizeDateToYearMonth(cleanDate);
      if (ym !== yearMonthPrefix) {
        continue;
      }
    }

    if (isPengeluaran) {
      totalPengeluaran += cleanNominal;
      categoryExpenses[kategori] = (categoryExpenses[kategori] || 0) + cleanNominal;
      count++;
      expenseDetails.push({
        date: cleanDate,
        category: kategori,
        nominal: cleanNominal,
        description: keterangan,
        noteLink: noteLink && noteLink !== '-' ? noteLink : undefined,
      });
    } else if (isPemasukan) {
      totalPemasukan += cleanNominal;
      categoryIncome[kategori] = (categoryIncome[kategori] || 0) + cleanNominal;
      count++;
      incomeDetails.push({
        date: cleanDate,
        category: kategori,
        nominal: cleanNominal,
        description: keterangan,
        noteLink: noteLink && noteLink !== '-' ? noteLink : undefined,
      });
    }
  }

  const periodeLabel = isAllTime
    ? 'Semua Transaksi (Keseluruhan)'
    : customLabel || yearMonthPrefix || '';

  return {
    isAllTime,
    periodeLabel,
    totalPengeluaran,
    totalPemasukan,
    saldo: totalPemasukan - totalPengeluaran,
    count,
    categoryExpenses,
    categoryIncome,
    expenseDetails,
    incomeDetails,
    bookName: sheetName,
  };
}

/**
 * Mengambil rekap transaksi KESELURUHAN (Semua Tab / Kegiatan + Kas Utama)
 */
export async function getAllSheetsSummary(
  yearMonthPrefix?: string,
  customLabel?: string
): Promise<GlobalSummaryReport> {
  const books = await getAllSheetBooks();

  let totalPengeluaran = 0;
  let totalPemasukan = 0;
  let count = 0;
  const categoryExpenses: Record<string, number> = {};
  const categoryIncome: Record<string, number> = {};
  const booksSummary: BookSummary[] = [];

  const isAllTime = !yearMonthPrefix;

  for (const book of books) {
    try {
      const bSummary = await getMonthSummary(yearMonthPrefix, customLabel, book);

      booksSummary.push({
        bookName: book,
        totalPengeluaran: bSummary.totalPengeluaran,
        totalPemasukan: bSummary.totalPemasukan,
        saldo: bSummary.saldo,
        count: bSummary.count,
      });

      totalPengeluaran += bSummary.totalPengeluaran;
      totalPemasukan += bSummary.totalPemasukan;
      count += bSummary.count;

      for (const [cat, val] of Object.entries(bSummary.categoryExpenses)) {
        categoryExpenses[cat] = (categoryExpenses[cat] || 0) + val;
      }
      for (const [cat, val] of Object.entries(bSummary.categoryIncome)) {
        categoryIncome[cat] = (categoryIncome[cat] || 0) + val;
      }
    } catch (err) {
      console.warn(`Gagal membaca summary untuk sheet '${book}':`, err);
    }
  }

  const periodeLabel = isAllTime
    ? 'Semua Transaksi (Keseluruhan)'
    : customLabel || yearMonthPrefix || '';

  return {
    isAllTime,
    periodeLabel,
    totalPengeluaran,
    totalPemasukan,
    saldo: totalPemasukan - totalPengeluaran,
    count,
    categoryExpenses,
    categoryIncome,
    books: booksSummary,
  };
}

/**
 * Memindahkan saldo dari satu buku/kegiatan ke buku lainnya.
 * Mencatat 'Pengeluaran' pada buku asal dan 'Pemasukan' pada buku tujuan.
 */
export async function transferBookBalance(
  params: TransferBalanceParams
): Promise<TransferBalanceResult> {
  const cleanSource = sanitizeBookName(params.sourceBook);
  const cleanTarget = sanitizeBookName(params.targetBook);

  if (!cleanSource || !cleanTarget) {
    throw new Error('Nama buku asal dan buku tujuan tidak valid.');
  }

  if (cleanSource.toLowerCase() === cleanTarget.toLowerCase()) {
    throw new Error('Buku asal dan buku tujuan tidak boleh sama.');
  }

  const books = await getAllSheetBooks();
  const sourceExists = books.find((b) => b.toLowerCase() === cleanSource.toLowerCase());
  if (!sourceExists) {
    throw new Error(`Buku asal "${cleanSource}" tidak ditemukan.`);
  }

  const targetExists = books.find((b) => b.toLowerCase() === cleanTarget.toLowerCase());
  if (!targetExists) {
    throw new Error(`Buku tujuan "${cleanTarget}" tidak ditemukan.`);
  }

  if (params.amount <= 0) {
    throw new Error('Nominal pemindahan saldo harus lebih dari 0.');
  }

  const [sourceSummary, targetSummary] = await Promise.all([
    getMonthSummary(undefined, undefined, sourceExists),
    getMonthSummary(undefined, undefined, targetExists),
  ]);

  if (sourceSummary.saldo < params.amount) {
    throw new Error(
      `Saldo buku "${sourceExists}" tidak mencukupi. Sisa saldo saat ini: Rp ${sourceSummary.saldo.toLocaleString('id-ID')}, nominal yang ingin dipindah: Rp ${params.amount.toLocaleString('id-ID')}`
    );
  }

  const todayStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  const sourceDesc = params.description
    ? `Pindah saldo ke ${targetExists} (${params.description})`
    : `Pindah saldo ke buku ${targetExists}`;

  const targetDesc = params.description
    ? `Pindah saldo dari ${sourceExists} (${params.description})`
    : `Pindah saldo dari buku ${sourceExists}`;

  // 1. Catat Pengeluaran di buku asal
  await appendTransaction(
    {
      date: todayStr,
      type: 'Pengeluaran',
      category: 'Pindah Saldo',
      amount: params.amount,
      description: sourceDesc,
    },
    sourceExists
  );

  // 2. Catat Pemasukan di buku tujuan
  await appendTransaction(
    {
      date: todayStr,
      type: 'Pemasukan',
      category: 'Pindah Saldo',
      amount: params.amount,
      description: targetDesc,
    },
    targetExists
  );

  return {
    success: true,
    sourceBook: sourceExists,
    targetBook: targetExists,
    amount: params.amount,
    sourceBalanceBefore: sourceSummary.saldo,
    sourceBalanceAfter: sourceSummary.saldo - params.amount,
    targetBalanceBefore: targetSummary.saldo,
    targetBalanceAfter: targetSummary.saldo + params.amount,
    date: todayStr,
  };
}

// In-memory cache untuk transaksi web (key: bookName, value: { data: WebFinanceData, timestamp: number })
const webFinanceCache = new Map<string, { data: WebFinanceData; timestamp: number }>();
const WEB_CACHE_TTL_MS = 20_000; // 20 detik

/**
 * Mengambil seluruh data transaksi dan agregasi statistik untuk ditampilkan di Website Dashboard Keuangan
 */
export async function getAllTransactionsForWeb(targetBook: string = 'Semua'): Promise<WebFinanceData> {
  const normalizedTarget = targetBook.trim().toLowerCase();
  const now = Date.now();
  const cacheKey = normalizedTarget;

  const cached = webFinanceCache.get(cacheKey);
  if (cached && now - cached.timestamp < WEB_CACHE_TTL_MS) {
    return cached.data;
  }

  const books = await getAllSheetBooks();
  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = getSpreadsheetId();

  const isAll = normalizedTarget === 'semua' || normalizedTarget === 'all' || normalizedTarget === '';
  const booksToFetch = isAll
    ? books
    : books.filter((b) => b.toLowerCase() === normalizedTarget);

  const fetchPromises = booksToFetch.map(async (book) => {
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${book}'!A2:G`,
      });
      return { book, rows: res.data.values || [] };
    } catch (e) {
      console.warn(`Gagal fetch transactions untuk web dari ${book}:`, e);
      return { book, rows: [] };
    }
  });

  const results = await Promise.all(fetchPromises);

  const allItems: WebTransactionItem[] = [];
  let totalPemasukan = 0;
  let totalPengeluaran = 0;
  const categoryExpenses: Record<string, number> = {};
  const categoryIncome: Record<string, number> = {};

  let globalId = 1;

  for (const { book, rows } of results) {
    for (let rIdx = 0; rIdx < rows.length; rIdx++) {
      const row = rows[rIdx];
      const [tglRaw, jenisRaw, katRaw, nominalRaw, keteranganRaw, noteLinkRaw, waktuRaw] = row;
      if (!tglRaw || !nominalRaw) continue;

      const cleanNominal =
        typeof nominalRaw === 'number'
          ? nominalRaw
          : parseFloat(String(nominalRaw).replace(/[^0-9.-]+/g, '')) || 0;

      if (cleanNominal <= 0) continue;

      const jenis = String(jenisRaw || '').toLowerCase().includes('pemasukan')
        ? ('Pemasukan' as const)
        : ('Pengeluaran' as const);

      const kategori = katRaw ? String(katRaw).trim() : 'Lain-lain';
      const keterangan = keteranganRaw ? String(keteranganRaw).trim() : '';
      const cleanDate = String(tglRaw).trim().replace(/^'/, '');
      const noteLink = noteLinkRaw && String(noteLinkRaw).startsWith('http') ? String(noteLinkRaw).trim() : undefined;
      const inputTime = waktuRaw ? String(waktuRaw).trim() : undefined;

      // Ekstrak PIC jika ada di keterangan, e.g. (PIC: @username) atau (PIC: nama)
      let pic: string | undefined;
      const picMatch = keterangan.match(/[\(\[]\s*PIC\s*:\s*([^\]\)]+)[\)\]]/i);
      if (picMatch) {
        pic = picMatch[1].trim();
      }

      if (jenis === 'Pemasukan') {
        totalPemasukan += cleanNominal;
        categoryIncome[kategori] = (categoryIncome[kategori] || 0) + cleanNominal;
      } else {
        totalPengeluaran += cleanNominal;
        categoryExpenses[kategori] = (categoryExpenses[kategori] || 0) + cleanNominal;
      }

      allItems.push({
        id: `${book}-${rIdx + 2}-${globalId++}`,
        book,
        date: cleanDate,
        type: jenis,
        category: kategori,
        amount: cleanNominal,
        description: keterangan,
        noteLink,
        pic,
        inputTime,
      });
    }
  }

  // Urutkan transaksi dari tanggal terbaru ke terlama
  allItems.sort((a, b) => {
    return b.date.localeCompare(a.date);
  });

  const nowJakarta = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date());

  const data: WebFinanceData = {
    books: ['Semua', ...books],
    activeBook: isAll ? 'Semua' : (books.find((b) => b.toLowerCase() === normalizedTarget) || 'Semua'),
    transactions: allItems,
    stats: {
      totalPemasukan,
      totalPengeluaran,
      saldo: totalPemasukan - totalPengeluaran,
      count: allItems.length,
      categoryExpenses,
      categoryIncome,
    },
    lastUpdated: nowJakarta,
  };

  webFinanceCache.set(cacheKey, { data, timestamp: now });
  return data;
}

export interface RecentTransactionItem {
  rowNumber: number;
  date: string;
  type: string;
  category: string;
  amount: number;
  description: string;
  noteLink: string;
  hasPhoto: boolean;
  createdAt: string;
}

/**
 * Mengambil transaksi terbaru untuk mengecek status foto nota pada buku/sheet tertentu
 */
export async function getRecentTransactionsWithNotes(
  sheetName: string = DEFAULT_BOOK_NAME,
  limit: number = 8
): Promise<RecentTransactionItem[]> {
  await ensureHeaderRow(sheetName);

  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = getSpreadsheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetName}'!A2:G`,
  });

  const rows = res.data.values || [];
  const items: RecentTransactionItem[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const [tglRaw, jenisRaw, katRaw, nominalRaw, keteranganRaw, noteLinkRaw, waktuRaw] = row;
    if (!tglRaw && !nominalRaw) continue;

    const cleanNominal = typeof nominalRaw === 'number'
      ? nominalRaw
      : parseInt(String(nominalRaw || 0).replace(/[^0-9]/g, ''), 10) || 0;

    const link = String(noteLinkRaw || '').trim();
    const hasPhoto = link.startsWith('http://') || link.startsWith('https://');

    items.push({
      rowNumber: i + 2,
      date: String(tglRaw || '').replace(/^'/, ''),
      type: String(jenisRaw || ''),
      category: String(katRaw || ''),
      amount: cleanNominal,
      description: String(keteranganRaw || '-'),
      noteLink: link,
      hasPhoto,
      createdAt: String(waktuRaw || '-'),
    });
  }

  // Ambil transaksi paling baru (dari baris paling bawah)
  return items.slice(-limit).reverse();
}

/**
 * Mengambil detail 1 baris transaksi tertentu berdasarkan rowNumber
 */
export async function getTransactionByRow(
  sheetName: string = DEFAULT_BOOK_NAME,
  rowNumber: number
): Promise<RecentTransactionItem | null> {
  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = getSpreadsheetId();

  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetName}'!A${rowNumber}:G${rowNumber}`,
    });

    const rows = res.data.values || [];
    if (rows.length === 0) return null;

    const [tglRaw, jenisRaw, katRaw, nominalRaw, keteranganRaw, noteLinkRaw, waktuRaw] = rows[0];
    const cleanNominal = typeof nominalRaw === 'number'
      ? nominalRaw
      : parseInt(String(nominalRaw || 0).replace(/[^0-9]/g, ''), 10) || 0;
    const link = String(noteLinkRaw || '').trim();

    return {
      rowNumber,
      date: String(tglRaw || '').replace(/^'/, ''),
      type: String(jenisRaw || ''),
      category: String(katRaw || ''),
      amount: cleanNominal,
      description: String(keteranganRaw || '-'),
      noteLink: link,
      hasPhoto: link.startsWith('http://') || link.startsWith('https://'),
      createdAt: String(waktuRaw || '-'),
    };
  } catch {
    return null;
  }
}

/**
 * Mencari baris transaksi di Google Sheets yang cocok dengan kriteria (tanpa foto atau berdasarkan nominal/keterangan)
 */
export async function findMatchingTransactionRow(
  sheetName: string = DEFAULT_BOOK_NAME,
  criteria: {
    amount?: number;
    description?: string;
    date?: string;
  }
): Promise<RecentTransactionItem | null> {
  await ensureHeaderRow(sheetName);

  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = getSpreadsheetId();

  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetName}'!A2:G`,
    });

    const rows = res.data.values || [];
    if (rows.length === 0) return null;

    let candidateWithoutPhoto: RecentTransactionItem | null = null;
    let candidateAny: RecentTransactionItem | null = null;

    // Scan dari baris paling bawah (transaksi terbaru)
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i];
      const [tglRaw, jenisRaw, katRaw, nominalRaw, keteranganRaw, noteLinkRaw, waktuRaw] = row;
      if (!tglRaw && !nominalRaw) continue;

      const cleanNominal = typeof nominalRaw === 'number'
        ? nominalRaw
        : parseInt(String(nominalRaw || 0).replace(/[^0-9]/g, ''), 10) || 0;

      const rowDesc = String(keteranganRaw || '').toLowerCase();
      const link = String(noteLinkRaw || '').trim();
      const hasPhoto = link.startsWith('http://') || link.startsWith('https://');

      // 1. Cek kecocokan nominal jika disediakan
      if (criteria.amount !== undefined && criteria.amount > 0) {
        if (cleanNominal !== criteria.amount) continue;
      }

      // 2. Cek kecocokan deskripsi jika ada
      if (criteria.description) {
        const critDesc = criteria.description.toLowerCase().trim();
        const cleanCrit = critDesc.replace(/\(pic:[^)]+\)/gi, '').trim();
        const cleanRow = rowDesc.replace(/\(pic:[^)]+\)/gi, '').trim();

        const words = cleanCrit.split(/\s+/).filter((w) => w.length > 2);
        const matchScore = words.filter((w) => cleanRow.includes(w)).length;

        if (words.length > 0 && matchScore === 0 && !cleanRow.includes(cleanCrit) && !cleanCrit.includes(cleanRow)) {
          continue;
        }
      }

      const item: RecentTransactionItem = {
        rowNumber: i + 2,
        date: String(tglRaw || '').replace(/^'/, ''),
        type: String(jenisRaw || ''),
        category: String(katRaw || ''),
        amount: cleanNominal,
        description: String(keteranganRaw || '-'),
        noteLink: link,
        hasPhoto,
        createdAt: String(waktuRaw || '-'),
      };

      // Prioritaskan transaksi yang belum memiliki foto
      if (!hasPhoto) {
        return item;
      }

      if (!candidateAny) {
        candidateAny = item;
      }
    }

    return candidateWithoutPhoto || candidateAny;
  } catch (err) {
    console.warn('Gagal mencari transaksi matching:', err);
    return null;
  }
}

/**
 * Mencari baris transaksi di semua buku/sheet jika tidak ditemukan di sheet utama
 */
export async function findMatchingTransactionRowAcrossBooks(
  primarySheet: string,
  criteria: {
    amount?: number;
    description?: string;
    date?: string;
  }
): Promise<{ item: RecentTransactionItem; bookName: string } | null> {
  // 1. Coba di primarySheet (buku aktif) terlebih dahulu
  const foundPrimary = await findMatchingTransactionRow(primarySheet, criteria);
  if (foundPrimary) {
    return { item: foundPrimary, bookName: primarySheet };
  }

  // 2. Jika tidak ditemukan, cari di semua sheet buku lainnya
  try {
    const allBooks = await getAllSheetBooks();
    for (const book of allBooks) {
      if (book.toLowerCase() === primarySheet.toLowerCase()) continue;
      const foundOther = await findMatchingTransactionRow(book, criteria);
      if (foundOther) {
        return { item: foundOther, bookName: book };
      }
    }
  } catch (err) {
    console.warn('Gagal mencari di sheet lain:', err);
  }

  return null;
}





