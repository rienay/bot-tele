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
export async function appendTransaction(tx: ParsedTransaction): Promise<void> {
  await ensureHeaderRow();

  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const { spreadsheetId, sheetName } = getSheetConfig();

  const nowJakarta = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(new Date());

  const rowValues = [
    tx.date,
    tx.type,
    tx.category,
    tx.amount,
    tx.description,
    tx.noteLink || '-',
    nowJakarta,
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A:G`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [rowValues],
    },
  });
}

/**
 * Mengambil rekap transaksi bulan berjalan atau bulan tertentu
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

  for (const row of rows) {
    const [tgl, jenis, _kat, nominalRaw] = row;
    if (!tgl || !nominalRaw) continue;

    // Filter berdasarkan bulan (YYYY-MM)
    if (tgl.startsWith(targetPrefix)) {
      const cleanNominal = typeof nominalRaw === 'number'
        ? nominalRaw
        : parseFloat(String(nominalRaw).replace(/[^0-9.-]+/g, '')) || 0;

      if (jenis?.toLowerCase().includes('pengeluaran')) {
        totalPengeluaran += cleanNominal;
        count++;
      } else if (jenis?.toLowerCase().includes('pemasukan')) {
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
  };
}
