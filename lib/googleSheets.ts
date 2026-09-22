import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth';
import { ParsedTransaction, SummaryReport } from './types';

const SHEET_COLUMNS = [
  'Tanggal',
  'Jenis',
  'Kategori',
  'Nominal',
  'Keterangan',
  'Link Nota',
  'Waktu Input',
];

function getSheetConfig() {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const sheetName = process.env.GOOGLE_SHEET_NAME || 'Transaksi';
  if (!spreadsheetId) {
    throw new Error('GOOGLE_SHEET_ID belum dikonfigurasi di file .env');
  }
  return { spreadsheetId, sheetName };
}

/**
 * Memastikan header kolom sudah dibuat di Google Sheet jika masih kosong.
 */
export async function ensureHeaderRow(): Promise<void> {
  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const { spreadsheetId, sheetName } = getSheetConfig();

  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A1:G1`,
    });

    const values = res.data.values;
    if (!values || values.length === 0 || values[0].length === 0) {
      // Buat header baru
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!A1:G1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [SHEET_COLUMNS],
        },
      });
    }
  } catch (error: any) {
    // Jika sheet belum ada nama sheetName, coba buatkan
    if (error?.message?.includes('Unable to parse range')) {
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
        // Tulis header setelah dibuat
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `${sheetName}!A1:G1`,
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [SHEET_COLUMNS],
          },
        });
      } catch (innerErr) {
        console.error('Gagal membuat sheet baru:', innerErr);
        throw innerErr;
      }
    } else {
      throw error;
    }
  }
}

/**
 * Menambahkan data transaksi ke baris baru Google Sheets
 */
export async function appendTransaction(tx: ParsedTransaction): Promise<number | null> {
  await ensureHeaderRow();

  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const { spreadsheetId, sheetName } = getSheetConfig();

  const nowJakarta = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(new Date());

  // Gunakan tanda kutip tunggal di awal agar Google Sheets menampilkannya sebagai teks tanggal yang rapi (bukan serial angka)
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
    range: `${sheetName}!A:G`,
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
 * Membantu normalisasi berbagai format tanggal (serial Excel, YYYY-MM-DD, DD/MM/YYYY) ke YYYY-MM
 */
export function normalizeDateToYearMonth(val: any): string {
  if (!val) return '';
  const str = String(val).trim().replace(/^'/, '');

  // Format serial number Google Sheets / Excel (contoh: 46247)
  if (/^\d{5}$/.test(str)) {
    const serial = parseInt(str, 10);
    const date = new Date((serial - 25569) * 86400 * 1000);
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }

  // Format YYYY-MM-DD
  const ymd = str.match(/^(\d{4})[/-](\d{1,2})/);
  if (ymd) {
    return `${ymd[1]}-${ymd[2].padStart(2, '0')}`;
  }

  // Format DD/MM/YYYY
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
  noteLink: string
): Promise<void> {
  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const { spreadsheetId, sheetName } = getSheetConfig();

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!F${rowNumber}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[noteLink]],
    },
  });
}

/**
 * Mengambil rekap transaksi.
 * Jika yearMonthPrefix diberikan (misal '2026-08'), akan menghitung KHUSUS bulan tersebut.
 * Jika tidak diberikan (undefined), akan menghitung SEMUA transaksi (All-Time / Keseluruhan).
 */
export async function getMonthSummary(yearMonthPrefix?: string, customLabel?: string): Promise<SummaryReport> {
  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const { spreadsheetId, sheetName } = getSheetConfig();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A2:E`,
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
  };
}
