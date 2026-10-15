import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth';

function getSpreadsheetId(): string {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) throw new Error('GOOGLE_SHEET_ID belum dikonfigurasi di .env.local');
  return id;
}

function color(r: number, g: number, b: number) {
  return { red: r / 255, green: g / 255, blue: b / 255 };
}

async function run() {
  console.log('🎨 Mendesain Ulang Dashboard Seperti Template Excel/BI Profesional...');
  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = getSpreadsheetId();

  // 1. Ambil meta seluruh sheet & chart
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets(properties,charts,merges)',
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

  // Hapus semua chart lama di Dashboard jika ada
  const dashSheetObj = existingSheets.find((s) => s.properties?.title?.toLowerCase() === 'dashboard');
  if (dashSheetObj?.charts && dashSheetObj.charts.length > 0) {
    for (const c of dashSheetObj.charts) {
      if (c.chartId) {
        batchRequests.push({ deleteEmbeddedObject: { objectId: c.chartId } });
      }
    }
  }

  // Unmerge semua merge lama di Dashboard
  if (dashSheetObj?.merges && dashSheetObj.merges.length > 0) {
    for (const m of dashSheetObj.merges) {
      batchRequests.push({ unmergeCells: { range: m } });
    }
  }

  // 2. Buat sheet data pembantu `_DashboardData` (hidden)
  if (dataSheetId === null) {
    const newSheetId = Math.floor(100000000 + Math.random() * 900000000);
    dataSheetId = newSheetId;
    batchRequests.push({
      addSheet: {
        properties: {
          sheetId: newSheetId,
          title: '_DashboardData',
          hidden: true,
        },
      },
    });
  } else {
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

  // 3. Konfigurasi Dashboard Sheet (Tab 0, hideGridlines: true, 16 kolom, 48 baris)
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
            rowCount: 48,
            columnCount: 16,
            hideGridlines: true,
          },
          tabColor: color(22, 101, 52), // Forest Green
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
            rowCount: 48,
            columnCount: 16,
            hideGridlines: true,
          },
          tabColor: color(22, 101, 52),
        },
        fields: 'index,gridProperties.hideGridlines,gridProperties.rowCount,gridProperties.columnCount,tabColor',
      },
    });
  }

  // Atur urutan tab: Dashboard -> Kas -> Kas_Anggota -> Anggota
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

  console.log(`Mengirim ${batchRequests.length} konfigurasi awal...`);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: batchRequests },
  });

  const dashId = dashboardSheetId!;
  const dDataId = dataSheetId!;

  // 4. Bersihkan total isi sheet Dashboard
  console.log('🧹 Membersihkan seluruh teks lama di sheet Dashboard...');
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: 'Dashboard!A1:Z60',
  });

  // Cat seluruh kanvas dengan latar belakang Soft Slate Gray (#F1F5F9)
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: { sheetId: dashId, startRowIndex: 0, endRowIndex: 48, startColumnIndex: 0, endColumnIndex: 16 },
            cell: {
              userEnteredFormat: {
                backgroundColor: color(241, 245, 249), // #F1F5F9 (Soft Slate)
              },
            },
            fields: 'userEnteredFormat.backgroundColor',
          },
        },
      ],
    },
  });

  // 5. Tulis Sumber Data Perhitungan ke Sheet Tersembunyi `_DashboardData`
  console.log('📊 Menulis seluruh kalkulasi & data grafik ke `_DashboardData`...');
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: '_DashboardData!A1:N25',
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [
        // Baris 1: Header Kategori (A:B), Tahunan (D:F), Bulanan 2026 (H:J)
        ['Kategori', 'Total Nominal', '', 'Tahun', 'Pemasukan', 'Pengeluaran', '', 'Bulan', 'Pemasukan', 'Pengeluaran'],
        // Baris 2: Query Kategori, Tahunan 2024, Bulanan Jan
        [
          '=QUERY(Kas!B2:D, "select C, sum(D) where B contains \'Pengeluaran\' and C is not null and D > 0 group by C order by sum(D) desc label C \'\', sum(D) \'\'", 0)',
          '',
          '',
          '2024',
          '=SUMIFS(Kas!D:D, Kas!B:B, "*Pemasukan*", Kas!A:A, "*2024*")',
          '=SUMIFS(Kas!D:D, Kas!B:B, "*Pengeluaran*", Kas!A:A, "*2024*")',
          '',
          'Jan',
          '=SUMIFS(Kas!D:D, Kas!B:B, "*Pemasukan*", Kas!A:A, "*2026-01*")',
          '=SUMIFS(Kas!D:D, Kas!B:B, "*Pengeluaran*", Kas!A:A, "*2026-01*")',
        ],
        // Baris 3: Tahunan 2025, Bulanan Feb
        [
          '', '', '',
          '2025',
          '=SUMIFS(Kas!D:D, Kas!B:B, "*Pemasukan*", Kas!A:A, "*2025*")',
          '=SUMIFS(Kas!D:D, Kas!B:B, "*Pengeluaran*", Kas!A:A, "*2025*")',
          '',
          'Feb',
          '=SUMIFS(Kas!D:D, Kas!B:B, "*Pemasukan*", Kas!A:A, "*2026-02*")',
          '=SUMIFS(Kas!D:D, Kas!B:B, "*Pengeluaran*", Kas!A:A, "*2026-02*")',
        ],
        // Baris 4: Tahunan 2026, Bulanan Mar
        [
          '', '', '',
          '2026',
          '=SUMIFS(Kas!D:D, Kas!B:B, "*Pemasukan*", Kas!A:A, "*2026*")',
          '=SUMIFS(Kas!D:D, Kas!B:B, "*Pengeluaran*", Kas!A:A, "*2026*")',
          '',
          'Mar',
          '=SUMIFS(Kas!D:D, Kas!B:B, "*Pemasukan*", Kas!A:A, "*2026-03*")',
          '=SUMIFS(Kas!D:D, Kas!B:B, "*Pengeluaran*", Kas!A:A, "*2026-03*")',
        ],
        // Baris 5: Apr
        ['', '', '', '', '', '', '', 'Apr', '=SUMIFS(Kas!D:D, Kas!B:B, "*Pemasukan*", Kas!A:A, "*2026-04*")', '=SUMIFS(Kas!D:D, Kas!B:B, "*Pengeluaran*", Kas!A:A, "*2026-04*")'],
        // Baris 6: Mei
        ['', '', '', '', '', '', '', 'Mei', '=SUMIFS(Kas!D:D, Kas!B:B, "*Pemasukan*", Kas!A:A, "*2026-05*")', '=SUMIFS(Kas!D:D, Kas!B:B, "*Pengeluaran*", Kas!A:A, "*2026-05*")'],
        // Baris 7: Jun
        ['', '', '', '', '', '', '', 'Jun', '=SUMIFS(Kas!D:D, Kas!B:B, "*Pemasukan*", Kas!A:A, "*2026-06*")', '=SUMIFS(Kas!D:D, Kas!B:B, "*Pengeluaran*", Kas!A:A, "*2026-06*")'],
        // Baris 8: Jul
        ['', '', '', '', '', '', '', 'Jul', '=SUMIFS(Kas!D:D, Kas!B:B, "*Pemasukan*", Kas!A:A, "*2026-07*")', '=SUMIFS(Kas!D:D, Kas!B:B, "*Pengeluaran*", Kas!A:A, "*2026-07*")'],
        // Baris 9: Agt
        ['', '', '', '', '', '', '', 'Agt', '=SUMIFS(Kas!D:D, Kas!B:B, "*Pemasukan*", Kas!A:A, "*2026-08*")', '=SUMIFS(Kas!D:D, Kas!B:B, "*Pengeluaran*", Kas!A:A, "*2026-08*")'],
        // Baris 10: Sep
        ['', '', '', '', '', '', '', 'Sep', '=SUMIFS(Kas!D:D, Kas!B:B, "*Pemasukan*", Kas!A:A, "*2026-09*")', '=SUMIFS(Kas!D:D, Kas!B:B, "*Pengeluaran*", Kas!A:A, "*2026-09*")'],
        // Baris 11: Okt
        ['', '', '', '', '', '', '', 'Okt', '=SUMIFS(Kas!D:D, Kas!B:B, "*Pemasukan*", Kas!A:A, "*2026-10*")', '=SUMIFS(Kas!D:D, Kas!B:B, "*Pengeluaran*", Kas!A:A, "*2026-10*")'],
        // Baris 12: Nov
        ['', '', '', '', '', '', '', 'Nov', '=SUMIFS(Kas!D:D, Kas!B:B, "*Pemasukan*", Kas!A:A, "*2026-11*")', '=SUMIFS(Kas!D:D, Kas!B:B, "*Pengeluaran*", Kas!A:A, "*2026-11*")'],
        // Baris 13: Des
        ['', '', '', '', '', '', '', 'Des', '=SUMIFS(Kas!D:D, Kas!B:B, "*Pemasukan*", Kas!A:A, "*2026-12*")', '=SUMIFS(Kas!D:D, Kas!B:B, "*Pengeluaran*", Kas!A:A, "*2026-12*")'],
      ],
    },
  });

  // 6. Tulis Teks & Formula di Dashboard (Hanya Header, Filter, 5 Kartu KPI, dan Widget Rincian Kanan Bawah)
  console.log('✨ Menulis Struktur UI Dashboard Eksekutif...');
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'Dashboard!A1:O45',
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [
        // Baris 1: Kosong
        [],
        // Baris 2: Header Banner (B2:I2 Title, L2:O2 Dropdown Periode)
        ['', '🏛️ PERSONAL & EXECUTIVE FINANCE DASHBOARD', '', '', '', '', '', '', '', '', '', '📅 Periode:', 'Semua Tahun', '🔍 Filter:', 'Semua Kas'],
        // Baris 3: Subtitle Banner
        ['', 'Realtime Sync Bot Telegram • Executive Cashflow & Budget Management', '', '', '', '', '', '', '', '', '', '', 'Update: Realtime'],
        // Baris 4: Kosong (Spacer)
        [],
        // Baris 5: Judul 5 KPI Cards (B5, E5, H5, K5, N5)
        ['', '💰 SALDO KAS SAAT INI', '', '', '🟢 TOTAL PEMASUKAN', '', '', '🔴 TOTAL PENGELUARAN', '', '', '👥 ANGGOTA AKTIF', '', '', '💵 IURAN KAS TERKUMPUL'],
        // Baris 6: Nilai 5 KPI Cards
        [
          '',
          '=SUMIF(Kas!B2:B, "*Pemasukan*", Kas!D2:D) - SUMIF(Kas!B2:B, "*Pengeluaran*", Kas!D2:D)',
          '',
          '',
          '=SUMIF(Kas!B2:B, "*Pemasukan*", Kas!D2:D)',
          '',
          '',
          '=SUMIF(Kas!B2:B, "*Pengeluaran*", Kas!D2:D)',
          '',
          '',
          '=COUNTIF(Anggota!D2:D, "Aktif")',
          '',
          '',
          '=SUM(Kas_Anggota!D2:D)',
        ],
        // Baris 7: Subtext KPI Card
        ['', 'Net Cash Balance', '', '', 'Inflow Terkumpul', '', '', 'Outflow Belanja', '', '', 'Anggota Terdaftar', '', '', 'Total Kas Masuk'],
        // Baris 8: Spacer
        [],
        // Baris 9: Header Widget Kartu Chart Atas
        ['', '🍩 DISTRIBUSI PENGELUARAN PER KATEGORI', '', '', '', '', '', '📊 PERBANDINGAN ARUS KAS TAHUNAN (2024 - 2026)'],
        // Baris 10 - 27: Kosong (Area tempat Donut Chart & Annual Column Chart berada)
        [], [], [], [], [], [], [], [], [], [], [], [], [], [], [], [], [], [],
        // Baris 28: Spacer
        [],
        // Baris 29: Header Widget Kartu Bawah
        ['', '📈 TREN MUTASI KAS BULANAN (2026)', '', '', '', '', '', '🏆 TOP 5 PENGELUARAN TERBESAR & STATISTIK KAS'],
        // Baris 30: Subheader Top 5 di Widget Kanan Bawah
        ['', '', '', '', '', '', '', '', 'Kategori', 'Total Belanja', 'Proporsi', '', 'Indikator Kas', 'Nilai'],
        // Baris 31: Data Rank 1
        ['', '', '', '', '', '', '', '', '=_DashboardData!A2', '=_DashboardData!B2', '=_DashboardData!B2 / $H$6', '', 'Total Mutasi:', '=COUNTA(Kas!A2:A) & " Transaksi"'],
        // Baris 32: Data Rank 2
        ['', '', '', '', '', '', '', '', '=_DashboardData!A3', '=_DashboardData!B3', '=_DashboardData!B3 / $H$6', '', 'Rata-rata Keluar:', '=AVERAGEIF(Kas!B2:B, "*Pengeluaran*", Kas!D2:D)'],
        // Baris 33: Data Rank 3
        ['', '', '', '', '', '', '', '', '=_DashboardData!A4', '=_DashboardData!B4', '=_DashboardData!B4 / $H$6', '', 'Kepatuhan Iuran:', '=COUNTIF(Kas_Anggota!F2:F, "Lunas") / COUNTA(Kas_Anggota!F2:F)'],
        // Baris 34: Data Rank 4
        ['', '', '', '', '', '', '', '', '=_DashboardData!A5', '=_DashboardData!B5', '=_DashboardData!B5 / $H$6', '', 'Status Kas:', 'SEHAT (Surplus)'],
        // Baris 35: Data Rank 5
        ['', '', '', '', '', '', '', '', '=_DashboardData!A6', '=_DashboardData!B6', '=_DashboardData!B6 / $H$6', '', 'Buku Aktif:', '=Kas!A1 & " (Kas Utama)"'],
      ],
    },
  });

  // 7. Styling Visual: Bentuk Kartu UI Rounded/White Box, Border Elegan, dan Typography
  console.log('🎨 Menerapkan Styling Kartu UI & Memasang 3 Chart...');

  const borderCard = {
    style: 'SOLID',
    width: 1,
    color: color(226, 232, 240), // Slate 200
  };
  const borderCardDark = {
    style: 'SOLID',
    width: 1,
    color: color(203, 213, 225), // Slate 300
  };

  const uiRequests: any[] = [
    // Dimensi Kolom (Total 16 Kolom)
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 25 }, fields: 'pixelSize' } }, // A (margin)
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 115 }, fields: 'pixelSize' } }, // B
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 2, endIndex: 3 }, properties: { pixelSize: 115 }, fields: 'pixelSize' } }, // C (Card 1: 230px)
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 3, endIndex: 4 }, properties: { pixelSize: 20 }, fields: 'pixelSize' } },  // D spacer
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 4, endIndex: 5 }, properties: { pixelSize: 115 }, fields: 'pixelSize' } }, // E
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 5, endIndex: 6 }, properties: { pixelSize: 115 }, fields: 'pixelSize' } }, // F (Card 2: 230px)
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 6, endIndex: 7 }, properties: { pixelSize: 20 }, fields: 'pixelSize' } },  // G spacer
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 7, endIndex: 8 }, properties: { pixelSize: 115 }, fields: 'pixelSize' } }, // H
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 8, endIndex: 9 }, properties: { pixelSize: 115 }, fields: 'pixelSize' } }, // I (Card 3: 230px)
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 9, endIndex: 10 }, properties: { pixelSize: 20 }, fields: 'pixelSize' } }, // J spacer
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 10, endIndex: 11 }, properties: { pixelSize: 115 }, fields: 'pixelSize' } }, // K
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 11, endIndex: 12 }, properties: { pixelSize: 115 }, fields: 'pixelSize' } }, // L (Card 4: 230px)
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 12, endIndex: 13 }, properties: { pixelSize: 20 }, fields: 'pixelSize' } }, // M spacer
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 13, endIndex: 14 }, properties: { pixelSize: 115 }, fields: 'pixelSize' } }, // N
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 14, endIndex: 15 }, properties: { pixelSize: 115 }, fields: 'pixelSize' } }, // O (Card 5: 230px)
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 15, endIndex: 16 }, properties: { pixelSize: 25 }, fields: 'pixelSize' } }, // P (margin)

    // Tinggi Baris
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'ROWS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 42 }, fields: 'pixelSize' } }, // Row 2 Header
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'ROWS', startIndex: 2, endIndex: 3 }, properties: { pixelSize: 26 }, fields: 'pixelSize' } }, // Row 3 Subtitle
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'ROWS', startIndex: 4, endIndex: 5 }, properties: { pixelSize: 26 }, fields: 'pixelSize' } }, // Row 5 Card Title
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'ROWS', startIndex: 5, endIndex: 6 }, properties: { pixelSize: 38 }, fields: 'pixelSize' } }, // Row 6 Card Value
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'ROWS', startIndex: 6, endIndex: 7 }, properties: { pixelSize: 22 }, fields: 'pixelSize' } }, // Row 7 Card Subtext
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'ROWS', startIndex: 8, endIndex: 9 }, properties: { pixelSize: 34 }, fields: 'pixelSize' } }, // Row 9 Widget Header
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'ROWS', startIndex: 28, endIndex: 29 }, properties: { pixelSize: 34 }, fields: 'pixelSize' } }, // Row 29 Bottom Header

    // Merges
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 1, endColumnIndex: 11 }, mergeType: 'MERGE_ALL' } }, // B2:K2
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 1, endColumnIndex: 11 }, mergeType: 'MERGE_ALL' } }, // B3:K3

    // 5 KPI Cards (B5:C7, E5:F7, H5:I7, K5:L7, N5:O7)
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 1, endColumnIndex: 3 }, mergeType: 'MERGE_ALL' } },
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 5, endRowIndex: 6, startColumnIndex: 1, endColumnIndex: 3 }, mergeType: 'MERGE_ALL' } },
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 6, endRowIndex: 7, startColumnIndex: 1, endColumnIndex: 3 }, mergeType: 'MERGE_ALL' } },

    { mergeCells: { range: { sheetId: dashId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 4, endColumnIndex: 6 }, mergeType: 'MERGE_ALL' } },
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 5, endRowIndex: 6, startColumnIndex: 4, endColumnIndex: 6 }, mergeType: 'MERGE_ALL' } },
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 6, endRowIndex: 7, startColumnIndex: 4, endColumnIndex: 6 }, mergeType: 'MERGE_ALL' } },

    { mergeCells: { range: { sheetId: dashId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 7, endColumnIndex: 9 }, mergeType: 'MERGE_ALL' } },
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 5, endRowIndex: 6, startColumnIndex: 7, endColumnIndex: 9 }, mergeType: 'MERGE_ALL' } },
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 6, endRowIndex: 7, startColumnIndex: 7, endColumnIndex: 9 }, mergeType: 'MERGE_ALL' } },

    { mergeCells: { range: { sheetId: dashId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 10, endColumnIndex: 12 }, mergeType: 'MERGE_ALL' } },
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 5, endRowIndex: 6, startColumnIndex: 10, endColumnIndex: 12 }, mergeType: 'MERGE_ALL' } },
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 6, endRowIndex: 7, startColumnIndex: 10, endColumnIndex: 12 }, mergeType: 'MERGE_ALL' } },

    { mergeCells: { range: { sheetId: dashId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 13, endColumnIndex: 15 }, mergeType: 'MERGE_ALL' } },
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 5, endRowIndex: 6, startColumnIndex: 13, endColumnIndex: 15 }, mergeType: 'MERGE_ALL' } },
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 6, endRowIndex: 7, startColumnIndex: 13, endColumnIndex: 15 }, mergeType: 'MERGE_ALL' } },

    // Widget Containers Merges
    // Widget 1 Header (B9:G9) & Widget 2 Header (H9:O9)
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 8, endRowIndex: 9, startColumnIndex: 1, endColumnIndex: 7 }, mergeType: 'MERGE_ALL' } },
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 8, endRowIndex: 9, startColumnIndex: 7, endColumnIndex: 15 }, mergeType: 'MERGE_ALL' } },
    // Widget 3 Header (B29:G29) & Widget 4 Header (H29:O29)
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 28, endRowIndex: 29, startColumnIndex: 1, endColumnIndex: 7 }, mergeType: 'MERGE_ALL' } },
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 28, endRowIndex: 29, startColumnIndex: 7, endColumnIndex: 15 }, mergeType: 'MERGE_ALL' } },

    // Styling Banner Title (B2)
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 1, endColumnIndex: 11 },
        cell: {
          userEnteredFormat: {
            textFormat: { foregroundColor: color(15, 23, 42), bold: true, fontSize: 16 },
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(textFormat,verticalAlignment)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 1, endColumnIndex: 11 },
        cell: {
          userEnteredFormat: {
            textFormat: { foregroundColor: color(100, 116, 139), fontSize: 9 },
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(textFormat,verticalAlignment)',
      },
    },

    // Dropdown Labels & Buttons (L2:O3)
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 11, endColumnIndex: 12 },
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
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 12, endColumnIndex: 13 },
        cell: {
          userEnteredFormat: {
            backgroundColor: color(255, 255, 255),
            textFormat: { foregroundColor: color(15, 23, 42), bold: true, fontSize: 9 },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
            borders: { top: borderCard, bottom: borderCard, left: borderCard, right: borderCard },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,borders)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 13, endColumnIndex: 14 },
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
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 14, endColumnIndex: 15 },
        cell: {
          userEnteredFormat: {
            backgroundColor: color(255, 255, 255),
            textFormat: { foregroundColor: color(15, 23, 42), bold: true, fontSize: 9 },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
            borders: { top: borderCard, bottom: borderCard, left: borderCard, right: borderCard },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,borders)',
      },
    },
    // Data Validation Dropdown Tahun & Sumber
    {
      setDataValidation: {
        range: { sheetId: dashId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 12, endColumnIndex: 13 },
        rule: {
          condition: {
            type: 'ONE_OF_LIST',
            values: [{ userEnteredValue: 'Semua Tahun' }, { userEnteredValue: '2026' }, { userEnteredValue: '2025' }, { userEnteredValue: '2024' }],
          },
          showCustomUi: true,
          strict: true,
        },
      },
    },
    {
      setDataValidation: {
        range: { sheetId: dashId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 14, endColumnIndex: 15 },
        rule: {
          condition: {
            type: 'ONE_OF_LIST',
            values: [{ userEnteredValue: 'Semua Kas' }, { userEnteredValue: 'Kas Utama' }, { userEnteredValue: 'Kas Anggota' }],
          },
          showCustomUi: true,
          strict: true,
        },
      },
    },

    // -------------------------------------------------------------
    // Styling 5 Kartu KPI (White Box, Shadow Border, Rounded Look)
    // -------------------------------------------------------------
    // Card 1: Saldo Kas (B5:C7)
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 4, endRowIndex: 7, startColumnIndex: 1, endColumnIndex: 3 },
        cell: {
          userEnteredFormat: {
            backgroundColor: color(255, 255, 255),
            borders: { top: borderCard, bottom: borderCard, left: borderCard, right: borderCard },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,borders,horizontalAlignment,verticalAlignment)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 1, endColumnIndex: 3 },
        cell: { userEnteredFormat: { textFormat: { foregroundColor: color(100, 116, 139), bold: true, fontSize: 9 } } },
        fields: 'userEnteredFormat.textFormat',
      },
    },
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 5, endRowIndex: 6, startColumnIndex: 1, endColumnIndex: 3 },
        cell: {
          userEnteredFormat: {
            textFormat: { foregroundColor: color(15, 118, 110), bold: true, fontSize: 16 },
            numberFormat: { type: 'CURRENCY', pattern: '"Rp"#,##0' },
          },
        },
        fields: 'userEnteredFormat(textFormat,numberFormat)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 6, endRowIndex: 7, startColumnIndex: 1, endColumnIndex: 3 },
        cell: { userEnteredFormat: { textFormat: { foregroundColor: color(148, 163, 184), fontSize: 8 } } },
        fields: 'userEnteredFormat.textFormat',
      },
    },

    // Card 2: Pemasukan (E5:F7)
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 4, endRowIndex: 7, startColumnIndex: 4, endColumnIndex: 6 },
        cell: {
          userEnteredFormat: {
            backgroundColor: color(255, 255, 255),
            borders: { top: borderCard, bottom: borderCard, left: borderCard, right: borderCard },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,borders,horizontalAlignment,verticalAlignment)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 4, endColumnIndex: 6 },
        cell: { userEnteredFormat: { textFormat: { foregroundColor: color(100, 116, 139), bold: true, fontSize: 9 } } },
        fields: 'userEnteredFormat.textFormat',
      },
    },
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 5, endRowIndex: 6, startColumnIndex: 4, endColumnIndex: 6 },
        cell: {
          userEnteredFormat: {
            textFormat: { foregroundColor: color(21, 128, 61), bold: true, fontSize: 16 },
            numberFormat: { type: 'CURRENCY', pattern: '"Rp"#,##0' },
          },
        },
        fields: 'userEnteredFormat(textFormat,numberFormat)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 6, endRowIndex: 7, startColumnIndex: 4, endColumnIndex: 6 },
        cell: { userEnteredFormat: { textFormat: { foregroundColor: color(148, 163, 184), fontSize: 8 } } },
        fields: 'userEnteredFormat.textFormat',
      },
    },

    // Card 3: Pengeluaran (H5:I7)
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 4, endRowIndex: 7, startColumnIndex: 7, endColumnIndex: 9 },
        cell: {
          userEnteredFormat: {
            backgroundColor: color(255, 255, 255),
            borders: { top: borderCard, bottom: borderCard, left: borderCard, right: borderCard },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,borders,horizontalAlignment,verticalAlignment)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 7, endColumnIndex: 9 },
        cell: { userEnteredFormat: { textFormat: { foregroundColor: color(100, 116, 139), bold: true, fontSize: 9 } } },
        fields: 'userEnteredFormat.textFormat',
      },
    },
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 5, endRowIndex: 6, startColumnIndex: 7, endColumnIndex: 9 },
        cell: {
          userEnteredFormat: {
            textFormat: { foregroundColor: color(220, 38, 38), bold: true, fontSize: 16 },
            numberFormat: { type: 'CURRENCY', pattern: '"Rp"#,##0' },
          },
        },
        fields: 'userEnteredFormat(textFormat,numberFormat)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 6, endRowIndex: 7, startColumnIndex: 7, endColumnIndex: 9 },
        cell: { userEnteredFormat: { textFormat: { foregroundColor: color(148, 163, 184), fontSize: 8 } } },
        fields: 'userEnteredFormat.textFormat',
      },
    },

    // Card 4: Anggota Aktif (K5:L7)
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 4, endRowIndex: 7, startColumnIndex: 10, endColumnIndex: 12 },
        cell: {
          userEnteredFormat: {
            backgroundColor: color(255, 255, 255),
            borders: { top: borderCard, bottom: borderCard, left: borderCard, right: borderCard },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,borders,horizontalAlignment,verticalAlignment)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 10, endColumnIndex: 12 },
        cell: { userEnteredFormat: { textFormat: { foregroundColor: color(100, 116, 139), bold: true, fontSize: 9 } } },
        fields: 'userEnteredFormat.textFormat',
      },
    },
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 5, endRowIndex: 6, startColumnIndex: 10, endColumnIndex: 12 },
        cell: {
          userEnteredFormat: {
            textFormat: { foregroundColor: color(29, 78, 216), bold: true, fontSize: 16 },
            numberFormat: { type: 'NUMBER', pattern: '#,##0" Orang"' },
          },
        },
        fields: 'userEnteredFormat(textFormat,numberFormat)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 6, endRowIndex: 7, startColumnIndex: 10, endColumnIndex: 12 },
        cell: { userEnteredFormat: { textFormat: { foregroundColor: color(148, 163, 184), fontSize: 8 } } },
        fields: 'userEnteredFormat.textFormat',
      },
    },

    // Card 5: Iuran Kas (N5:O7)
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 4, endRowIndex: 7, startColumnIndex: 13, endColumnIndex: 15 },
        cell: {
          userEnteredFormat: {
            backgroundColor: color(255, 255, 255),
            borders: { top: borderCard, bottom: borderCard, left: borderCard, right: borderCard },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,borders,horizontalAlignment,verticalAlignment)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 13, endColumnIndex: 15 },
        cell: { userEnteredFormat: { textFormat: { foregroundColor: color(100, 116, 139), bold: true, fontSize: 9 } } },
        fields: 'userEnteredFormat.textFormat',
      },
    },
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 5, endRowIndex: 6, startColumnIndex: 13, endColumnIndex: 15 },
        cell: {
          userEnteredFormat: {
            textFormat: { foregroundColor: color(217, 119, 6), bold: true, fontSize: 16 },
            numberFormat: { type: 'CURRENCY', pattern: '"Rp"#,##0' },
          },
        },
        fields: 'userEnteredFormat(textFormat,numberFormat)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 6, endRowIndex: 7, startColumnIndex: 13, endColumnIndex: 15 },
        cell: { userEnteredFormat: { textFormat: { foregroundColor: color(148, 163, 184), fontSize: 8 } } },
        fields: 'userEnteredFormat.textFormat',
      },
    },

    // -------------------------------------------------------------
    // Styling 4 Wadah Widget Kartu Putih (Card Containers)
    // -------------------------------------------------------------
    // Widget 1 Container (B9:G27 - Donut Chart)
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 8, endRowIndex: 27, startColumnIndex: 1, endColumnIndex: 7 },
        cell: {
          userEnteredFormat: {
            backgroundColor: color(255, 255, 255),
            borders: { top: borderCard, bottom: borderCard, left: borderCard, right: borderCard },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,borders)',
      },
    },
    // Widget 1 Header Label
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 8, endRowIndex: 9, startColumnIndex: 1, endColumnIndex: 7 },
        cell: {
          userEnteredFormat: {
            textFormat: { foregroundColor: color(30, 41, 59), bold: true, fontSize: 10 },
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(textFormat,verticalAlignment)',
      },
    },

    // Widget 2 Container (H9:O27 - Annual Column Chart)
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 8, endRowIndex: 27, startColumnIndex: 7, endColumnIndex: 15 },
        cell: {
          userEnteredFormat: {
            backgroundColor: color(255, 255, 255),
            borders: { top: borderCard, bottom: borderCard, left: borderCard, right: borderCard },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,borders)',
      },
    },
    // Widget 2 Header Label
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 8, endRowIndex: 9, startColumnIndex: 7, endColumnIndex: 15 },
        cell: {
          userEnteredFormat: {
            textFormat: { foregroundColor: color(30, 41, 59), bold: true, fontSize: 10 },
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(textFormat,verticalAlignment)',
      },
    },

    // Widget 3 Container (B29:G45 - Monthly Trend Chart)
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 28, endRowIndex: 45, startColumnIndex: 1, endColumnIndex: 7 },
        cell: {
          userEnteredFormat: {
            backgroundColor: color(255, 255, 255),
            borders: { top: borderCard, bottom: borderCard, left: borderCard, right: borderCard },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,borders)',
      },
    },
    // Widget 3 Header Label
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 28, endRowIndex: 29, startColumnIndex: 1, endColumnIndex: 7 },
        cell: {
          userEnteredFormat: {
            textFormat: { foregroundColor: color(30, 41, 59), bold: true, fontSize: 10 },
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(textFormat,verticalAlignment)',
      },
    },

    // Widget 4 Container (H29:O45 - Top 5 Kategori & Key Metrics)
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 28, endRowIndex: 45, startColumnIndex: 7, endColumnIndex: 15 },
        cell: {
          userEnteredFormat: {
            backgroundColor: color(255, 255, 255),
            borders: { top: borderCard, bottom: borderCard, left: borderCard, right: borderCard },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,borders)',
      },
    },
    // Widget 4 Header Label
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 28, endRowIndex: 29, startColumnIndex: 7, endColumnIndex: 15 },
        cell: {
          userEnteredFormat: {
            textFormat: { foregroundColor: color(30, 41, 59), bold: true, fontSize: 10 },
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(textFormat,verticalAlignment)',
      },
    },

    // Format Subheader Widget 4 (Row 30)
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 29, endRowIndex: 30, startColumnIndex: 8, endColumnIndex: 15 },
        cell: {
          userEnteredFormat: {
            backgroundColor: color(248, 250, 252),
            textFormat: { foregroundColor: color(71, 85, 105), bold: true, fontSize: 9 },
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment)',
      },
    },
    // Format Tabel Top 5 di Widget 4:
    // Kolom J (Nominal) Currency
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 30, endRowIndex: 35, startColumnIndex: 9, endColumnIndex: 10 },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: 'CURRENCY', pattern: '"Rp"#,##0' },
            textFormat: { bold: true, fontSize: 9, foregroundColor: color(15, 23, 42) },
            horizontalAlignment: 'RIGHT',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(numberFormat,textFormat,horizontalAlignment,verticalAlignment)',
      },
    },
    // Kolom K (Proporsi) Percentage
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 30, endRowIndex: 35, startColumnIndex: 10, endColumnIndex: 11 },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: 'PERCENT', pattern: '0.0%' },
            textFormat: { fontSize: 9, foregroundColor: color(100, 116, 139) },
            horizontalAlignment: 'RIGHT',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(numberFormat,textFormat,horizontalAlignment,verticalAlignment)',
      },
    },
    // Kolom M (Indikator Kas)
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 30, endRowIndex: 35, startColumnIndex: 12, endColumnIndex: 13 },
        cell: {
          userEnteredFormat: {
            textFormat: { fontSize: 9, foregroundColor: color(100, 116, 139), bold: true },
            horizontalAlignment: 'RIGHT',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment)',
      },
    },
    // Kolom N (Nilai Indikator)
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 30, endRowIndex: 35, startColumnIndex: 13, endColumnIndex: 15 },
        cell: {
          userEnteredFormat: {
            textFormat: { fontSize: 9, foregroundColor: color(15, 23, 42), bold: true },
            horizontalAlignment: 'LEFT',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment)',
      },
    },

    // -------------------------------------------------------------
    // 8. Pasang 3 Chart Profesional di Atas Wadah Kartu Putih
    // -------------------------------------------------------------

    // Chart 1: Donut Chart "Distribusi Pengeluaran per Kategori" (Wadah Kiri Atas)
    {
      addChart: {
        chart: {
          spec: {
            title: '',
            pieChart: {
              pieHole: 0.48, // Modern donut
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
              anchorCell: { sheetId: dashId, rowIndex: 9, columnIndex: 1 },
              offsetXPixels: 10,
              offsetYPixels: 5,
              widthPixels: 490,
              heightPixels: 310,
            },
          },
        },
      },
    },

    // Chart 2: Column Chart "Arus Kas Tahunan (Pemasukan vs Pengeluaran)" (Wadah Kanan Atas)
    {
      addChart: {
        chart: {
          spec: {
            title: '',
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
                    rgbColor: color(16, 185, 129), // Emerald Green
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
                    rgbColor: color(239, 68, 68), // Crimson Red
                  },
                },
              ],
            },
          },
          position: {
            overlayPosition: {
              anchorCell: { sheetId: dashId, rowIndex: 9, columnIndex: 7 },
              offsetXPixels: 15,
              offsetYPixels: 5,
              widthPixels: 560,
              heightPixels: 310,
            },
          },
        },
      },
    },

    // Chart 3: Area / Line / Column Chart "Tren Kas Bulanan 2026" (Wadah Kiri Bawah)
    {
      addChart: {
        chart: {
          spec: {
            title: '',
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
                          endRowIndex: 13,
                          startColumnIndex: 7,
                          endColumnIndex: 8,
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
                          endRowIndex: 13,
                          startColumnIndex: 8,
                          endColumnIndex: 9,
                        },
                      ],
                    },
                  },
                  targetAxis: 'LEFT_AXIS',
                  colorStyle: {
                    rgbColor: color(16, 185, 129),
                  },
                },
                {
                  series: {
                    sourceRange: {
                      sources: [
                        {
                          sheetId: dDataId,
                          startRowIndex: 0,
                          endRowIndex: 13,
                          startColumnIndex: 9,
                          endColumnIndex: 10,
                        },
                      ],
                    },
                  },
                  targetAxis: 'LEFT_AXIS',
                  colorStyle: {
                    rgbColor: color(239, 68, 68),
                  },
                },
              ],
            },
          },
          position: {
            overlayPosition: {
              anchorCell: { sheetId: dashId, rowIndex: 29, columnIndex: 1 },
              offsetXPixels: 10,
              offsetYPixels: 5,
              widthPixels: 490,
              heightPixels: 260,
            },
          },
        },
      },
    },
  ];

  console.log(`Mengirim ${uiRequests.length} perintah styling kartu & 3 chart ke Google Sheets...`);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: uiRequests },
  });

  console.log('🎉 Dashboard Modern Gaya Excel / Power BI Berhasil Terpasang Sempurna!');
}

run().catch((err) => {
  console.error('❌ Gagal merapikan sheet:', err);
  process.exit(1);
});
