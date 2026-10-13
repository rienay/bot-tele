import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth';
import { ParsedTransaction, SummaryReport, GlobalSummaryReport, BookSummary } from './types';

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
    if (title.toLowerCase() === 'anggota' || title.toLowerCase() === 'kas_anggota') continue;
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
    range: `'${sheetName}'!A2:E`,
  });

  const rows = res.data.values || [];
  let totalPengeluaran = 0;
  let totalPemasukan = 0;
  let count = 0;
  const categoryExpenses: Record<string, number> = {};
  const categoryIncome: Record<string, number> = {};

  const isAllTime = !yearMonthPrefix;

  for (const row of rows) {
    const [tglRaw, jenis, katRaw, nominalRaw] = row;
    if (!tglRaw || !nominalRaw) continue;

    const cleanNominal =
      typeof nominalRaw === 'number'
        ? nominalRaw
        : parseFloat(String(nominalRaw).replace(/[^0-9.-]+/g, '')) || 0;

    const isPengeluaran = jenis?.toLowerCase().includes('pengeluaran');
    const isPemasukan = jenis?.toLowerCase().includes('pemasukan');
    const kategori = katRaw?.trim() || 'Lain-lain';

    if (!isAllTime) {
      const ym = normalizeDateToYearMonth(tglRaw);
      if (ym !== yearMonthPrefix) {
        continue;
      }
    }

    if (isPengeluaran) {
      totalPengeluaran += cleanNominal;
      categoryExpenses[kategori] = (categoryExpenses[kategori] || 0) + cleanNominal;
      count++;
    } else if (isPemasukan) {
      totalPemasukan += cleanNominal;
      categoryIncome[kategori] = (categoryIncome[kategori] || 0) + cleanNominal;
      count++;
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
