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
  console.log('🚀 Mendesain Ulang Dashboard: Hanya Charts, Pilihan Filter & KPI Card (Tanpa Teks Tabel)...');
  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = getSpreadsheetId();

  // 1. Ambil meta seluruh sheet & chart
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets(properties,charts)',
  });
  const existingSheets = meta.data.sheets || [];

  let dashboardSheetId: number | null = null;
  let dataSheetId: number | null = null;
  let kasSheetId: number | null = null;
  let anggotaSheetId: number | null = null;
  let kasAnggotaSheetId: number | null = null;
  let sessionsSheetId: number | null = null;
  let sheet1Id: number | null = null;

  for (const s of existingSheets) {
    const title = s.properties?.title;
    const id = s.properties?.sheetId ?? 0;
    if (title?.toLowerCase() === 'dashboard') dashboardSheetId = id;
    if (title?.toLowerCase() === '_dashboarddata') dataSheetId = id;
    if (title?.toLowerCase() === 'kas') kasSheetId = id;
    if (title?.toLowerCase() === 'anggota') anggotaSheetId = id;
    if (title?.toLowerCase() === 'kas_anggota') kasAnggotaSheetId = id;
    if (title?.toLowerCase() === '_sessions') sessionsSheetId = id;
    if (title?.toLowerCase() === 'sheet1') sheet1Id = id;
  }

  const batchRequests: any[] = [];

  // Hapus chart lama di Dashboard jika ada
  const dashSheetObj = existingSheets.find((s) => s.properties?.title?.toLowerCase() === 'dashboard');
  if (dashSheetObj?.charts && dashSheetObj.charts.length > 0) {
    for (const c of dashSheetObj.charts) {
      if (c.chartId) {
        batchRequests.push({ deleteEmbeddedObject: { objectId: c.chartId } });
      }
    }
  }

  // 2. Buat sheet data pembantu `_DashboardData` jika belum ada
  if (dataSheetId === null) {
    const newSheetId = Math.floor(100000000 + Math.random() * 900000000);
    dataSheetId = newSheetId;
    batchRequests.push({
      addSheet: {
        properties: {
          sheetId: newSheetId,
          title: '_DashboardData',
          hidden: true, // Sembunyikan tab data pembantu agar tab bar tetap bersih
        },
      },
    });
  } else {
    // Pastikan tersembunyi
    batchRequests.push({
      updateSheetProperties: {
        properties: { sheetId: dataSheetId, hidden: true },
        fields: 'hidden',
      },
    });
  }

  // Sembunyikan _Sessions & Sheet1
  if (sessionsSheetId !== null) {
    batchRequests.push({
      updateSheetProperties: { properties: { sheetId: sessionsSheetId, hidden: true }, fields: 'hidden' },
    });
  }
  if (sheet1Id !== null) {
    batchRequests.push({
      updateSheetProperties: { properties: { sheetId: sheet1Id, hidden: true }, fields: 'hidden' },
    });
  }

  // 3. Buat sheet Dashboard jika belum ada, atau pastikan index 0
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
            rowCount: 45,
            columnCount: 12,
            hideGridlines: true, // Bersih tanpa garis kisi abu-abu seperti aplikasi asli!
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
          gridProperties: {
            rowCount: 45,
            columnCount: 12,
            hideGridlines: true, // Sembunyikan gridlines agar bersih
          },
          tabColor: color(16, 185, 129),
        },
        fields: 'index,gridProperties.hideGridlines,gridProperties.rowCount,gridProperties.columnCount,tabColor',
      },
    });
  }

  // Atur urutan tab utama: Dashboard (0) -> Kas (1) -> Kas_Anggota (2) -> Anggota (3)
  if (kasSheetId !== null) {
    batchRequests.push({
      updateSheetProperties: {
        properties: { sheetId: kasSheetId, index: 1, tabColor: color(59, 130, 246) },
        fields: 'index,tabColor',
      },
    });
  }
  if (kasAnggotaSheetId !== null) {
    batchRequests.push({
      updateSheetProperties: {
        properties: { sheetId: kasAnggotaSheetId, index: 2, tabColor: color(20, 184, 166) },
        fields: 'index,tabColor',
      },
    });
  }
  if (anggotaSheetId !== null) {
    batchRequests.push({
      updateSheetProperties: {
        properties: { sheetId: anggotaSheetId, index: 3, tabColor: color(99, 102, 241) },
        fields: 'index,tabColor',
      },
    });
  }

  // Eksekusi setup sheet & hapus chart lama
  console.log(`Mengirim ${batchRequests.length} konfigurasi awal...`);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: batchRequests },
  });

  const dashId = dashboardSheetId!;
  const dDataId = dataSheetId!;

  // 4. Bersihkan total isi sheet Dashboard (hapus seluruh teks lama)
  console.log('🧹 Membersihkan teks/tabel lama di sheet Dashboard...');
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: 'Dashboard!A1:Z100',
  });

  // Hapus format lama dari baris 1 s.d 45 di Dashboard
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: { sheetId: dashId, startRowIndex: 0, endRowIndex: 45, startColumnIndex: 0, endColumnIndex: 12 },
            cell: {
              userEnteredFormat: {
                backgroundColor: color(248, 250, 252), // #F8FAFC canvas background
                borders: {},
              },
            },
            fields: 'userEnteredFormat(backgroundColor,borders)',
          },
        },
      ],
    },
  });

  // 5. Tulis Seluruh Data Perhitungan ke Sheet Terpisah `_DashboardData`
  console.log('📊 Menulis data sumber grafik ke sheet `_DashboardData`...');
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: '_DashboardData!A1:N25',
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [
        // Baris 1: Header Tabel Kategori (A1:B1) dan Header Tabel Arus Kas Tahunan (D1:F1)
        ['Kategori', 'Total Nominal', '', 'Tahun', 'Pemasukan', 'Pengeluaran'],
        // Baris 2: Query Kategori & Data 2024
        [
          '=QUERY(Kas!B2:D, "select C, sum(D) where B contains \'Pengeluaran\' and C is not null and D > 0 group by C order by sum(D) desc label C \'\', sum(D) \'\'", 0)',
          '',
          '',
          '2024',
          '=SUMIFS(Kas!D:D, Kas!B:B, "*Pemasukan*", Kas!A:A, "*2024*")',
          '=SUMIFS(Kas!D:D, Kas!B:B, "*Pengeluaran*", Kas!A:A, "*2024*")',
        ],
        // Baris 3: Data 2025
        [
          '', '', '',
          '2025',
          '=SUMIFS(Kas!D:D, Kas!B:B, "*Pemasukan*", Kas!A:A, "*2025*")',
          '=SUMIFS(Kas!D:D, Kas!B:B, "*Pengeluaran*", Kas!A:A, "*2025*")',
        ],
        // Baris 4: Data 2026
        [
          '', '', '',
          '2026',
          '=SUMIFS(Kas!D:D, Kas!B:B, "*Pemasukan*", Kas!A:A, "*2026*")',
          '=SUMIFS(Kas!D:D, Kas!B:B, "*Pengeluaran*", Kas!A:A, "*2026*")',
        ],
        // Baris 5: Total
        [
          '', '', '',
          'Total',
          '=SUM(E2:E4)',
          '=SUM(F2:F4)',
        ],
      ],
    },
  });

  // 6. Tulis Tampilan Murni Dashboard: Hanya Header, Dropdown Pilihan, dan KPI Cards!
  console.log('✨ Menulis Header, Pilihan Dropdown Filter, dan KPI Cards di Dashboard...');
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'Dashboard!A1:J11',
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [
        // Baris 1: Kosong
        [],
        // Baris 2: Judul Utama (B2) & Filter Tahun (G2:H2)
        ['', '🏛️ EXECUTIVE FINANCIAL DASHBOARD', '', '', '', '', '📅 Periode Tahun:', 'Semua Tahun'],
        // Baris 3: Subtitle (B3) & Filter Sumber (G3:H3)
        ['', 'Realtime Sync Bot Telegram • Ringkasan Kas & Arus Keuangan', '', '', '', '', '🔍 Sumber Kas:', 'Semua Mutasi'],
        // Baris 4: Kosong (Spacer)
        [],
        // Baris 5: Header KPI Row 1 (B5, E5, H5)
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
        // Baris 9: Header KPI Row 2 (B9, E9, H9)
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
        // Baris 11: Spacer (Area bawah baris 11 ini murni untuk CHARTS tanpa teks apapun!)
        [],
      ],
    },
  });

  // Unmerge merge lama jika ada agar tidak bentrok
  const curMeta = await sheets.spreadsheets.get({ spreadsheetId });
  const curDash = curMeta.data.sheets?.find((s) => s.properties?.title?.toLowerCase() === 'dashboard');
  if (curDash?.merges && curDash.merges.length > 0) {
    const unmerges = curDash.merges.map((range) => ({ unmergeCells: { range } }));
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: unmerges },
    });
  }

  // 7. Styling Visual Dashboard & Tambahkan Charts Interaktif
  console.log('🎨 Menerapkan Styling UI Dashboard & Memasang Chart...');

  const borderSolid = {
    style: 'SOLID',
    width: 1,
    color: color(226, 232, 240), // Slate 200 border
  };

  const uiRequests: any[] = [
    // Dimensi Kolom Dashboard
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 25 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 180 }, fields: 'pixelSize' } }, // B
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 2, endIndex: 3 }, properties: { pixelSize: 170 }, fields: 'pixelSize' } }, // C
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 3, endIndex: 4 }, properties: { pixelSize: 30 }, fields: 'pixelSize' } },  // D spacer
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 4, endIndex: 5 }, properties: { pixelSize: 175 }, fields: 'pixelSize' } }, // E
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 5, endIndex: 6 }, properties: { pixelSize: 175 }, fields: 'pixelSize' } }, // F
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 6, endIndex: 7 }, properties: { pixelSize: 30 }, fields: 'pixelSize' } },  // G spacer
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 7, endIndex: 8 }, properties: { pixelSize: 180 }, fields: 'pixelSize' } }, // H
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 8, endIndex: 9 }, properties: { pixelSize: 180 }, fields: 'pixelSize' } }, // I
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 9, endIndex: 10 }, properties: { pixelSize: 25 }, fields: 'pixelSize' } }, // J

    // Dimensi Baris
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'ROWS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 40 }, fields: 'pixelSize' } }, // Row 2 Header
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'ROWS', startIndex: 2, endIndex: 3 }, properties: { pixelSize: 26 }, fields: 'pixelSize' } }, // Row 3 Subtitle
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'ROWS', startIndex: 4, endIndex: 5 }, properties: { pixelSize: 28 }, fields: 'pixelSize' } }, // Row 5 Card Title
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'ROWS', startIndex: 5, endIndex: 7 }, properties: { pixelSize: 36 }, fields: 'pixelSize' } }, // Row 6-7 Card Values
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'ROWS', startIndex: 8, endIndex: 9 }, properties: { pixelSize: 28 }, fields: 'pixelSize' } }, // Row 9 Card Title
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'ROWS', startIndex: 9, endIndex: 11 }, properties: { pixelSize: 36 }, fields: 'pixelSize' } }, // Row 10-11 Card Values

    // Merges
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 1, endColumnIndex: 6 }, mergeType: 'MERGE_ALL' } }, // B2:F2
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 1, endColumnIndex: 6 }, mergeType: 'MERGE_ALL' } }, // B3:F3

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

    // Format B2 Title
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 1, endColumnIndex: 6 },
        cell: {
          userEnteredFormat: {
            textFormat: { foregroundColor: color(15, 23, 42), bold: true, fontSize: 16 },
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(textFormat,verticalAlignment)',
      },
    },
    // Format B3 Subtitle
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 1, endColumnIndex: 6 },
        cell: {
          userEnteredFormat: {
            textFormat: { foregroundColor: color(100, 116, 139), bold: false, fontSize: 9 },
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(textFormat,verticalAlignment)',
      },
    },

    // Format Dropdown Label G2 & G3
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 1, endRowIndex: 3, startColumnIndex: 6, endColumnIndex: 7 },
        cell: {
          userEnteredFormat: {
            textFormat: { foregroundColor: color(71, 85, 105), bold: true, fontSize: 9 },
            horizontalAlignment: 'RIGHT',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment)',
      },
    },
    // Format Dropdown Box H2 & H3 (White button, border, bold)
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 1, endRowIndex: 3, startColumnIndex: 7, endColumnIndex: 8 },
        cell: {
          userEnteredFormat: {
            backgroundColor: color(255, 255, 255),
            textFormat: { foregroundColor: color(15, 23, 42), bold: true, fontSize: 10 },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
            borders: { top: borderSolid, bottom: borderSolid, left: borderSolid, right: borderSolid },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,borders)',
      },
    },

    // Dropdown Data Validation H2 (Tahun)
    {
      setDataValidation: {
        range: { sheetId: dashId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 7, endColumnIndex: 8 },
        rule: {
          condition: {
            type: 'ONE_OF_LIST',
            values: [
              { userEnteredValue: 'Semua Tahun' },
              { userEnteredValue: '2026' },
              { userEnteredValue: '2025' },
              { userEnteredValue: '2024' },
            ],
          },
          showCustomUi: true,
          strict: true,
        },
      },
    },
    // Dropdown Data Validation H3 (Sumber Kas)
    {
      setDataValidation: {
        range: { sheetId: dashId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 7, endColumnIndex: 8 },
        rule: {
          condition: {
            type: 'ONE_OF_LIST',
            values: [
              { userEnteredValue: 'Semua Mutasi' },
              { userEnteredValue: 'Kas Utama' },
              { userEnteredValue: 'Iuran Kas Anggota' },
            ],
          },
          showCustomUi: true,
          strict: true,
        },
      },
    },

    // Format Card 1 (Saldo Kas): B5:C7
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 1, endColumnIndex: 3 },
        cell: {
          userEnteredFormat: {
            backgroundColor: color(15, 118, 110), // Teal 700
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
            backgroundColor: color(240, 253, 244), // #F0FDF4
            textFormat: { foregroundColor: color(6, 95, 70), bold: true, fontSize: 18 },
            numberFormat: { type: 'CURRENCY', pattern: '"Rp"#,##0' },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
            borders: { bottom: borderSolid, left: borderSolid, right: borderSolid },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,numberFormat,horizontalAlignment,verticalAlignment,borders)',
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
            backgroundColor: color(220, 252, 231), // #DCFCE7
            textFormat: { foregroundColor: color(22, 101, 52), bold: true, fontSize: 16 },
            numberFormat: { type: 'CURRENCY', pattern: '"Rp"#,##0' },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
            borders: { bottom: borderSolid, left: borderSolid, right: borderSolid },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,numberFormat,horizontalAlignment,verticalAlignment,borders)',
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
            backgroundColor: color(254, 226, 226), // #FEE2E2
            textFormat: { foregroundColor: color(153, 27, 27), bold: true, fontSize: 16 },
            numberFormat: { type: 'CURRENCY', pattern: '"Rp"#,##0' },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
            borders: { bottom: borderSolid, left: borderSolid, right: borderSolid },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,numberFormat,horizontalAlignment,verticalAlignment,borders)',
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
            backgroundColor: color(255, 255, 255),
            textFormat: { foregroundColor: color(30, 41, 59), bold: true, fontSize: 16 },
            numberFormat: { type: 'NUMBER', pattern: '#,##0" Transaksi"' },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
            borders: { bottom: borderSolid, left: borderSolid, right: borderSolid },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,numberFormat,horizontalAlignment,verticalAlignment,borders)',
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
            borders: { bottom: borderSolid, left: borderSolid, right: borderSolid },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,numberFormat,horizontalAlignment,verticalAlignment,borders)',
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
            borders: { bottom: borderSolid, left: borderSolid, right: borderSolid },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,numberFormat,horizontalAlignment,verticalAlignment,borders)',
      },
    },

    // ------------------------------------------------------------------------
    // 8. Tambahkan 2 Chart Besar & Megah yang Mengisi Area Bawah (Tanpa Teks!)
    // Sumber Data diambil dari sheet `_DashboardData`
    // ------------------------------------------------------------------------

    // Chart 1: Donut Chart "Distribusi Pengeluaran per Kategori" (B13 ke F32)
    {
      addChart: {
        chart: {
          spec: {
            title: '🍩 Distribusi Pengeluaran per Kategori',
            titleTextFormat: { bold: true, fontSize: 13, foregroundColor: color(15, 23, 42) },
            pieChart: {
              pieHole: 0.44, // Donut hole
              legendPosition: 'RIGHT_LEGEND',
              domain: {
                sourceRange: {
                  sources: [
                    {
                      sheetId: dDataId,
                      startRowIndex: 1,
                      endRowIndex: 15,
                      startColumnIndex: 0,
                      endColumnIndex: 1,
                    },
                  ],
                },
              },
              series: {
                sourceRange: {
                  sources: [
                    {
                      sheetId: dDataId,
                      startRowIndex: 1,
                      endRowIndex: 15,
                      startColumnIndex: 1,
                      endColumnIndex: 2,
                    },
                  ],
                },
              },
            },
          },
          position: {
            overlayPosition: {
              anchorCell: { sheetId: dashId, rowIndex: 12, columnIndex: 1 },
              widthPixels: 510,
              heightPixels: 400,
            },
          },
        },
      },
    },

    // Chart 2: Column Chart "Arus Kas Tahunan (Pemasukan vs Pengeluaran)" (G13 ke J32)
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
                          sheetId: dDataId,
                          startRowIndex: 0,
                          endRowIndex: 4,
                          startColumnIndex: 3,
                          endColumnIndex: 4,
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
                          sheetId: dDataId,
                          startRowIndex: 0,
                          endRowIndex: 4,
                          startColumnIndex: 4,
                          endColumnIndex: 5,
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
                          sheetId: dDataId,
                          startRowIndex: 0,
                          endRowIndex: 4,
                          startColumnIndex: 5,
                          endColumnIndex: 6,
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
              offsetXPixels: 20,
              widthPixels: 580,
              heightPixels: 400,
            },
          },
        },
      },
    },
  ];

  console.log(`Mengirim ${uiRequests.length} perintah styling murni & grafik ke Google Sheets...`);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: uiRequests },
  });

  console.log('🎉 Dashboard Asli Bersih (Hanya Chart, Pilihan Filter & KPI Cards) Berhasil Dibuat!');
}

run().catch((err) => {
  console.error('❌ Gagal merapikan sheet:', err);
  process.exit(1);
});
