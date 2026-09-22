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
 * Mengambil rekap transaksi bulan berjalan atau bulan tertentu beserta total all-time
 */
export async function getMonthSummary(yearMonthPrefix?: string): Promise<SummaryReport> {
  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const { spreadsheetId, sheetName } = getSheetConfig();

  // Prefix default: YYYY-MM hari ini
  const targetPrefix =
    yearMonthPrefix ||
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
    }).format(new Date());

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A2:E`,
  });

  const rows = res.data.values || [];
  let totalPengeluaran = 0;
  let totalPemasukan = 0;
  let count = 0;

  let totalAllTimePengeluaran = 0;
  let totalAllTimePemasukan = 0;
  let totalAllTimeCount = 0;

  for (const row of rows) {
    const [tglRaw, jenis, _kat, nominalRaw] = row;
    if (!tglRaw || !nominalRaw) continue;

    const cleanNominal =
      typeof nominalRaw === 'number'
        ? nominalRaw
        : parseFloat(String(nominalRaw).replace(/[^0-9.-]+/g, '')) || 0;

    const isPengeluaran = jenis?.toLowerCase().includes('pengeluaran');
    const isPemasukan = jenis?.toLowerCase().includes('pemasukan');

    // Akumulasi Semua Periode (All-Time)
    if (isPengeluaran) {
      totalAllTimePengeluaran += cleanNominal;
      totalAllTimeCount++;
    } else if (isPemasukan) {
      totalAllTimePemasukan += cleanNominal;
      totalAllTimeCount++;
    }

    // Filter berdasarkan Bulan Tertentu
    const ym = normalizeDateToYearMonth(tglRaw);
    if (ym === targetPrefix) {
      if (isPengeluaran) {
        totalPengeluaran += cleanNominal;
        count++;
      } else if (isPemasukan) {
        totalPemasukan += cleanNominal;
        count++;
      }
    }
  }

  return {
    totalPengeluaran,
    totalPemasukan,
    saldo: totalPemasukan - totalPengeluaran,
    count,
    bulan: targetPrefix,
    totalAllTimePengeluaran,
    totalAllTimePemasukan,
    saldoAllTime: totalAllTimePemasukan - totalAllTimePengeluaran,
    totalAllTimeCount,
  };
}
