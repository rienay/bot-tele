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
  console.log('🚀 Memulai penataan tampilan Google Sheets dan pembuatan Dashboard...');
  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = getSpreadsheetId();

  // 1. Ambil daftar sheet saat ini
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
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
            rowCount: 55,
            columnCount: 11,
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
      // Set Kas as tab index 1
      {
        updateSheetProperties: {
          properties: {
            sheetId: kasSheetId,
            index: 1,
            gridProperties: {
              frozenRowCount: 1,
            },
            tabColor: color(59, 130, 246), // Blue
          },
          fields: 'index,gridProperties.frozenRowCount,tabColor',
        },
      },
      // Lebar kolom A sampai G
      {
        updateDimensionProperties: {
          range: { sheetId: kasSheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 },
          properties: { pixelSize: 115 }, // Tanggal
          fields: 'pixelSize',
        },
      },
      {
        updateDimensionProperties: {
          range: { sheetId: kasSheetId, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 },
          properties: { pixelSize: 125 }, // Jenis
          fields: 'pixelSize',
        },
      },
      {
        updateDimensionProperties: {
          range: { sheetId: kasSheetId, dimension: 'COLUMNS', startIndex: 2, endIndex: 3 },
          properties: { pixelSize: 165 }, // Kategori
          fields: 'pixelSize',
        },
      },
      {
        updateDimensionProperties: {
          range: { sheetId: kasSheetId, dimension: 'COLUMNS', startIndex: 3, endIndex: 4 },
          properties: { pixelSize: 145 }, // Nominal
          fields: 'pixelSize',
        },
      },
      {
        updateDimensionProperties: {
          range: { sheetId: kasSheetId, dimension: 'COLUMNS', startIndex: 4, endIndex: 5 },
          properties: { pixelSize: 280 }, // Keterangan
          fields: 'pixelSize',
        },
      },
      {
        updateDimensionProperties: {
          range: { sheetId: kasSheetId, dimension: 'COLUMNS', startIndex: 5, endIndex: 6 },
          properties: { pixelSize: 110 }, // Link Nota
          fields: 'pixelSize',
        },
      },
      {
        updateDimensionProperties: {
          range: { sheetId: kasSheetId, dimension: 'COLUMNS', startIndex: 6, endIndex: 7 },
          properties: { pixelSize: 175 }, // Waktu Input
          fields: 'pixelSize',
        },
      },
      // Tinggi Header Row 1
      {
        updateDimensionProperties: {
          range: { sheetId: kasSheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
          properties: { pixelSize: 38 },
          fields: 'pixelSize',
        },
      },
      // Styling Header Row 1 (Navy Slate, White bold)
      {
        repeatCell: {
          range: { sheetId: kasSheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 7 },
          cell: {
            userEnteredFormat: {
              backgroundColor: color(30, 41, 59), // #1E293B
              textFormat: { foregroundColor: color(255, 255, 255), bold: true, fontSize: 10 },
              horizontalAlignment: 'CENTER',
              verticalAlignment: 'MIDDLE',
            },
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
        },
      },
      // Format Nominal Kolom D sebagai Rupiah
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
      // Alignment Tanggal (A) & Jenis (B) Center
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
      // Conditional Formatting Kolom Jenis (B)
      {
        addConditionalFormatRule: {
          rule: {
            ranges: [{ sheetId: kasSheetId, startRowIndex: 1, startColumnIndex: 1, endColumnIndex: 2 }],
            booleanRule: {
              condition: { type: 'TEXT_CONTAINS', values: [{ userEnteredValue: 'Pemasukan' }] },
              format: {
                backgroundColor: color(220, 252, 231), // #DCFCE7
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
                backgroundColor: color(254, 226, 226), // #FEE2E2
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
    console.log('✨ Menata sheet Anggota...');
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
              backgroundColor: color(30, 58, 138), // #1E3A8A
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
    console.log('✨ Menata sheet Kas_Anggota...');
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
              backgroundColor: color(15, 118, 110), // #0F766E
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

  // Eksekusi batch 1 (properties & formatting data sheets)
  if (batchRequests.length > 0) {
    console.log(`Mengirim ${batchRequests.length} konfigurasi format awal ke Google Sheets...`);
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: batchRequests },
    });
  }

  // 6. Sekarang set up data dan tampilan Dashboard sheet
  console.log('🎨 Mendesain Dashboard sheet...');
  const dashId = dashboardSheetId!;

  // 6a. Tulis Formula & Teks ke Dashboard
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'Dashboard!A1:I35',
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [
        // Baris 1: Kosong
        [],
        // Baris 2: Header Utama (B2)
        ['', '🏛️ DASHBOARD KEUANGAN & KAS UTAMA'],
        // Baris 3: Subtitle (B3)
        ['', 'Sistem Manajemen Keuangan Terintegrasi Bot Telegram • Sinkronisasi Otomatis Realtime'],
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
        // Baris 11: Spacer
        [],
        // Baris 12: Kosong
        [],
        // Baris 13: Section Header
        ['', '🏷️ PENGELUARAN PER KATEGORI', '', '', '🕒 15 TRANSAKSI TERAKHIR (KAS UTAMA)'],
        // Baris 14: Subheader Tabel
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
        ],
        // Baris 15: Formula Query
        [
          '',
          '=QUERY(Kas!B2:D, "select C, sum(D) where B contains \'Pengeluaran\' and C is not null and D > 0 group by C order by sum(D) desc label C \'\', sum(D) \'\'", 0)',
          '',
          '',
          '=QUERY(Kas!A2:E, "select A, B, C, D, E where A is not null and D is not null order by A desc limit 15 label A \'\', B \'\', C \'\', D \'\', E \'\'", 0)',
        ],
      ],
    },
  });

  // 6b. Styling Dashboard Sheet (Grid layout, Merges, Colors, Fonts, Borders)
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

    // Tinggi Baris Kunci
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'ROWS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 46 }, fields: 'pixelSize' } }, // Row 2 Title
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'ROWS', startIndex: 2, endIndex: 3 }, properties: { pixelSize: 26 }, fields: 'pixelSize' } }, // Row 3 Subtitle
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'ROWS', startIndex: 4, endIndex: 5 }, properties: { pixelSize: 28 }, fields: 'pixelSize' } }, // Row 5 Card Title
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'ROWS', startIndex: 5, endIndex: 7 }, properties: { pixelSize: 36 }, fields: 'pixelSize' } }, // Row 6-7 Card Values
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'ROWS', startIndex: 8, endIndex: 9 }, properties: { pixelSize: 28 }, fields: 'pixelSize' } }, // Row 9 Card Title
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'ROWS', startIndex: 9, endIndex: 11 }, properties: { pixelSize: 36 }, fields: 'pixelSize' } }, // Row 10-11 Card Values
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'ROWS', startIndex: 12, endIndex: 13 }, properties: { pixelSize: 32 }, fields: 'pixelSize' } }, // Row 13 Section Header
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'ROWS', startIndex: 13, endIndex: 14 }, properties: { pixelSize: 28 }, fields: 'pixelSize' } }, // Row 14 Subheader

    // Merges
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 1, endColumnIndex: 9 }, mergeType: 'MERGE_ALL' } }, // B2:I2
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 1, endColumnIndex: 9 }, mergeType: 'MERGE_ALL' } }, // B3:I3
    // KPI Row 1
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 1, endColumnIndex: 3 }, mergeType: 'MERGE_ALL' } }, // B5:C5
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 5, endRowIndex: 7, startColumnIndex: 1, endColumnIndex: 3 }, mergeType: 'MERGE_ALL' } }, // B6:C7
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 4, endColumnIndex: 6 }, mergeType: 'MERGE_ALL' } }, // E5:F5
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 5, endRowIndex: 7, startColumnIndex: 4, endColumnIndex: 6 }, mergeType: 'MERGE_ALL' } }, // E6:F7
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 7, endColumnIndex: 9 }, mergeType: 'MERGE_ALL' } }, // H5:I5
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 5, endRowIndex: 7, startColumnIndex: 7, endColumnIndex: 9 }, mergeType: 'MERGE_ALL' } }, // H6:I7
    // KPI Row 2
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 8, endRowIndex: 9, startColumnIndex: 1, endColumnIndex: 3 }, mergeType: 'MERGE_ALL' } }, // B9:C9
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 9, endRowIndex: 11, startColumnIndex: 1, endColumnIndex: 3 }, mergeType: 'MERGE_ALL' } }, // B10:C11
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 8, endRowIndex: 9, startColumnIndex: 4, endColumnIndex: 6 }, mergeType: 'MERGE_ALL' } }, // E9:F9
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 9, endRowIndex: 11, startColumnIndex: 4, endColumnIndex: 6 }, mergeType: 'MERGE_ALL' } }, // E10:F11
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 8, endRowIndex: 9, startColumnIndex: 7, endColumnIndex: 9 }, mergeType: 'MERGE_ALL' } }, // H9:I9
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 9, endRowIndex: 11, startColumnIndex: 7, endColumnIndex: 9 }, mergeType: 'MERGE_ALL' } }, // H10:I11
    // Section Header Tables
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 12, endRowIndex: 13, startColumnIndex: 1, endColumnIndex: 3 }, mergeType: 'MERGE_ALL' } }, // B13:C13
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 12, endRowIndex: 13, startColumnIndex: 4, endColumnIndex: 9 }, mergeType: 'MERGE_ALL' } }, // E13:I13

    // Format B2:I2 Title
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 1, endColumnIndex: 9 },
        cell: {
          userEnteredFormat: {
            backgroundColor: color(15, 23, 42), // #0F172A
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
            backgroundColor: color(30, 41, 59), // #1E293B
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
            backgroundColor: color(4, 120, 87), // Emerald 700
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
            backgroundColor: color(236, 253, 245), // #ECFDF5
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
            backgroundColor: color(21, 128, 61), // Green 700
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
            backgroundColor: color(240, 253, 244), // #F0FDF4
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
            backgroundColor: color(185, 28, 28), // Red 700
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
            backgroundColor: color(254, 242, 242), // #FEF2F2
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
            backgroundColor: color(51, 65, 85), // Slate 700
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
            backgroundColor: color(29, 78, 216), // Blue 700
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
            backgroundColor: color(239, 246, 255), // #EFF6FF
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
            backgroundColor: color(180, 83, 9), // Amber 700
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
            backgroundColor: color(255, 251, 235), // #FFFBEB
            textFormat: { foregroundColor: color(146, 64, 14), bold: true, fontSize: 16 },
            numberFormat: { type: 'CURRENCY', pattern: '"Rp"#,##0' },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,numberFormat,horizontalAlignment,verticalAlignment)',
      },
    },

    // Section Headers (Row 13)
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 12, endRowIndex: 13, startColumnIndex: 1, endColumnIndex: 9 },
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

    // Table Subheaders (Row 14)
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 13, endRowIndex: 14, startColumnIndex: 1, endColumnIndex: 3 },
        cell: {
          userEnteredFormat: {
            backgroundColor: color(226, 232, 240), // #E2E8F0
            textFormat: { foregroundColor: color(30, 41, 59), bold: true, fontSize: 10 },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 13, endRowIndex: 14, startColumnIndex: 4, endColumnIndex: 9 },
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

    // Format Nilai Kategori (Kolom C Baris 15-35 sebagai Rupiah)
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 14, endRowIndex: 35, startColumnIndex: 2, endColumnIndex: 3 },
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
    // Format Tabel Live Kas (Tanggal E center, Jenis F center, Nominal H currency, Kategori G left, Keterangan I left)
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 14, endRowIndex: 32, startColumnIndex: 4, endColumnIndex: 6 },
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
        range: { sheetId: dashId, startRowIndex: 14, endRowIndex: 32, startColumnIndex: 7, endColumnIndex: 8 },
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
    // Conditional formatting live kas: Pemasukan / Pengeluaran
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [{ sheetId: dashId, startRowIndex: 14, endRowIndex: 32, startColumnIndex: 5, endColumnIndex: 6 }],
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
          ranges: [{ sheetId: dashId, startRowIndex: 14, endRowIndex: 32, startColumnIndex: 5, endColumnIndex: 6 }],
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
  ];

  console.log(`Mengirim ${dashStyles.length} styling visual Dashboard ke Google Sheets...`);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: dashStyles },
  });

  console.log('✅ Dashboard & tata letak Google Sheets berhasil dibuat dan dirapikan secara profesional!');
}

run().catch((err) => {
  console.error('❌ Gagal merapikan sheet:', err);
  process.exit(1);
});
