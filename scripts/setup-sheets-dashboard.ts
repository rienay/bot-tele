import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth';

function getSpreadsheetId(): string {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) throw new Error('GOOGLE_SHEET_ID belum dikonfigurasi di .env.local');
  return id;
}

// Helper warna Google Sheets RGBA (0 to 1)
function color(r: number, g: number, b: number) {
  return { red: r / 255, green: g / 255, blue: b / 255 };
}

async function run() {
  console.log('🚀 Memulai penataan tampilan Google Sheets & pembuatan Dashboard Profesional dengan Chart...');
  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = getSpreadsheetId();

  // 1. Ambil daftar sheet saat ini
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets(properties,charts)',
  });
  const existingSheets = meta.data.sheets || [];

  let dashboardSheetId: number | null = null;
  let kasSheetId: number | null = null;
  let anggotaSheetId: number | null = null;
  let kasAnggotaSheetId: number | null = null;
  let sessionsSheetId: number | null = null;

  for (const s of existingSheets) {
    const title = s.properties?.title;
    const id = s.properties?.sheetId ?? 0;
    if (title?.toLowerCase() === 'dashboard') dashboardSheetId = id;
    if (title?.toLowerCase() === 'kas') kasSheetId = id;
    if (title?.toLowerCase() === 'anggota') anggotaSheetId = id;
    if (title?.toLowerCase() === 'kas_anggota') kasAnggotaSheetId = id;
    if (title?.toLowerCase() === '_sessions') sessionsSheetId = id;
  }

  const batchRequests: any[] = [];

  // Hapus chart lama jika ada di sheet Dashboard agar tidak duplikat
  const dashSheetObj = existingSheets.find((s) => s.properties?.title?.toLowerCase() === 'dashboard');
  if (dashSheetObj?.charts && dashSheetObj.charts.length > 0) {
    for (const c of dashSheetObj.charts) {
      if (c.chartId) {
        batchRequests.push({ deleteEmbeddedObject: { objectId: c.chartId } });
      }
    }
  }

  // 2. Buat sheet Dashboard jika belum ada, atau set index ke 0 jika sudah ada
  if (dashboardSheetId === null) {
    const newSheetId = Math.floor(100000000 + Math.random() * 900000000);
    dashboardSheetId = newSheetId;
    batchRequests.push({
      addSheet: {
        properties: {
          sheetId: newSheetId,
          title: 'Dashboard',
          index: 0,
          gridProperties: {
            rowCount: 65,
            columnCount: 15,
            hideGridlines: false,
          },
          tabColor: color(16, 185, 129), // Emerald
        },
      },
    });
  } else {
    batchRequests.push({
      updateSheetProperties: {
        properties: {
          sheetId: dashboardSheetId,
          index: 0,
          tabColor: color(16, 185, 129),
        },
        fields: 'index,tabColor',
      },
    });
  }

  // Sembunyikan _Sessions dan Sheet1 agar spreadsheet bersih & rapi
  if (sessionsSheetId !== null) {
    batchRequests.push({
      updateSheetProperties: {
        properties: {
          sheetId: sessionsSheetId,
          hidden: true,
        },
        fields: 'hidden',
      },
    });
  }

  const sheet1 = existingSheets.find((s) => s.properties?.title?.toLowerCase() === 'sheet1');
  if (sheet1 && sheet1.properties?.sheetId !== undefined) {
    batchRequests.push({
      updateSheetProperties: {
        properties: {
          sheetId: sheet1.properties.sheetId,
          hidden: true,
        },
        fields: 'hidden',
      },
    });
  }

  // 3. Rapikan Sheet 'Kas'
  if (kasSheetId !== null) {
    console.log('✨ Menata sheet Kas (headers, freeze row, currency, conditional formatting)...');
    batchRequests.push(
      {
        updateSheetProperties: {
          properties: {
            sheetId: kasSheetId,
            index: 1,
            gridProperties: { frozenRowCount: 1 },
            tabColor: color(59, 130, 246), // Blue
          },
          fields: 'index,gridProperties.frozenRowCount,tabColor',
        },
      },
      {
        updateDimensionProperties: {
          range: { sheetId: kasSheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 },
          properties: { pixelSize: 115 },
          fields: 'pixelSize',
        },
      },
      {
        updateDimensionProperties: {
          range: { sheetId: kasSheetId, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 },
          properties: { pixelSize: 125 },
          fields: 'pixelSize',
        },
      },
      {
        updateDimensionProperties: {
          range: { sheetId: kasSheetId, dimension: 'COLUMNS', startIndex: 2, endIndex: 3 },
          properties: { pixelSize: 165 },
          fields: 'pixelSize',
        },
      },
      {
        updateDimensionProperties: {
          range: { sheetId: kasSheetId, dimension: 'COLUMNS', startIndex: 3, endIndex: 4 },
          properties: { pixelSize: 145 },
          fields: 'pixelSize',
        },
      },
      {
        updateDimensionProperties: {
          range: { sheetId: kasSheetId, dimension: 'COLUMNS', startIndex: 4, endIndex: 5 },
          properties: { pixelSize: 280 },
          fields: 'pixelSize',
        },
      },
      {
        updateDimensionProperties: {
          range: { sheetId: kasSheetId, dimension: 'COLUMNS', startIndex: 5, endIndex: 6 },
          properties: { pixelSize: 110 },
          fields: 'pixelSize',
        },
      },
      {
        updateDimensionProperties: {
          range: { sheetId: kasSheetId, dimension: 'COLUMNS', startIndex: 6, endIndex: 7 },
          properties: { pixelSize: 175 },
          fields: 'pixelSize',
        },
      },
      {
        updateDimensionProperties: {
          range: { sheetId: kasSheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
          properties: { pixelSize: 38 },
          fields: 'pixelSize',
        },
      },
      {
        repeatCell: {
          range: { sheetId: kasSheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 7 },
          cell: {
            userEnteredFormat: {
              backgroundColor: color(30, 41, 59),
              textFormat: { foregroundColor: color(255, 255, 255), bold: true, fontSize: 10 },
              horizontalAlignment: 'CENTER',
              verticalAlignment: 'MIDDLE',
            },
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
        },
      },
      {
        repeatCell: {
          range: { sheetId: kasSheetId, startRowIndex: 1, startColumnIndex: 3, endColumnIndex: 4 },
          cell: {
            userEnteredFormat: {
              numberFormat: { type: 'CURRENCY', pattern: '"Rp"#,##0' },
              horizontalAlignment: 'RIGHT',
              verticalAlignment: 'MIDDLE',
            },
          },
          fields: 'userEnteredFormat(numberFormat,horizontalAlignment,verticalAlignment)',
        },
      },
      {
        repeatCell: {
          range: { sheetId: kasSheetId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: 2 },
          cell: {
            userEnteredFormat: {
              horizontalAlignment: 'CENTER',
              verticalAlignment: 'MIDDLE',
            },
          },
          fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment)',
        },
      },
      {
        addConditionalFormatRule: {
          rule: {
            ranges: [{ sheetId: kasSheetId, startRowIndex: 1, startColumnIndex: 1, endColumnIndex: 2 }],
            booleanRule: {
              condition: { type: 'TEXT_CONTAINS', values: [{ userEnteredValue: 'Pemasukan' }] },
              format: {
                backgroundColor: color(220, 252, 231),
                textFormat: { foregroundColor: color(22, 101, 52), bold: true },
              },
            },
          },
          index: 0,
        },
      },
      {
        addConditionalFormatRule: {
          rule: {
            ranges: [{ sheetId: kasSheetId, startRowIndex: 1, startColumnIndex: 1, endColumnIndex: 2 }],
            booleanRule: {
              condition: { type: 'TEXT_CONTAINS', values: [{ userEnteredValue: 'Pengeluaran' }] },
              format: {
                backgroundColor: color(254, 226, 226),
                textFormat: { foregroundColor: color(153, 27, 27), bold: true },
              },
            },
          },
          index: 1,
        },
      }
    );
  }

  // 4. Rapikan Sheet 'Anggota'
  if (anggotaSheetId !== null) {
    batchRequests.push(
      {
        updateSheetProperties: {
          properties: {
            sheetId: anggotaSheetId,
            index: 3,
            gridProperties: { frozenRowCount: 1 },
            tabColor: color(99, 102, 241), // Indigo
          },
          fields: 'index,gridProperties.frozenRowCount,tabColor',
        },
      },
      {
        updateDimensionProperties: {
          range: { sheetId: anggotaSheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 4 },
          properties: { pixelSize: 160 },
          fields: 'pixelSize',
        },
      },
      {
        repeatCell: {
          range: { sheetId: anggotaSheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 4 },
          cell: {
            userEnteredFormat: {
              backgroundColor: color(30, 58, 138),
              textFormat: { foregroundColor: color(255, 255, 255), bold: true, fontSize: 10 },
              horizontalAlignment: 'CENTER',
              verticalAlignment: 'MIDDLE',
            },
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
        },
      },
      {
        addConditionalFormatRule: {
          rule: {
            ranges: [{ sheetId: anggotaSheetId, startRowIndex: 1, startColumnIndex: 3, endColumnIndex: 4 }],
            booleanRule: {
              condition: { type: 'TEXT_CONTAINS', values: [{ userEnteredValue: 'Aktif' }] },
              format: {
                backgroundColor: color(220, 252, 231),
                textFormat: { foregroundColor: color(22, 101, 52), bold: true },
              },
            },
          },
          index: 0,
        },
      }
    );
  }

  // 5. Rapikan Sheet 'Kas_Anggota'
  if (kasAnggotaSheetId !== null) {
    batchRequests.push(
      {
        updateSheetProperties: {
          properties: {
            sheetId: kasAnggotaSheetId,
            index: 2,
            gridProperties: { frozenRowCount: 1 },
            tabColor: color(20, 184, 166), // Teal
          },
          fields: 'index,gridProperties.frozenRowCount,tabColor',
        },
      },
      {
        updateDimensionProperties: {
          range: { sheetId: kasAnggotaSheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 },
          properties: { pixelSize: 180 },
          fields: 'pixelSize',
        },
      },
      {
        updateDimensionProperties: {
          range: { sheetId: kasAnggotaSheetId, dimension: 'COLUMNS', startIndex: 3, endIndex: 4 },
          properties: { pixelSize: 130 },
          fields: 'pixelSize',
        },
      },
      {
        repeatCell: {
          range: { sheetId: kasAnggotaSheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 7 },
          cell: {
            userEnteredFormat: {
              backgroundColor: color(15, 118, 110),
              textFormat: { foregroundColor: color(255, 255, 255), bold: true, fontSize: 10 },
              horizontalAlignment: 'CENTER',
              verticalAlignment: 'MIDDLE',
            },
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
        },
      },
      {
        repeatCell: {
          range: { sheetId: kasAnggotaSheetId, startRowIndex: 1, startColumnIndex: 3, endColumnIndex: 4 },
          cell: {
            userEnteredFormat: {
              numberFormat: { type: 'CURRENCY', pattern: '"Rp"#,##0' },
              horizontalAlignment: 'RIGHT',
              verticalAlignment: 'MIDDLE',
            },
          },
          fields: 'userEnteredFormat(numberFormat,horizontalAlignment,verticalAlignment)',
        },
      },
      {
        addConditionalFormatRule: {
          rule: {
            ranges: [{ sheetId: kasAnggotaSheetId, startRowIndex: 1, startColumnIndex: 5, endColumnIndex: 6 }],
            booleanRule: {
              condition: { type: 'TEXT_CONTAINS', values: [{ userEnteredValue: 'Lunas' }] },
              format: {
                backgroundColor: color(220, 252, 231),
                textFormat: { foregroundColor: color(22, 101, 52), bold: true },
              },
            },
          },
          index: 0,
        },
      }
    );
  }

  // Kirim batch format awal
  if (batchRequests.length > 0) {
    console.log(`Mengirim ${batchRequests.length} perintah format awal...`);
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: batchRequests },
    });
  }

  // 6. Tulis Data & Formula Dashboard
  console.log('📝 Menulis struktur formula & data dashboard...');
  const dashId = dashboardSheetId!;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'Dashboard!A1:M50',
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [
        // Baris 1: Kosong
        [],
        // Baris 2: Header Utama (B2)
        ['', '🏛️ DASHBOARD KEUANGAN & KAS UTAMA'],
        // Baris 3: Subtitle (B3)
        ['', 'Sistem Manajemen Keuangan Terintegrasi Bot Telegram • Visualisasi Realtime & Analisis Otomatis'],
        // Baris 4: Kosong
        [],
        // Baris 5: Judul KPI Row 1 (B5, E5, H5)
        ['', '💰 TOTAL SALDO KAS', '', '', '🟢 TOTAL PEMASUKAN', '', '', '🔴 TOTAL PENGELUARAN'],
        // Baris 6: Nilai KPI Row 1
        [
          '',
          '=SUMIF(Kas!B2:B, "*Pemasukan*", Kas!D2:D) - SUMIF(Kas!B2:B, "*Pengeluaran*", Kas!D2:D)',
          '',
          '',
          '=SUMIF(Kas!B2:B, "*Pemasukan*", Kas!D2:D)',
          '',
          '',
          '=SUMIF(Kas!B2:B, "*Pengeluaran*", Kas!D2:D)',
        ],
        // Baris 7: Spacer
        [],
        // Baris 8: Kosong
        [],
        // Baris 9: Judul KPI Row 2 (B9, E9, H9)
        ['', '📝 TOTAL TRANSAKSI KAS', '', '', '👥 ANGGOTA AKTIF', '', '', '💵 IURAN KAS TERKUMPUL'],
        // Baris 10: Nilai KPI Row 2
        [
          '',
          '=COUNTA(Kas!A2:A)',
          '',
          '',
          '=COUNTIF(Anggota!D2:D, "Aktif")',
          '',
          '',
          '=SUM(Kas_Anggota!D2:D)',
        ],
        // Baris 11: Kosong
        [],
        // Baris 12: Kosong (Area tempat chart diletakkan dari baris 13 s.d 29)
        [],
        [], [], [], [], [], [], [], [], [], [], [], [], [], [], [], [],
        // Baris 30: Kosong (Spacer sebelum tabel)
        [],
        // Baris 31: Section Header Tables (B31, E31, K31)
        [
          '',
          '🏷️ PENGELUARAN PER KATEGORI',
          '',
          '',
          '🕒 15 TRANSAKSI TERAKHIR (KAS UTAMA)',
          '',
          '',
          '',
          '',
          '',
          '📈 REKAP ARUS KAS TAHUNAN',
        ],
        // Baris 32: Subheaders (B32:C32, E32:I32, K32:M32)
        [
          '',
          'Kategori',
          'Total Nominal',
          '',
          'Tanggal',
          'Jenis',
          'Kategori',
          'Nominal',
          'Keterangan',
          '',
          'Tahun',
          'Pemasukan',
          'Pengeluaran',
        ],
        // Baris 33: Data Query & Baris Rekap Tahunan 2024
        [
          '',
          '=QUERY(Kas!B2:D, "select C, sum(D) where B contains \'Pengeluaran\' and C is not null and D > 0 group by C order by sum(D) desc label C \'\', sum(D) \'\'", 0)',
          '',
          '',
          '=QUERY(Kas!A2:E, "select A, B, C, D, E where A is not null and D is not null order by A desc limit 15 label A \'\', B \'\', C \'\', D \'\', E \'\'", 0)',
          '',
          '',
          '',
          '',
          '',
          '2024',
          '=SUMIFS(Kas!D:D, Kas!B:B, "*Pemasukan*", Kas!A:A, "*2024*")',
          '=SUMIFS(Kas!D:D, Kas!B:B, "*Pengeluaran*", Kas!A:A, "*2024*")',
        ],
        // Baris 34: Rekap Tahunan 2025
        [
          '', '', '', '', '', '', '', '', '', '',
          '2025',
          '=SUMIFS(Kas!D:D, Kas!B:B, "*Pemasukan*", Kas!A:A, "*2025*")',
          '=SUMIFS(Kas!D:D, Kas!B:B, "*Pengeluaran*", Kas!A:A, "*2025*")',
        ],
        // Baris 35: Rekap Tahunan 2026
        [
          '', '', '', '', '', '', '', '', '', '',
          '2026',
          '=SUMIFS(Kas!D:D, Kas!B:B, "*Pemasukan*", Kas!A:A, "*2026*")',
          '=SUMIFS(Kas!D:D, Kas!B:B, "*Pengeluaran*", Kas!A:A, "*2026*")',
        ],
        // Baris 36: Total Semua Tahun
        [
          '', '', '', '', '', '', '', '', '', '',
          'Total',
          '=SUM(L32:L34)',
          '=SUM(M32:M34)',
        ],
      ],
    },
  });

  // 7. Styling Dashboard Sheet + Add Charts
  console.log('🎨 Menerapkan styling dashboard dan menambahkan Grafik Interaktif...');
  const dashStyles: any[] = [
    // Lebar kolom Dashboard
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 25 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 180 }, fields: 'pixelSize' } }, // B
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 2, endIndex: 3 }, properties: { pixelSize: 160 }, fields: 'pixelSize' } }, // C
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 3, endIndex: 4 }, properties: { pixelSize: 35 }, fields: 'pixelSize' } },  // D spacer
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 4, endIndex: 5 }, properties: { pixelSize: 110 }, fields: 'pixelSize' } }, // E
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 5, endIndex: 6 }, properties: { pixelSize: 115 }, fields: 'pixelSize' } }, // F
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 6, endIndex: 7 }, properties: { pixelSize: 145 }, fields: 'pixelSize' } }, // G
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 7, endIndex: 8 }, properties: { pixelSize: 135 }, fields: 'pixelSize' } }, // H
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 8, endIndex: 9 }, properties: { pixelSize: 240 }, fields: 'pixelSize' } }, // I
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 9, endIndex: 10 }, properties: { pixelSize: 30 }, fields: 'pixelSize' } }, // J spacer
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 10, endIndex: 11 }, properties: { pixelSize: 90 }, fields: 'pixelSize' } }, // K (Tahun)
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 11, endIndex: 12 }, properties: { pixelSize: 135 }, fields: 'pixelSize' } }, // L (Pemasukan)
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 12, endIndex: 13 }, properties: { pixelSize: 135 }, fields: 'pixelSize' } }, // M (Pengeluaran)

    // Tinggi Baris Kunci
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'ROWS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 46 }, fields: 'pixelSize' } }, // Row 2 Title
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'ROWS', startIndex: 2, endIndex: 3 }, properties: { pixelSize: 26 }, fields: 'pixelSize' } }, // Row 3 Subtitle
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'ROWS', startIndex: 4, endIndex: 5 }, properties: { pixelSize: 28 }, fields: 'pixelSize' } }, // Row 5 Card Title
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'ROWS', startIndex: 5, endIndex: 7 }, properties: { pixelSize: 36 }, fields: 'pixelSize' } }, // Row 6-7 Card Values
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'ROWS', startIndex: 8, endIndex: 9 }, properties: { pixelSize: 28 }, fields: 'pixelSize' } }, // Row 9 Card Title
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'ROWS', startIndex: 9, endIndex: 11 }, properties: { pixelSize: 36 }, fields: 'pixelSize' } }, // Row 10-11 Card Values
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'ROWS', startIndex: 30, endIndex: 31 }, properties: { pixelSize: 32 }, fields: 'pixelSize' } }, // Row 31 Section Header
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'ROWS', startIndex: 31, endIndex: 32 }, properties: { pixelSize: 28 }, fields: 'pixelSize' } }, // Row 32 Subheader

    // Merges
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 1, endColumnIndex: 9 }, mergeType: 'MERGE_ALL' } },
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 1, endColumnIndex: 9 }, mergeType: 'MERGE_ALL' } },
    // KPI Row 1
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 1, endColumnIndex: 3 }, mergeType: 'MERGE_ALL' } },
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 5, endRowIndex: 7, startColumnIndex: 1, endColumnIndex: 3 }, mergeType: 'MERGE_ALL' } },
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 4, endColumnIndex: 6 }, mergeType: 'MERGE_ALL' } },
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 5, endRowIndex: 7, startColumnIndex: 4, endColumnIndex: 6 }, mergeType: 'MERGE_ALL' } },
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 7, endColumnIndex: 9 }, mergeType: 'MERGE_ALL' } },
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 5, endRowIndex: 7, startColumnIndex: 7, endColumnIndex: 9 }, mergeType: 'MERGE_ALL' } },
    // KPI Row 2
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 8, endRowIndex: 9, startColumnIndex: 1, endColumnIndex: 3 }, mergeType: 'MERGE_ALL' } },
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 9, endRowIndex: 11, startColumnIndex: 1, endColumnIndex: 3 }, mergeType: 'MERGE_ALL' } },
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 8, endRowIndex: 9, startColumnIndex: 4, endColumnIndex: 6 }, mergeType: 'MERGE_ALL' } },
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 9, endRowIndex: 11, startColumnIndex: 4, endColumnIndex: 6 }, mergeType: 'MERGE_ALL' } },
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 8, endRowIndex: 9, startColumnIndex: 7, endColumnIndex: 9 }, mergeType: 'MERGE_ALL' } },
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 9, endRowIndex: 11, startColumnIndex: 7, endColumnIndex: 9 }, mergeType: 'MERGE_ALL' } },
    // Section Header Tables
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 30, endRowIndex: 31, startColumnIndex: 1, endColumnIndex: 3 }, mergeType: 'MERGE_ALL' } }, // B31:C31
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 30, endRowIndex: 31, startColumnIndex: 4, endColumnIndex: 9 }, mergeType: 'MERGE_ALL' } }, // E31:I31
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 30, endRowIndex: 31, startColumnIndex: 10, endColumnIndex: 13 }, mergeType: 'MERGE_ALL' } }, // K31:M31

    // Format B2:I2 Title
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 1, endColumnIndex: 9 },
        cell: {
          userEnteredFormat: {
            backgroundColor: color(15, 23, 42),
            textFormat: { foregroundColor: color(255, 255, 255), bold: true, fontSize: 16 },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
      },
    },
    // Format B3:I3 Subtitle
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 1, endColumnIndex: 9 },
        cell: {
          userEnteredFormat: {
            backgroundColor: color(30, 41, 59),
            textFormat: { foregroundColor: color(148, 163, 184), bold: false, fontSize: 9 },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
      },
    },

    // Format Card 1 (Saldo Kas): B5:C7
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 1, endColumnIndex: 3 },
        cell: {
          userEnteredFormat: {
            backgroundColor: color(4, 120, 87),
            textFormat: { foregroundColor: color(255, 255, 255), bold: true, fontSize: 10 },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 5, endRowIndex: 7, startColumnIndex: 1, endColumnIndex: 3 },
        cell: {
          userEnteredFormat: {
            backgroundColor: color(236, 253, 245),
            textFormat: { foregroundColor: color(6, 95, 70), bold: true, fontSize: 18 },
            numberFormat: { type: 'CURRENCY', pattern: '"Rp"#,##0' },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,numberFormat,horizontalAlignment,verticalAlignment)',
      },
    },

    // Format Card 2 (Pemasukan): E5:F7
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 4, endColumnIndex: 6 },
        cell: {
          userEnteredFormat: {
            backgroundColor: color(21, 128, 61),
            textFormat: { foregroundColor: color(255, 255, 255), bold: true, fontSize: 10 },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 5, endRowIndex: 7, startColumnIndex: 4, endColumnIndex: 6 },
        cell: {
          userEnteredFormat: {
            backgroundColor: color(240, 253, 244),
            textFormat: { foregroundColor: color(22, 101, 52), bold: true, fontSize: 16 },
            numberFormat: { type: 'CURRENCY', pattern: '"Rp"#,##0' },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,numberFormat,horizontalAlignment,verticalAlignment)',
      },
    },

    // Format Card 3 (Pengeluaran): H5:I7
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 7, endColumnIndex: 9 },
        cell: {
          userEnteredFormat: {
            backgroundColor: color(185, 28, 28),
            textFormat: { foregroundColor: color(255, 255, 255), bold: true, fontSize: 10 },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 5, endRowIndex: 7, startColumnIndex: 7, endColumnIndex: 9 },
        cell: {
          userEnteredFormat: {
            backgroundColor: color(254, 242, 242),
            textFormat: { foregroundColor: color(153, 27, 27), bold: true, fontSize: 16 },
            numberFormat: { type: 'CURRENCY', pattern: '"Rp"#,##0' },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,numberFormat,horizontalAlignment,verticalAlignment)',
      },
    },

    // Format Card 4 (Total Transaksi): B9:C11
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 8, endRowIndex: 9, startColumnIndex: 1, endColumnIndex: 3 },
        cell: {
          userEnteredFormat: {
            backgroundColor: color(51, 65, 85),
            textFormat: { foregroundColor: color(255, 255, 255), bold: true, fontSize: 10 },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 9, endRowIndex: 11, startColumnIndex: 1, endColumnIndex: 3 },
        cell: {
          userEnteredFormat: {
            backgroundColor: color(248, 250, 252),
            textFormat: { foregroundColor: color(30, 41, 59), bold: true, fontSize: 16 },
            numberFormat: { type: 'NUMBER', pattern: '#,##0" Transaksi"' },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,numberFormat,horizontalAlignment,verticalAlignment)',
      },
    },

    // Format Card 5 (Anggota Aktif): E9:F11
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 8, endRowIndex: 9, startColumnIndex: 4, endColumnIndex: 6 },
        cell: {
          userEnteredFormat: {
            backgroundColor: color(29, 78, 216),
            textFormat: { foregroundColor: color(255, 255, 255), bold: true, fontSize: 10 },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 9, endRowIndex: 11, startColumnIndex: 4, endColumnIndex: 6 },
        cell: {
          userEnteredFormat: {
            backgroundColor: color(239, 246, 255),
            textFormat: { foregroundColor: color(30, 64, 175), bold: true, fontSize: 16 },
            numberFormat: { type: 'NUMBER', pattern: '#,##0" Orang"' },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,numberFormat,horizontalAlignment,verticalAlignment)',
      },
    },

    // Format Card 6 (Iuran Kas): H9:I11
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 8, endRowIndex: 9, startColumnIndex: 7, endColumnIndex: 9 },
        cell: {
          userEnteredFormat: {
            backgroundColor: color(180, 83, 9),
            textFormat: { foregroundColor: color(255, 255, 255), bold: true, fontSize: 10 },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 9, endRowIndex: 11, startColumnIndex: 7, endColumnIndex: 9 },
        cell: {
          userEnteredFormat: {
            backgroundColor: color(255, 251, 235),
            textFormat: { foregroundColor: color(146, 64, 14), bold: true, fontSize: 16 },
            numberFormat: { type: 'CURRENCY', pattern: '"Rp"#,##0' },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,numberFormat,horizontalAlignment,verticalAlignment)',
      },
    },

    // Section Headers (Row 31)
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 30, endRowIndex: 31, startColumnIndex: 1, endColumnIndex: 13 },
        cell: {
          userEnteredFormat: {
            backgroundColor: color(15, 23, 42),
            textFormat: { foregroundColor: color(255, 255, 255), bold: true, fontSize: 11 },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
      },
    },

    // Table Subheaders (Row 32)
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 31, endRowIndex: 32, startColumnIndex: 1, endColumnIndex: 13 },
        cell: {
          userEnteredFormat: {
            backgroundColor: color(226, 232, 240),
            textFormat: { foregroundColor: color(30, 41, 59), bold: true, fontSize: 10 },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
      },
    },

    // Format Kolom Nilai Rupiah:
    // Kategori (C33:C55)
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 32, endRowIndex: 55, startColumnIndex: 2, endColumnIndex: 3 },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: 'CURRENCY', pattern: '"Rp"#,##0' },
            horizontalAlignment: 'RIGHT',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(numberFormat,horizontalAlignment,verticalAlignment)',
      },
    },
    // Tabel Live Kas: Tanggal E center, Jenis F center, Nominal H currency
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 32, endRowIndex: 50, startColumnIndex: 4, endColumnIndex: 6 },
        cell: {
          userEnteredFormat: {
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 32, endRowIndex: 50, startColumnIndex: 7, endColumnIndex: 8 },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: 'CURRENCY', pattern: '"Rp"#,##0' },
            horizontalAlignment: 'RIGHT',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(numberFormat,horizontalAlignment,verticalAlignment)',
      },
    },
    // Rekap Tahunan: K center, L right currency, M right currency
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 32, endRowIndex: 36, startColumnIndex: 10, endColumnIndex: 11 },
        cell: {
          userEnteredFormat: {
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
            textFormat: { bold: true },
          },
        },
        fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment,textFormat)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 32, endRowIndex: 36, startColumnIndex: 11, endColumnIndex: 13 },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: 'CURRENCY', pattern: '"Rp"#,##0' },
            horizontalAlignment: 'RIGHT',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(numberFormat,horizontalAlignment,verticalAlignment)',
      },
    },

    // -------------------------------------------------------------
    // 8. Tambahkan 2 Chart Profesional:
    // -------------------------------------------------------------

    // Chart 1: Donut Chart "Distribusi Pengeluaran per Kategori" (B13 s.d D29)
    {
      addChart: {
        chart: {
          spec: {
            title: '🍩 Distribusi Pengeluaran per Kategori',
            titleTextFormat: { bold: true, fontSize: 13, foregroundColor: color(15, 23, 42) },
            pieChart: {
              pieHole: 0.42, // Donut hole
              legendPosition: 'RIGHT_LEGEND',
              domain: {
                sourceRange: {
                  sources: [
                    {
                      sheetId: dashId,
                      startRowIndex: 31,
                      endRowIndex: 45,
                      startColumnIndex: 1,
                      endColumnIndex: 2,
                    },
                  ],
                },
              },
              series: {
                sourceRange: {
                  sources: [
                    {
                      sheetId: dashId,
                      startRowIndex: 31,
                      endRowIndex: 45,
                      startColumnIndex: 2,
                      endColumnIndex: 3,
                    },
                  ],
                },
              },
            },
          },
          position: {
            overlayPosition: {
              anchorCell: { sheetId: dashId, rowIndex: 12, columnIndex: 1 },
              widthPixels: 440,
              heightPixels: 330,
            },
          },
        },
      },
    },

    // Chart 2: Column Chart "Arus Kas Tahunan (Pemasukan vs Pengeluaran)" (E13 s.d M29)
    {
      addChart: {
        chart: {
          spec: {
            title: '📊 Perbandingan Arus Kas per Tahun (Pemasukan vs Pengeluaran)',
            titleTextFormat: { bold: true, fontSize: 13, foregroundColor: color(15, 23, 42) },
            basicChart: {
              chartType: 'COLUMN',
              legendPosition: 'BOTTOM_LEGEND',
              headerCount: 1,
              domains: [
                {
                  domain: {
                    sourceRange: {
                      sources: [
                        {
                          sheetId: dashId,
                          startRowIndex: 30,
                          endRowIndex: 34,
                          startColumnIndex: 10,
                          endColumnIndex: 11,
                        },
                      ],
                    },
                  },
                },
              ],
              series: [
                {
                  series: {
                    sourceRange: {
                      sources: [
                        {
                          sheetId: dashId,
                          startRowIndex: 30,
                          endRowIndex: 34,
                          startColumnIndex: 11,
                          endColumnIndex: 12,
                        },
                      ],
                    },
                  },
                  targetAxis: 'LEFT_AXIS',
                  colorStyle: {
                    rgbColor: color(16, 185, 129), // Emerald Green Pemasukan
                  },
                },
                {
                  series: {
                    sourceRange: {
                      sources: [
                        {
                          sheetId: dashId,
                          startRowIndex: 30,
                          endRowIndex: 34,
                          startColumnIndex: 12,
                          endColumnIndex: 13,
                        },
                      ],
                    },
                  },
                  targetAxis: 'LEFT_AXIS',
                  colorStyle: {
                    rgbColor: color(239, 68, 68), // Crimson Red Pengeluaran
                  },
                },
              ],
            },
          },
          position: {
            overlayPosition: {
              anchorCell: { sheetId: dashId, rowIndex: 12, columnIndex: 4 },
              widthPixels: 630,
              heightPixels: 330,
            },
          },
        },
      },
    },
  ];

  console.log(`Mengirim ${dashStyles.length} styling & chart visual ke Google Sheets...`);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: dashStyles },
  });

  console.log('🎉 Dashboard Eksekutif Profesional dengan 2 Chart berhasil terpasang!');
}

run().catch((err) => {
  console.error('❌ Gagal merapikan sheet:', err);
  process.exit(1);
});
