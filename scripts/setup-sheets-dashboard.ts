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
  console.log('🚀 Merancang Ulang Dashboard Interaktif Sesuai Referensi...');
  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = getSpreadsheetId();

  // 1. Ambil metadata seluruh sheet, chart, dan merge yang ada
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
    const newDashId = 0;
    dashboardSheetId = newDashId;
    batchRequests.push({
      addSheet: {
        properties: {
          sheetId: newDashId,
          title: 'Dashboard',
          index: 0,
          gridProperties: {
            rowCount: 48,
            columnCount: 16,
            hideGridlines: true,
          },
          tabColor: color(30, 58, 47), // Deep Forest Green
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
          tabColor: color(30, 58, 47),
        },
        fields: 'index,gridProperties.hideGridlines,gridProperties.rowCount,gridProperties.columnCount,tabColor',
      },
    });
  }

  // Atur urutan tab
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

  // 4. Bersihkan total isi sheet Dashboard & _DashboardData
  console.log('🧹 Membersihkan seluruh teks lama di sheet Dashboard...');
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: 'Dashboard!A1:Z60',
  });
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: '_DashboardData!A1:Z60',
  });

  // Cat seluruh kanvas Dashboard dengan Soft Slate (#F1F5F9)
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: { sheetId: dashId, startRowIndex: 0, endRowIndex: 48, startColumnIndex: 0, endColumnIndex: 16 },
            cell: {
              userEnteredFormat: {
                backgroundColor: color(241, 245, 249), // #F1F5F9
              },
            },
            fields: 'userEnteredFormat.backgroundColor',
          },
        },
      ],
    },
  });

  // 5. Tulis Sumber Data Perhitungan Dinamis ke `_DashboardData`
  // Di sini letak kuncinya: Semua query membaca filter dari Dashboard (D5: Tahun, G5: Bulan, M5: Kategori)!
  console.log('📊 Menulis seluruh formula kalkulasi dinamis ke `_DashboardData`...');
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: '_DashboardData!A1:N20',
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [
        // Baris 1: Header
        ['Kategori', 'Total Nominal', '', 'Tahun', 'Pemasukan', 'Pengeluaran', '', 'Bulan', 'Pemasukan', 'Pengeluaran'],
        // Baris 2: Query Kategori Pengeluaran (Dinamis sesuai filter Tahun & Bulan & Kategori di Dashboard)
        [
          '=IFERROR(QUERY(Kas!A2:D, "select C, sum(D) where B contains \'Pengeluaran\' and C is not null " & IF(Dashboard!D5="Semua Tahun", "", "and A contains \'" & Dashboard!D5 & "\' ") & IF(Dashboard!G5="Semua Bulan", "", "and A contains \'-" & LEFT(Dashboard!G5,2) & "-\' ") & IF(Dashboard!M5="Semua Kategori", "", "and C contains \'" & Dashboard!M5 & "\' ") & "group by C order by sum(D) desc label C \'\', sum(D) \'\'", 0), {"Belum Ada Data", 0})',
          '',
          '',
          // Arus Kas Tahunan (D2:F2 -> 2024)
          '2024',
          '=SUMIFS(Kas!D:D, Kas!B:B, "*Pemasukan*", Kas!A:A, "*2024*", Kas!C:C, IF(Dashboard!M5="Semua Kategori", "*", "*"&Dashboard!M5&"*"))',
          '=SUMIFS(Kas!D:D, Kas!B:B, "*Pengeluaran*", Kas!A:A, "*2024*", Kas!C:C, IF(Dashboard!M5="Semua Kategori", "*", "*"&Dashboard!M5&"*"))',
          '',
          // Arus Kas Bulanan (H2:J2 -> Jan)
          'Jan',
          '=SUMIFS(Kas!D:D, Kas!B:B, "*Pemasukan*", Kas!A:A, IF(Dashboard!D5="Semua Tahun", "*", "*"&Dashboard!D5&"*"), Kas!A:A, "*-01-*", Kas!C:C, IF(Dashboard!M5="Semua Kategori", "*", "*"&Dashboard!M5&"*"))',
          '=SUMIFS(Kas!D:D, Kas!B:B, "*Pengeluaran*", Kas!A:A, IF(Dashboard!D5="Semua Tahun", "*", "*"&Dashboard!D5&"*"), Kas!A:A, "*-01-*", Kas!C:C, IF(Dashboard!M5="Semua Kategori", "*", "*"&Dashboard!M5&"*"))',
        ],
        // Baris 3: 2025, Feb
        [
          '', '', '',
          '2025',
          '=SUMIFS(Kas!D:D, Kas!B:B, "*Pemasukan*", Kas!A:A, "*2025*", Kas!C:C, IF(Dashboard!M5="Semua Kategori", "*", "*"&Dashboard!M5&"*"))',
          '=SUMIFS(Kas!D:D, Kas!B:B, "*Pengeluaran*", Kas!A:A, "*2025*", Kas!C:C, IF(Dashboard!M5="Semua Kategori", "*", "*"&Dashboard!M5&"*"))',
          '',
          'Feb',
          '=SUMIFS(Kas!D:D, Kas!B:B, "*Pemasukan*", Kas!A:A, IF(Dashboard!D5="Semua Tahun", "*", "*"&Dashboard!D5&"*"), Kas!A:A, "*-02-*", Kas!C:C, IF(Dashboard!M5="Semua Kategori", "*", "*"&Dashboard!M5&"*"))',
          '=SUMIFS(Kas!D:D, Kas!B:B, "*Pengeluaran*", Kas!A:A, IF(Dashboard!D5="Semua Tahun", "*", "*"&Dashboard!D5&"*"), Kas!A:A, "*-02-*", Kas!C:C, IF(Dashboard!M5="Semua Kategori", "*", "*"&Dashboard!M5&"*"))',
        ],
        // Baris 4: 2026, Mar
        [
          '', '', '',
          '2026',
          '=SUMIFS(Kas!D:D, Kas!B:B, "*Pemasukan*", Kas!A:A, "*2026*", Kas!C:C, IF(Dashboard!M5="Semua Kategori", "*", "*"&Dashboard!M5&"*"))',
          '=SUMIFS(Kas!D:D, Kas!B:B, "*Pengeluaran*", Kas!A:A, "*2026*", Kas!C:C, IF(Dashboard!M5="Semua Kategori", "*", "*"&Dashboard!M5&"*"))',
          '',
          'Mar',
          '=SUMIFS(Kas!D:D, Kas!B:B, "*Pemasukan*", Kas!A:A, IF(Dashboard!D5="Semua Tahun", "*", "*"&Dashboard!D5&"*"), Kas!A:A, "*-03-*", Kas!C:C, IF(Dashboard!M5="Semua Kategori", "*", "*"&Dashboard!M5&"*"))',
          '=SUMIFS(Kas!D:D, Kas!B:B, "*Pengeluaran*", Kas!A:A, IF(Dashboard!D5="Semua Tahun", "*", "*"&Dashboard!D5&"*"), Kas!A:A, "*-03-*", Kas!C:C, IF(Dashboard!M5="Semua Kategori", "*", "*"&Dashboard!M5&"*"))',
        ],
        // Baris 5: Apr
        ['', '', '', '', '', '', '', 'Apr', '=SUMIFS(Kas!D:D, Kas!B:B, "*Pemasukan*", Kas!A:A, IF(Dashboard!D5="Semua Tahun", "*", "*"&Dashboard!D5&"*"), Kas!A:A, "*-04-*", Kas!C:C, IF(Dashboard!M5="Semua Kategori", "*", "*"&Dashboard!M5&"*"))', '=SUMIFS(Kas!D:D, Kas!B:B, "*Pengeluaran*", Kas!A:A, IF(Dashboard!D5="Semua Tahun", "*", "*"&Dashboard!D5&"*"), Kas!A:A, "*-04-*", Kas!C:C, IF(Dashboard!M5="Semua Kategori", "*", "*"&Dashboard!M5&"*"))'],
        // Baris 6: Mei
        ['', '', '', '', '', '', '', 'Mei', '=SUMIFS(Kas!D:D, Kas!B:B, "*Pemasukan*", Kas!A:A, IF(Dashboard!D5="Semua Tahun", "*", "*"&Dashboard!D5&"*"), Kas!A:A, "*-05-*", Kas!C:C, IF(Dashboard!M5="Semua Kategori", "*", "*"&Dashboard!M5&"*"))', '=SUMIFS(Kas!D:D, Kas!B:B, "*Pengeluaran*", Kas!A:A, IF(Dashboard!D5="Semua Tahun", "*", "*"&Dashboard!D5&"*"), Kas!A:A, "*-05-*", Kas!C:C, IF(Dashboard!M5="Semua Kategori", "*", "*"&Dashboard!M5&"*"))'],
        // Baris 7: Jun
        ['', '', '', '', '', '', '', 'Jun', '=SUMIFS(Kas!D:D, Kas!B:B, "*Pemasukan*", Kas!A:A, IF(Dashboard!D5="Semua Tahun", "*", "*"&Dashboard!D5&"*"), Kas!A:A, "*-06-*", Kas!C:C, IF(Dashboard!M5="Semua Kategori", "*", "*"&Dashboard!M5&"*"))', '=SUMIFS(Kas!D:D, Kas!B:B, "*Pengeluaran*", Kas!A:A, IF(Dashboard!D5="Semua Tahun", "*", "*"&Dashboard!D5&"*"), Kas!A:A, "*-06-*", Kas!C:C, IF(Dashboard!M5="Semua Kategori", "*", "*"&Dashboard!M5&"*"))'],
        // Baris 8: Jul
        ['', '', '', '', '', '', '', 'Jul', '=SUMIFS(Kas!D:D, Kas!B:B, "*Pemasukan*", Kas!A:A, IF(Dashboard!D5="Semua Tahun", "*", "*"&Dashboard!D5&"*"), Kas!A:A, "*-07-*", Kas!C:C, IF(Dashboard!M5="Semua Kategori", "*", "*"&Dashboard!M5&"*"))', '=SUMIFS(Kas!D:D, Kas!B:B, "*Pengeluaran*", Kas!A:A, IF(Dashboard!D5="Semua Tahun", "*", "*"&Dashboard!D5&"*"), Kas!A:A, "*-07-*", Kas!C:C, IF(Dashboard!M5="Semua Kategori", "*", "*"&Dashboard!M5&"*"))'],
        // Baris 9: Agt
        ['', '', '', '', '', '', '', 'Agt', '=SUMIFS(Kas!D:D, Kas!B:B, "*Pemasukan*", Kas!A:A, IF(Dashboard!D5="Semua Tahun", "*", "*"&Dashboard!D5&"*"), Kas!A:A, "*-08-*", Kas!C:C, IF(Dashboard!M5="Semua Kategori", "*", "*"&Dashboard!M5&"*"))', '=SUMIFS(Kas!D:D, Kas!B:B, "*Pengeluaran*", Kas!A:A, IF(Dashboard!D5="Semua Tahun", "*", "*"&Dashboard!D5&"*"), Kas!A:A, "*-08-*", Kas!C:C, IF(Dashboard!M5="Semua Kategori", "*", "*"&Dashboard!M5&"*"))'],
        // Baris 10: Sep
        ['', '', '', '', '', '', '', 'Sep', '=SUMIFS(Kas!D:D, Kas!B:B, "*Pemasukan*", Kas!A:A, IF(Dashboard!D5="Semua Tahun", "*", "*"&Dashboard!D5&"*"), Kas!A:A, "*-09-*", Kas!C:C, IF(Dashboard!M5="Semua Kategori", "*", "*"&Dashboard!M5&"*"))', '=SUMIFS(Kas!D:D, Kas!B:B, "*Pengeluaran*", Kas!A:A, IF(Dashboard!D5="Semua Tahun", "*", "*"&Dashboard!D5&"*"), Kas!A:A, "*-09-*", Kas!C:C, IF(Dashboard!M5="Semua Kategori", "*", "*"&Dashboard!M5&"*"))'],
        // Baris 11: Okt
        ['', '', '', '', '', '', '', 'Okt', '=SUMIFS(Kas!D:D, Kas!B:B, "*Pemasukan*", Kas!A:A, IF(Dashboard!D5="Semua Tahun", "*", "*"&Dashboard!D5&"*"), Kas!A:A, "*-10-*", Kas!C:C, IF(Dashboard!M5="Semua Kategori", "*", "*"&Dashboard!M5&"*"))', '=SUMIFS(Kas!D:D, Kas!B:B, "*Pengeluaran*", Kas!A:A, IF(Dashboard!D5="Semua Tahun", "*", "*"&Dashboard!D5&"*"), Kas!A:A, "*-10-*", Kas!C:C, IF(Dashboard!M5="Semua Kategori", "*", "*"&Dashboard!M5&"*"))'],
        // Baris 12: Nov
        ['', '', '', '', '', '', '', 'Nov', '=SUMIFS(Kas!D:D, Kas!B:B, "*Pemasukan*", Kas!A:A, IF(Dashboard!D5="Semua Tahun", "*", "*"&Dashboard!D5&"*"), Kas!A:A, "*-11-*", Kas!C:C, IF(Dashboard!M5="Semua Kategori", "*", "*"&Dashboard!M5&"*"))', '=SUMIFS(Kas!D:D, Kas!B:B, "*Pengeluaran*", Kas!A:A, IF(Dashboard!D5="Semua Tahun", "*", "*"&Dashboard!D5&"*"), Kas!A:A, "*-11-*", Kas!C:C, IF(Dashboard!M5="Semua Kategori", "*", "*"&Dashboard!M5&"*"))'],
        // Baris 13: Des
        ['', '', '', '', '', '', '', 'Des', '=SUMIFS(Kas!D:D, Kas!B:B, "*Pemasukan*", Kas!A:A, IF(Dashboard!D5="Semua Tahun", "*", "*"&Dashboard!D5&"*"), Kas!A:A, "*-12-*", Kas!C:C, IF(Dashboard!M5="Semua Kategori", "*", "*"&Dashboard!M5&"*"))', '=SUMIFS(Kas!D:D, Kas!B:B, "*Pengeluaran*", Kas!A:A, IF(Dashboard!D5="Semua Tahun", "*", "*"&Dashboard!D5&"*"), Kas!A:A, "*-12-*", Kas!C:C, IF(Dashboard!M5="Semua Kategori", "*", "*"&Dashboard!M5&"*"))'],
      ],
    },
  });

  // 6. Tulis Teks, Label & Formula Interaktif di Dashboard
  console.log('✨ Menulis Struktur UI Dashboard & Filter Control Slicer...');
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'Dashboard!A1:P45',
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [
        // Baris 1: Margin atas
        [],
        // Baris 2: Header Utama (Deep Green Banner)
        ['', '🏛️ PERSONAL & EXECUTIVE FINANCIAL DASHBOARD'],
        // Baris 3: Subtitle Banner
        ['', 'Realtime Sync Bot Telegram • Executive Budget, Cashflow & Member Management'],
        // Baris 4: Spacer
        [],
        // Baris 5: TOOLBAR FILTER SLICER
        // B5: Label, C5: Label Tahun, D5: Dropdown Tahun, E5: Label Bulan, F5: Label Bulan, G5: Dropdown Bulan,
        // H5: Spacer, I5: Label Sumber, J5: Dropdown Sumber, K5: Spacer, L5: Label Kategori, M5: Dropdown Kategori, N5:O5: Helper
        [
          '',
          '🎯 FILTER:',
          'Tahun:',
          'Semua Tahun',
          '',
          'Bulan:',
          'Semua Bulan',
          '',
          'Sumber:',
          'Semua Kas',
          '',
          'Kategori:',
          'Semua Kategori',
          '⚡ Realtime Filter Otomatis',
        ],
        // Baris 6: Spacer
        [],
        // Baris 7: Judul 5 Kartu Scorecard KPI (B7, E7, H7, K7, N7)
        ['', '💳 SALDO KAS BERSIH', '', '', '📈 TOTAL PEMASUKAN', '', '', '📉 TOTAL PENGELUARAN', '', '', '👥 KAS ANGGOTA LUNAS', '', '', '🎯 RASIO TABUNGAN'],
        // Baris 8: Nilai 5 Kartu Scorecard KPI (Formula Dinamis merespons D5, G5, M5)
        [
          '',
          // Saldo Kas Bersih (B8) = Pemasukan - Pengeluaran
          '=SUMIFS(Kas!D:D, Kas!B:B, "*Pemasukan*", Kas!A:A, IF(D5="Semua Tahun", "*", "*"&D5&"*"), Kas!A:A, IF(G5="Semua Bulan", "*", "*-"&LEFT(G5,2)&"-*"), Kas!C:C, IF(M5="Semua Kategori", "*", "*"&M5&"*")) - SUMIFS(Kas!D:D, Kas!B:B, "*Pengeluaran*", Kas!A:A, IF(D5="Semua Tahun", "*", "*"&D5&"*"), Kas!A:A, IF(G5="Semua Bulan", "*", "*-"&LEFT(G5,2)&"-*"), Kas!C:C, IF(M5="Semua Kategori", "*", "*"&M5&"*"))',
          '',
          '',
          // Total Pemasukan (E8)
          '=SUMIFS(Kas!D:D, Kas!B:B, "*Pemasukan*", Kas!A:A, IF(D5="Semua Tahun", "*", "*"&D5&"*"), Kas!A:A, IF(G5="Semua Bulan", "*", "*-"&LEFT(G5,2)&"-*"), Kas!C:C, IF(M5="Semua Kategori", "*", "*"&M5&"*"))',
          '',
          '',
          // Total Pengeluaran (H8)
          '=SUMIFS(Kas!D:D, Kas!B:B, "*Pengeluaran*", Kas!A:A, IF(D5="Semua Tahun", "*", "*"&D5&"*"), Kas!A:A, IF(G5="Semua Bulan", "*", "*-"&LEFT(G5,2)&"-*"), Kas!C:C, IF(M5="Semua Kategori", "*", "*"&M5&"*"))',
          '',
          '',
          // Iuran Kas Anggota Terkumpul (K8)
          '=SUMIF(Kas_Anggota!F2:F, "Lunas", Kas_Anggota!D2:D)',
          '',
          '',
          // Rasio Tabungan / Surplus Rate (N8)
          '=IF(E8>0, (E8-H8)/E8, 0)',
        ],
        // Baris 9: Subtext 5 Kartu Scorecard KPI
        [
          '',
          '=IF(B8>=0, "🟢 Surplus Kas Aman", "🔴 Defisit Keuangan")',
          '',
          '',
          'Inflow Kas Terdata',
          '',
          '',
          'Outflow / Belanja',
          '',
          '',
          '=COUNTIF(Kas_Anggota!F2:F, "Lunas") & " Pembayaran Selesai"',
          '',
          '',
          '=IF(B8>=0, "Pertumbuhan Dana Sehat", "Evaluasi Anggaran")',
        ],
        // Baris 10: Spacer
        [],
        // Baris 11: Header Widget Baris Atas (B11: Donut Chart, H11: Monthly Chart)
        ['', '🍩 DISTRIBUSI PENGELUARAN PER KATEGORI', '', '', '', '', '', '📊 ARUS KAS BULANAN (PEMASUKAN VS PENGELUARAN)'],
        // Baris 12 - 27: Spacer untuk area chart atas
        [], [], [], [], [], [], [], [], [], [], [], [], [], [], [], [],
        // Baris 28: Spacer
        [],
        // Baris 29: Header Widget Baris Bawah (B29: Annual Chart, H29: Top 5 Breakdown)
        ['', '📈 PERBANDINGAN ARUS KAS TAHUNAN (2024 - 2026)', '', '', '', '', '', '🏆 TOP 5 PENGELUARAN & INDIKATOR KAS'],
        // Baris 30: Subheader Tabel Top 5 di Widget Kanan Bawah
        ['', '', '', '', '', '', '', '', 'Kategori Belanja', 'Total Nominal', 'Porsi', '', 'Indikator Operasional', 'Status / Nilai'],
        // Baris 31: Data Rank 1
        ['', '', '', '', '', '', '', '', '=_DashboardData!A2', '=_DashboardData!B2', '=IFERROR(_DashboardData!B2 / $H$8, 0)', '', 'Total Transaksi:', '=COUNTA(Kas!A2:A)-1 & " Transaksi"'],
        // Baris 32: Data Rank 2
        ['', '', '', '', '', '', '', '', '=_DashboardData!A3', '=_DashboardData!B3', '=IFERROR(_DashboardData!B3 / $H$8, 0)', '', 'Rata-rata Belanja:', '=IFERROR(AVERAGEIFS(Kas!D2:D, Kas!B2:B, "*Pengeluaran*", Kas!A2:A, IF(D5="Semua Tahun", "*", "*"&D5&"*")), 0)'],
        // Baris 33: Data Rank 3
        ['', '', '', '', '', '', '', '', '=_DashboardData!A4', '=_DashboardData!B4', '=IFERROR(_DashboardData!B4 / $H$8, 0)', '', 'Kepatuhan Iuran:', '=IFERROR(COUNTIF(Kas_Anggota!F2:F, "Lunas") / COUNTA(Kas_Anggota!F2:F), 0)'],
        // Baris 34: Data Rank 4
        ['', '', '', '', '', '', '', '', '=_DashboardData!A5', '=_DashboardData!B5', '=IFERROR(_DashboardData!B5 / $H$8, 0)', '', 'Anggota Terdaftar:', '=COUNTIF(Anggota!D2:D, "Aktif") & " Anggota Aktif"'],
        // Baris 35: Data Rank 5
        ['', '', '', '', '', '', '', '', '=_DashboardData!A6', '=_DashboardData!B6', '=IFERROR(_DashboardData!B6 / $H$8, 0)', '', 'Status Buku Kas:', '=Kas!A1 & " (Sync Live)"'],
      ],
    },
  });

  // 7. Styling Visual, Merges, Data Validation Dropdown, dan Pemasangan Chart
  console.log('🎨 Menerapkan Styling Kartu UI, Data Validation Dropdowns & 3 Chart...');

  const borderCard = {
    style: 'SOLID',
    width: 1,
    color: color(226, 232, 240), // Slate 200
  };
  const borderFilter = {
    style: 'SOLID',
    width: 1,
    color: color(148, 163, 184), // Slate 400
  };

  const uiRequests: any[] = [
    // Kolom Grid (Total 16 Kolom)
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 25 }, fields: 'pixelSize' } }, // A (margin)
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 110 }, fields: 'pixelSize' } }, // B
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 2, endIndex: 3 }, properties: { pixelSize: 110 }, fields: 'pixelSize' } }, // C (Card 1: 220px)
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 3, endIndex: 4 }, properties: { pixelSize: 20 }, fields: 'pixelSize' } },  // D spacer
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 4, endIndex: 5 }, properties: { pixelSize: 110 }, fields: 'pixelSize' } }, // E
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 5, endIndex: 6 }, properties: { pixelSize: 110 }, fields: 'pixelSize' } }, // F (Card 2: 220px)
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 6, endIndex: 7 }, properties: { pixelSize: 20 }, fields: 'pixelSize' } },  // G spacer
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 7, endIndex: 8 }, properties: { pixelSize: 110 }, fields: 'pixelSize' } }, // H
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 8, endIndex: 9 }, properties: { pixelSize: 110 }, fields: 'pixelSize' } }, // I (Card 3: 220px)
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 9, endIndex: 10 }, properties: { pixelSize: 20 }, fields: 'pixelSize' } }, // J spacer
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 10, endIndex: 11 }, properties: { pixelSize: 110 }, fields: 'pixelSize' } }, // K
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 11, endIndex: 12 }, properties: { pixelSize: 110 }, fields: 'pixelSize' } }, // L (Card 4: 220px)
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 12, endIndex: 13 }, properties: { pixelSize: 20 }, fields: 'pixelSize' } }, // M spacer
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 13, endIndex: 14 }, properties: { pixelSize: 110 }, fields: 'pixelSize' } }, // N
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 14, endIndex: 15 }, properties: { pixelSize: 110 }, fields: 'pixelSize' } }, // O (Card 5: 220px)
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 15, endIndex: 16 }, properties: { pixelSize: 25 }, fields: 'pixelSize' } }, // P (margin)

    // Tinggi Baris
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'ROWS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 42 }, fields: 'pixelSize' } }, // Baris 2 Banner Header
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'ROWS', startIndex: 2, endIndex: 3 }, properties: { pixelSize: 24 }, fields: 'pixelSize' } }, // Baris 3 Subtitle
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'ROWS', startIndex: 3, endIndex: 4 }, properties: { pixelSize: 10 }, fields: 'pixelSize' } }, // Baris 4 Spacer
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'ROWS', startIndex: 4, endIndex: 5 }, properties: { pixelSize: 40 }, fields: 'pixelSize' } }, // Baris 5 Slicer Filter Card
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'ROWS', startIndex: 5, endIndex: 6 }, properties: { pixelSize: 14 }, fields: 'pixelSize' } }, // Baris 6 Spacer
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'ROWS', startIndex: 6, endIndex: 7 }, properties: { pixelSize: 26 }, fields: 'pixelSize' } }, // Baris 7 KPI Title
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'ROWS', startIndex: 7, endIndex: 8 }, properties: { pixelSize: 38 }, fields: 'pixelSize' } }, // Baris 8 KPI Value
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'ROWS', startIndex: 8, endIndex: 9 }, properties: { pixelSize: 24 }, fields: 'pixelSize' } }, // Baris 9 KPI Subtext
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'ROWS', startIndex: 9, endIndex: 10 }, properties: { pixelSize: 16 }, fields: 'pixelSize' } }, // Baris 10 Spacer
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'ROWS', startIndex: 10, endIndex: 11 }, properties: { pixelSize: 34 }, fields: 'pixelSize' } }, // Baris 11 Top Widget Header
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'ROWS', startIndex: 27, endIndex: 28 }, properties: { pixelSize: 16 }, fields: 'pixelSize' } }, // Baris 28 Spacer
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'ROWS', startIndex: 28, endIndex: 29 }, properties: { pixelSize: 34 }, fields: 'pixelSize' } }, // Baris 29 Bottom Widget Header

    // Merges:
    // Header Banner (B2:O2 dan B3:O3)
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 1, endColumnIndex: 15 }, mergeType: 'MERGE_ALL' } },
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 1, endColumnIndex: 15 }, mergeType: 'MERGE_ALL' } },

    // Helper text di kanan filter bar (N5:O5)
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 13, endColumnIndex: 15 }, mergeType: 'MERGE_ALL' } },

    // 5 KPI Cards (B7:C9, E7:F9, H7:I9, K7:L9, N7:O9)
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 6, endRowIndex: 7, startColumnIndex: 1, endColumnIndex: 3 }, mergeType: 'MERGE_ALL' } },
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 7, endRowIndex: 8, startColumnIndex: 1, endColumnIndex: 3 }, mergeType: 'MERGE_ALL' } },
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 8, endRowIndex: 9, startColumnIndex: 1, endColumnIndex: 3 }, mergeType: 'MERGE_ALL' } },

    { mergeCells: { range: { sheetId: dashId, startRowIndex: 6, endRowIndex: 7, startColumnIndex: 4, endColumnIndex: 6 }, mergeType: 'MERGE_ALL' } },
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 7, endRowIndex: 8, startColumnIndex: 4, endColumnIndex: 6 }, mergeType: 'MERGE_ALL' } },
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 8, endRowIndex: 9, startColumnIndex: 4, endColumnIndex: 6 }, mergeType: 'MERGE_ALL' } },

    { mergeCells: { range: { sheetId: dashId, startRowIndex: 6, endRowIndex: 7, startColumnIndex: 7, endColumnIndex: 9 }, mergeType: 'MERGE_ALL' } },
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 7, endRowIndex: 8, startColumnIndex: 7, endColumnIndex: 9 }, mergeType: 'MERGE_ALL' } },
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 8, endRowIndex: 9, startColumnIndex: 7, endColumnIndex: 9 }, mergeType: 'MERGE_ALL' } },

    { mergeCells: { range: { sheetId: dashId, startRowIndex: 6, endRowIndex: 7, startColumnIndex: 10, endColumnIndex: 12 }, mergeType: 'MERGE_ALL' } },
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 7, endRowIndex: 8, startColumnIndex: 10, endColumnIndex: 12 }, mergeType: 'MERGE_ALL' } },
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 8, endRowIndex: 9, startColumnIndex: 10, endColumnIndex: 12 }, mergeType: 'MERGE_ALL' } },

    { mergeCells: { range: { sheetId: dashId, startRowIndex: 6, endRowIndex: 7, startColumnIndex: 13, endColumnIndex: 15 }, mergeType: 'MERGE_ALL' } },
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 7, endRowIndex: 8, startColumnIndex: 13, endColumnIndex: 15 }, mergeType: 'MERGE_ALL' } },
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 8, endRowIndex: 9, startColumnIndex: 13, endColumnIndex: 15 }, mergeType: 'MERGE_ALL' } },

    // Widget Containers Merges
    // Widget 1 Header (B11:G11) & Widget 2 Header (H11:O11)
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 10, endRowIndex: 11, startColumnIndex: 1, endColumnIndex: 7 }, mergeType: 'MERGE_ALL' } },
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 10, endRowIndex: 11, startColumnIndex: 7, endColumnIndex: 15 }, mergeType: 'MERGE_ALL' } },
    // Widget 3 Header (B29:G29) & Widget 4 Header (H29:O29)
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 28, endRowIndex: 29, startColumnIndex: 1, endColumnIndex: 7 }, mergeType: 'MERGE_ALL' } },
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 28, endRowIndex: 29, startColumnIndex: 7, endColumnIndex: 15 }, mergeType: 'MERGE_ALL' } },

    // Merge Status / Nilai di tabel Top 5 (M31:N31 dll)
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 29, endRowIndex: 30, startColumnIndex: 13, endColumnIndex: 15 }, mergeType: 'MERGE_ALL' } },
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 30, endRowIndex: 31, startColumnIndex: 13, endColumnIndex: 15 }, mergeType: 'MERGE_ALL' } },
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 31, endRowIndex: 32, startColumnIndex: 13, endColumnIndex: 15 }, mergeType: 'MERGE_ALL' } },
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 32, endRowIndex: 33, startColumnIndex: 13, endColumnIndex: 15 }, mergeType: 'MERGE_ALL' } },
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 33, endRowIndex: 34, startColumnIndex: 13, endColumnIndex: 15 }, mergeType: 'MERGE_ALL' } },
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 34, endRowIndex: 35, startColumnIndex: 13, endColumnIndex: 15 }, mergeType: 'MERGE_ALL' } },

    // 🎨 Styling Deep Green Header Banner (B2:O3)
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 1, endColumnIndex: 15 },
        cell: {
          userEnteredFormat: {
            backgroundColor: color(30, 58, 47), // #1E3A2F (Deep Forest Green)
            textFormat: { foregroundColor: color(255, 255, 255), bold: true, fontSize: 16 },
            verticalAlignment: 'MIDDLE',
            horizontalAlignment: 'LEFT',
            padding: { left: 16 },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,horizontalAlignment,padding)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 1, endColumnIndex: 15 },
        cell: {
          userEnteredFormat: {
            backgroundColor: color(30, 58, 47),
            textFormat: { foregroundColor: color(167, 243, 208), fontSize: 9 }, // Soft Mint
            verticalAlignment: 'TOP',
            horizontalAlignment: 'LEFT',
            padding: { left: 16 },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,horizontalAlignment,padding)',
      },
    },

    // 🎨 Styling Filter Slicer Bar Container (B5:O5)
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 1, endColumnIndex: 15 },
        cell: {
          userEnteredFormat: {
            backgroundColor: color(255, 255, 255),
            borders: { top: borderCard, bottom: borderCard, left: borderCard, right: borderCard },
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,borders,verticalAlignment)',
      },
    },
    // B5: Label FILTER:
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 1, endColumnIndex: 2 },
        cell: {
          userEnteredFormat: {
            textFormat: { foregroundColor: color(30, 58, 47), bold: true, fontSize: 9 },
            horizontalAlignment: 'CENTER',
          },
        },
        fields: 'userEnteredFormat(textFormat,horizontalAlignment)',
      },
    },
    // C5: Label Tahun:
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 2, endColumnIndex: 3 },
        cell: {
          userEnteredFormat: {
            textFormat: { foregroundColor: color(100, 116, 139), bold: true, fontSize: 9 },
            horizontalAlignment: 'RIGHT',
          },
        },
        fields: 'userEnteredFormat(textFormat,horizontalAlignment)',
      },
    },
    // D5: Dropdown Tahun (Input Box Style)
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 3, endColumnIndex: 4 },
        cell: {
          userEnteredFormat: {
            backgroundColor: color(248, 250, 252),
            borders: { top: borderFilter, bottom: borderFilter, left: borderFilter, right: borderFilter },
            textFormat: { foregroundColor: color(15, 23, 42), bold: true, fontSize: 9 },
            horizontalAlignment: 'CENTER',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,borders,textFormat,horizontalAlignment)',
      },
    },
    // F5: Label Bulan:
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 5, endColumnIndex: 6 },
        cell: {
          userEnteredFormat: {
            textFormat: { foregroundColor: color(100, 116, 139), bold: true, fontSize: 9 },
            horizontalAlignment: 'RIGHT',
          },
        },
        fields: 'userEnteredFormat(textFormat,horizontalAlignment)',
      },
    },
    // G5: Dropdown Bulan (Input Box Style)
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 6, endColumnIndex: 7 },
        cell: {
          userEnteredFormat: {
            backgroundColor: color(248, 250, 252),
            borders: { top: borderFilter, bottom: borderFilter, left: borderFilter, right: borderFilter },
            textFormat: { foregroundColor: color(15, 23, 42), bold: true, fontSize: 9 },
            horizontalAlignment: 'CENTER',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,borders,textFormat,horizontalAlignment)',
      },
    },
    // I5: Label Sumber:
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 8, endColumnIndex: 9 },
        cell: {
          userEnteredFormat: {
            textFormat: { foregroundColor: color(100, 116, 139), bold: true, fontSize: 9 },
            horizontalAlignment: 'RIGHT',
          },
        },
        fields: 'userEnteredFormat(textFormat,horizontalAlignment)',
      },
    },
    // J5: Dropdown Sumber (Input Box Style)
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 9, endColumnIndex: 10 },
        cell: {
          userEnteredFormat: {
            backgroundColor: color(248, 250, 252),
            borders: { top: borderFilter, bottom: borderFilter, left: borderFilter, right: borderFilter },
            textFormat: { foregroundColor: color(15, 23, 42), bold: true, fontSize: 9 },
            horizontalAlignment: 'CENTER',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,borders,textFormat,horizontalAlignment)',
      },
    },
    // L5: Label Kategori:
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 11, endColumnIndex: 12 },
        cell: {
          userEnteredFormat: {
            textFormat: { foregroundColor: color(100, 116, 139), bold: true, fontSize: 9 },
            horizontalAlignment: 'RIGHT',
          },
        },
        fields: 'userEnteredFormat(textFormat,horizontalAlignment)',
      },
    },
    // M5: Dropdown Kategori (Input Box Style)
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 12, endColumnIndex: 13 },
        cell: {
          userEnteredFormat: {
            backgroundColor: color(248, 250, 252),
            borders: { top: borderFilter, bottom: borderFilter, left: borderFilter, right: borderFilter },
            textFormat: { foregroundColor: color(15, 23, 42), bold: true, fontSize: 9 },
            horizontalAlignment: 'CENTER',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,borders,textFormat,horizontalAlignment)',
      },
    },
    // N5:O5 Helper Info
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 13, endColumnIndex: 15 },
        cell: {
          userEnteredFormat: {
            textFormat: { foregroundColor: color(13, 148, 136), italic: true, fontSize: 8 },
            horizontalAlignment: 'CENTER',
          },
        },
        fields: 'userEnteredFormat(textFormat,horizontalAlignment)',
      },
    },

    // 🎯 DATA VALIDATION (Dropdown Panah Pilihan Nyata di Sel):
    // 1. Dropdown Tahun di D5
    {
      setDataValidation: {
        range: { sheetId: dashId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 3, endColumnIndex: 4 },
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
          strict: false,
        },
      },
    },
    // 2. Dropdown Bulan di G5
    {
      setDataValidation: {
        range: { sheetId: dashId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 6, endColumnIndex: 7 },
        rule: {
          condition: {
            type: 'ONE_OF_LIST',
            values: [
              { userEnteredValue: 'Semua Bulan' },
              { userEnteredValue: '01 - Jan' },
              { userEnteredValue: '02 - Feb' },
              { userEnteredValue: '03 - Mar' },
              { userEnteredValue: '04 - Apr' },
              { userEnteredValue: '05 - Mei' },
              { userEnteredValue: '06 - Jun' },
              { userEnteredValue: '07 - Jul' },
              { userEnteredValue: '08 - Agt' },
              { userEnteredValue: '09 - Sep' },
              { userEnteredValue: '10 - Okt' },
              { userEnteredValue: '11 - Nov' },
              { userEnteredValue: '12 - Des' },
            ],
          },
          showCustomUi: true,
          strict: false,
        },
      },
    },
    // 3. Dropdown Sumber di J5
    {
      setDataValidation: {
        range: { sheetId: dashId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 9, endColumnIndex: 10 },
        rule: {
          condition: {
            type: 'ONE_OF_LIST',
            values: [
              { userEnteredValue: 'Semua Kas' },
              { userEnteredValue: 'Kas Utama' },
              { userEnteredValue: 'Kas Anggota' },
            ],
          },
          showCustomUi: true,
          strict: false,
        },
      },
    },
    // 4. Dropdown Kategori di M5
    {
      setDataValidation: {
        range: { sheetId: dashId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 12, endColumnIndex: 13 },
        rule: {
          condition: {
            type: 'ONE_OF_LIST',
            values: [
              { userEnteredValue: 'Semua Kategori' },
              { userEnteredValue: 'Operasional' },
              { userEnteredValue: 'Konsumsi' },
              { userEnteredValue: 'Transportasi' },
              { userEnteredValue: 'Perlengkapan' },
              { userEnteredValue: 'Donasi' },
              { userEnteredValue: 'Iuran' },
              { userEnteredValue: 'Lain-lain' },
            ],
          },
          showCustomUi: true,
          strict: false,
        },
      },
    },

    // 🎨 Styling 5 KPI Scorecard Boxes:
    // Card 1: Saldo Kas (B7:C9)
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 6, endRowIndex: 9, startColumnIndex: 1, endColumnIndex: 3 },
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
        range: { sheetId: dashId, startRowIndex: 6, endRowIndex: 7, startColumnIndex: 1, endColumnIndex: 3 },
        cell: { userEnteredFormat: { textFormat: { foregroundColor: color(100, 116, 139), bold: true, fontSize: 9 } } },
        fields: 'userEnteredFormat.textFormat',
      },
    },
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 7, endRowIndex: 8, startColumnIndex: 1, endColumnIndex: 3 },
        cell: {
          userEnteredFormat: {
            textFormat: { foregroundColor: color(30, 58, 47), bold: true, fontSize: 16 },
            numberFormat: { type: 'CURRENCY', pattern: '"Rp"#,##0' },
          },
        },
        fields: 'userEnteredFormat(textFormat,numberFormat)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 8, endRowIndex: 9, startColumnIndex: 1, endColumnIndex: 3 },
        cell: { userEnteredFormat: { textFormat: { foregroundColor: color(148, 163, 184), fontSize: 8 } } },
        fields: 'userEnteredFormat.textFormat',
      },
    },

    // Card 2: Pemasukan (E7:F9)
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 6, endRowIndex: 9, startColumnIndex: 4, endColumnIndex: 6 },
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
        range: { sheetId: dashId, startRowIndex: 6, endRowIndex: 7, startColumnIndex: 4, endColumnIndex: 6 },
        cell: { userEnteredFormat: { textFormat: { foregroundColor: color(100, 116, 139), bold: true, fontSize: 9 } } },
        fields: 'userEnteredFormat.textFormat',
      },
    },
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 7, endRowIndex: 8, startColumnIndex: 4, endColumnIndex: 6 },
        cell: {
          userEnteredFormat: {
            textFormat: { foregroundColor: color(21, 128, 61), bold: true, fontSize: 16 }, // Green 700
            numberFormat: { type: 'CURRENCY', pattern: '"Rp"#,##0' },
          },
        },
        fields: 'userEnteredFormat(textFormat,numberFormat)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 8, endRowIndex: 9, startColumnIndex: 4, endColumnIndex: 6 },
        cell: { userEnteredFormat: { textFormat: { foregroundColor: color(148, 163, 184), fontSize: 8 } } },
        fields: 'userEnteredFormat.textFormat',
      },
    },

    // Card 3: Pengeluaran (H7:I9)
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 6, endRowIndex: 9, startColumnIndex: 7, endColumnIndex: 9 },
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
        range: { sheetId: dashId, startRowIndex: 6, endRowIndex: 7, startColumnIndex: 7, endColumnIndex: 9 },
        cell: { userEnteredFormat: { textFormat: { foregroundColor: color(100, 116, 139), bold: true, fontSize: 9 } } },
        fields: 'userEnteredFormat.textFormat',
      },
    },
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 7, endRowIndex: 8, startColumnIndex: 7, endColumnIndex: 9 },
        cell: {
          userEnteredFormat: {
            textFormat: { foregroundColor: color(185, 28, 28), bold: true, fontSize: 16 }, // Red 700
            numberFormat: { type: 'CURRENCY', pattern: '"Rp"#,##0' },
          },
        },
        fields: 'userEnteredFormat(textFormat,numberFormat)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 8, endRowIndex: 9, startColumnIndex: 7, endColumnIndex: 9 },
        cell: { userEnteredFormat: { textFormat: { foregroundColor: color(148, 163, 184), fontSize: 8 } } },
        fields: 'userEnteredFormat.textFormat',
      },
    },

    // Card 4: Iuran Anggota Lunas (K7:L9)
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 6, endRowIndex: 9, startColumnIndex: 10, endColumnIndex: 12 },
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
        range: { sheetId: dashId, startRowIndex: 6, endRowIndex: 7, startColumnIndex: 10, endColumnIndex: 12 },
        cell: { userEnteredFormat: { textFormat: { foregroundColor: color(100, 116, 139), bold: true, fontSize: 9 } } },
        fields: 'userEnteredFormat.textFormat',
      },
    },
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 7, endRowIndex: 8, startColumnIndex: 10, endColumnIndex: 12 },
        cell: {
          userEnteredFormat: {
            textFormat: { foregroundColor: color(15, 118, 110), bold: true, fontSize: 16 }, // Teal 700
            numberFormat: { type: 'CURRENCY', pattern: '"Rp"#,##0' },
          },
        },
        fields: 'userEnteredFormat(textFormat,numberFormat)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 8, endRowIndex: 9, startColumnIndex: 10, endColumnIndex: 12 },
        cell: { userEnteredFormat: { textFormat: { foregroundColor: color(148, 163, 184), fontSize: 8 } } },
        fields: 'userEnteredFormat.textFormat',
      },
    },

    // Card 5: Rasio Tabungan / Surplus Progress (N7:O9)
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 6, endRowIndex: 9, startColumnIndex: 13, endColumnIndex: 15 },
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
        range: { sheetId: dashId, startRowIndex: 6, endRowIndex: 7, startColumnIndex: 13, endColumnIndex: 15 },
        cell: { userEnteredFormat: { textFormat: { foregroundColor: color(100, 116, 139), bold: true, fontSize: 9 } } },
        fields: 'userEnteredFormat.textFormat',
      },
    },
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 7, endRowIndex: 8, startColumnIndex: 13, endColumnIndex: 15 },
        cell: {
          userEnteredFormat: {
            textFormat: { foregroundColor: color(5, 150, 105), bold: true, fontSize: 16 }, // Emerald 600
            numberFormat: { type: 'PERCENT', pattern: '0.0%' },
          },
        },
        fields: 'userEnteredFormat(textFormat,numberFormat)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 8, endRowIndex: 9, startColumnIndex: 13, endColumnIndex: 15 },
        cell: { userEnteredFormat: { textFormat: { foregroundColor: color(148, 163, 184), fontSize: 8 } } },
        fields: 'userEnteredFormat.textFormat',
      },
    },

    // 🎨 Styling 4 Wadah Widget Putih (B11:G27, H11:O27, B29:G45, H29:O45)
    // Widget 1 Container (B11:G27)
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 10, endRowIndex: 27, startColumnIndex: 1, endColumnIndex: 7 },
        cell: {
          userEnteredFormat: {
            backgroundColor: color(255, 255, 255),
            borders: { top: borderCard, bottom: borderCard, left: borderCard, right: borderCard },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,borders)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 10, endRowIndex: 11, startColumnIndex: 1, endColumnIndex: 7 },
        cell: {
          userEnteredFormat: {
            textFormat: { foregroundColor: color(15, 23, 42), bold: true, fontSize: 10 },
            verticalAlignment: 'MIDDLE',
            padding: { left: 14 },
          },
        },
        fields: 'userEnteredFormat(textFormat,verticalAlignment,padding)',
      },
    },

    // Widget 2 Container (H11:O27)
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 10, endRowIndex: 27, startColumnIndex: 7, endColumnIndex: 15 },
        cell: {
          userEnteredFormat: {
            backgroundColor: color(255, 255, 255),
            borders: { top: borderCard, bottom: borderCard, left: borderCard, right: borderCard },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,borders)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 10, endRowIndex: 11, startColumnIndex: 7, endColumnIndex: 15 },
        cell: {
          userEnteredFormat: {
            textFormat: { foregroundColor: color(15, 23, 42), bold: true, fontSize: 10 },
            verticalAlignment: 'MIDDLE',
            padding: { left: 14 },
          },
        },
        fields: 'userEnteredFormat(textFormat,verticalAlignment,padding)',
      },
    },

    // Widget 3 Container (B29:G45)
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
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 28, endRowIndex: 29, startColumnIndex: 1, endColumnIndex: 7 },
        cell: {
          userEnteredFormat: {
            textFormat: { foregroundColor: color(15, 23, 42), bold: true, fontSize: 10 },
            verticalAlignment: 'MIDDLE',
            padding: { left: 14 },
          },
        },
        fields: 'userEnteredFormat(textFormat,verticalAlignment,padding)',
      },
    },

    // Widget 4 Container (H29:O45)
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
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 28, endRowIndex: 29, startColumnIndex: 7, endColumnIndex: 15 },
        cell: {
          userEnteredFormat: {
            textFormat: { foregroundColor: color(15, 23, 42), bold: true, fontSize: 10 },
            verticalAlignment: 'MIDDLE',
            padding: { left: 14 },
          },
        },
        fields: 'userEnteredFormat(textFormat,verticalAlignment,padding)',
      },
    },

    // Tabel Top 5 & Indikator Kas (H30:O35)
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 29, endRowIndex: 30, startColumnIndex: 7, endColumnIndex: 15 },
        cell: {
          userEnteredFormat: {
            backgroundColor: color(248, 250, 252),
            textFormat: { foregroundColor: color(71, 85, 105), bold: true, fontSize: 8 },
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 30, endRowIndex: 35, startColumnIndex: 7, endColumnIndex: 15 },
        cell: {
          userEnteredFormat: {
            textFormat: { foregroundColor: color(15, 23, 42), fontSize: 9 },
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(textFormat,verticalAlignment)',
      },
    },
    // Format Angka Tabel Top 5
    // Nominal Belanja (Col J / Index 9)
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 30, endRowIndex: 35, startColumnIndex: 9, endColumnIndex: 10 },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: 'CURRENCY', pattern: '"Rp"#,##0' },
            textFormat: { bold: true },
            horizontalAlignment: 'RIGHT',
          },
        },
        fields: 'userEnteredFormat(numberFormat,textFormat,horizontalAlignment)',
      },
    },
    // Porsi % (Col K / Index 10)
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 30, endRowIndex: 35, startColumnIndex: 10, endColumnIndex: 11 },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: 'PERCENT', pattern: '0.0%' },
            textFormat: { foregroundColor: color(100, 116, 139) },
            horizontalAlignment: 'RIGHT',
          },
        },
        fields: 'userEnteredFormat(numberFormat,textFormat,horizontalAlignment)',
      },
    },
    // Nilai Indikator (Col N:O / Index 13:15)
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 30, endRowIndex: 35, startColumnIndex: 13, endColumnIndex: 15 },
        cell: {
          userEnteredFormat: {
            textFormat: { bold: true, foregroundColor: color(15, 118, 110) },
            horizontalAlignment: 'LEFT',
          },
        },
        fields: 'userEnteredFormat(textFormat,horizontalAlignment)',
      },
    },

    // 📊 CHART 1: DONUT CHART "Distribusi Pengeluaran per Kategori" (Wadah Kiri Atas B12:G27)
    {
      addChart: {
        chart: {
          spec: {
            title: '',
            pieChart: {
              pieHole: 0.52, // Donut Style
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
              anchorCell: { sheetId: dashId, rowIndex: 11, columnIndex: 1 },
              offsetXPixels: 10,
              offsetYPixels: 5,
              widthPixels: 490,
              heightPixels: 290,
            },
          },
        },
      },
    },

    // 📊 CHART 2: COLUMN CHART "Arus Kas Bulanan (Pemasukan vs Pengeluaran)" (Wadah Kanan Atas H12:O27)
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
                    rgbColor: color(16, 185, 129), // Emerald Inflow
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
                    rgbColor: color(239, 68, 68), // Crimson Outflow
                  },
                },
              ],
            },
          },
          position: {
            overlayPosition: {
              anchorCell: { sheetId: dashId, rowIndex: 11, columnIndex: 7 },
              offsetXPixels: 15,
              offsetYPixels: 5,
              widthPixels: 570,
              heightPixels: 290,
            },
          },
        },
      },
    },

    // 📊 CHART 3: COLUMN CHART "Perbandingan Arus Kas Tahunan" (Wadah Kiri Bawah B30:G45)
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
                    rgbColor: color(59, 130, 246), // Blue 500
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
                    rgbColor: color(249, 115, 22), // Orange 500
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

  console.log(`Mengirim ${uiRequests.length} perintah styling kartu, filter slicer & 3 chart ke Google Sheets...`);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: uiRequests },
  });

  console.log('🎉 Dashboard Interaktif Gaya Excel / Power BI Berhasil Terpasang Sempurna!');
}

run().catch((err) => {
  console.error('❌ Gagal merapikan dashboard:', err);
  process.exit(1);
});
