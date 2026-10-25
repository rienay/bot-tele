import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth';
import { getAllSheetBooks } from '../lib/googleSheets';

function getSpreadsheetId(): string {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) throw new Error('GOOGLE_SHEET_ID belum dikonfigurasi di .env.local');
  return id;
}

function color(r: number, g: number, b: number) {
  return { red: r / 255, green: g / 255, blue: b / 255 };
}

// 🌸 PALET WARNA PRESISI TEMPLATE VLOOKUPDAILY
const PALETTE = {
  canvasBg: color(248, 247, 250), // #F8F7FA (Clean Lilac Off-White)
  cardBg: color(255, 255, 255), // Pure White
  cardBorder: color(229, 223, 232), // #E5DFE8 (Ultra-fine Muted Border)
  
  // Headers
  primaryMauve: color(143, 123, 148), // #8F7B94 (VlookupDaily Dusty Mauve)
  titleText: color(46, 34, 56), // #2E2238 (Deep Plum Charcoal)
  subtitleText: color(122, 110, 133), // #7A6E85 (Slate Mauve)
  scriptQuote: color(155, 138, 158), // #9B8A9E (Script Font Accent)

  // Sidebar Filter
  sidebarHeaderBg: color(243, 239, 245), // #F3EFF5
  sidebarHeaderText: color(78, 62, 88),
  filterLabel: color(110, 98, 120),
  filterInputBg: color(250, 248, 251),
  filterInputBorder: color(218, 210, 224),
  filterInputText: color(55, 42, 65),

  // KPI Amounts
  kpiLabel: color(120, 110, 128),
  kpiSubtext: color(145, 135, 152),
  valGreen: color(30, 130, 76),
  valRose: color(195, 40, 80),
  valPlum: color(110, 45, 105),
  valTeal: color(18, 120, 130),
  valBlue: color(40, 95, 175),

  // Table
  tableHeaderBg: color(143, 123, 148), // #8F7B94
  tableHeaderText: color(255, 255, 255),
  tableSubheaderBg: color(245, 241, 247),
  tableSubheaderText: color(85, 70, 95),
  tableRowEven: color(255, 255, 255),
  tableRowOdd: color(252, 250, 253),
  tableBorder: color(232, 226, 236),
  tableTotalBg: color(245, 240, 247),
  tableTotalText: color(125, 40, 85),

  // Charts
  chartPemasukan: color(164, 194, 177),
  chartPengeluaran: color(216, 150, 178),
  tabColor: color(143, 123, 148),
};

export async function run() {
  console.log('🌸 Membangun Dashboard Keuangan Style VlookupDaily Presisi 100%...');
  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = getSpreadsheetId();

  // 1. Ambil daftar buku
  const books = await getAllSheetBooks(true);
  console.log('📚 Buku aktif:', books);

  // 2. Metadata Spreadsheet
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets(properties,charts,merges)',
  });
  const existingSheets = meta.data.sheets || [];

  let dashboardSheetId: number | null = null;
  let dataSheetId: number | null = null;

  for (const s of existingSheets) {
    const title = s.properties?.title?.toLowerCase();
    const id = s.properties?.sheetId ?? 0;
    if (title === 'dashboard') dashboardSheetId = id;
    if (title === '_dashboarddata') dataSheetId = id;
  }

  const batchRequests: any[] = [];

  // Hapus semua chart lama
  const dashSheetObj = existingSheets.find((s) => s.properties?.title?.toLowerCase() === 'dashboard');
  if (dashSheetObj?.charts && dashSheetObj.charts.length > 0) {
    for (const c of dashSheetObj.charts) {
      if (c.chartId) batchRequests.push({ deleteEmbeddedObject: { objectId: c.chartId } });
    }
  }

  // Unmerge semua merge lama
  if (dashSheetObj?.merges && dashSheetObj.merges.length > 0) {
    for (const m of dashSheetObj.merges) {
      batchRequests.push({ unmergeCells: { range: m } });
    }
  }

  // Buat sheet `_DashboardData` (hidden)
  if (dataSheetId === null) {
    const newSheetId = Math.floor(100000000 + Math.random() * 900000000);
    dataSheetId = newSheetId;
    batchRequests.push({
      addSheet: { properties: { sheetId: newSheetId, title: '_DashboardData', hidden: true } },
    });
  }

  // Konfigurasi Dashboard (Tab 0, 26 kolom A-Z, 50 baris, hideGridlines: true)
  if (dashboardSheetId === null) {
    const newDashId = 0;
    dashboardSheetId = newDashId;
    batchRequests.push({
      addSheet: {
        properties: {
          sheetId: newDashId,
          title: 'Dashboard',
          index: 0,
          gridProperties: { rowCount: 50, columnCount: 26, hideGridlines: true },
          tabColor: PALETTE.tabColor,
        },
      },
    });
  } else {
    batchRequests.push({
      updateSheetProperties: {
        properties: {
          sheetId: dashboardSheetId,
          index: 0,
          gridProperties: { rowCount: 50, columnCount: 26, hideGridlines: true },
          tabColor: PALETTE.tabColor,
        },
        fields: 'index,gridProperties.hideGridlines,gridProperties.rowCount,gridProperties.columnCount,tabColor',
      },
    });
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: batchRequests },
  });

  const dashId = dashboardSheetId!;
  const dDataId = dataSheetId!;

  // 3. SAPU BERSIH TOTAL: Hapus nilai & FORMATTING lama (menghilangkan garis pink)
  console.log('🧹 Membersihkan seluruh teks, rumus & garis kisi pink lama...');
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: 'Dashboard!A1:Z60' });
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: '_DashboardData!A1:AZ200' });

  // Reset total userEnteredFormat di Dashboard agar bersih putih
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          updateCells: {
            range: { sheetId: dashId, startRowIndex: 0, endRowIndex: 50, startColumnIndex: 0, endColumnIndex: 26 },
            fields: 'userEnteredFormat',
          },
        },
        {
          repeatCell: {
            range: { sheetId: dashId, startRowIndex: 0, endRowIndex: 50, startColumnIndex: 0, endColumnIndex: 26 },
            cell: { userEnteredFormat: { backgroundColor: PALETTE.canvasBg } },
            fields: 'userEnteredFormat.backgroundColor',
          },
        },
      ],
    },
  });

  // 4. Tulis Data Konsolidasi Multi-Buku ke `_DashboardData`
  console.log('📊 Menulis kalkulasi multi-buku ke `_DashboardData`...');
  const bookVstackParts = books.map((b) =>
    `IFERROR(FILTER(HSTACK(INDEX(IF('${b}'!A2:A<>"","${b}","")), '${b}'!A2:F), '${b}'!A2:A<>""), {"","","","","","",""})`
  );
  const vstackAllBooks = `=QUERY(VSTACK(${bookVstackParts.join(', ')}), "where Col1 <> ''", 0)`;

  // Query Kategori Pengeluaran
  const categoryQuery =
    `=IFERROR(QUERY(_DashboardData!A:G, "select D, sum(E) where C contains 'Pengeluaran' and D is not null " ` +
    `& IF(Dashboard!C6="Semua Sumber", "", "and A = '" & Dashboard!C6 & "' ") ` +
    `& IF(Dashboard!C9="Semua Tahun", "", "and B contains '" & Dashboard!C9 & "' ") ` +
    `& IF(Dashboard!C11="Semua Bulan", "", "and B contains '-" & LEFT(Dashboard!C11,2) & "-' ") ` +
    `& IF(Dashboard!C14="Semua Kategori", "", "and D = '" & Dashboard!C14 & "' ") ` +
    `& "group by D order by sum(E) desc label D '', sum(E) ''", 0), {"Belum Ada Data", 0})`;

  const months = [
    { code: '01', name: 'Jan' },
    { code: '02', name: 'Feb' },
    { code: '03', name: 'Mar' },
    { code: '04', name: 'Apr' },
    { code: '05', name: 'Mei' },
    { code: '06', name: 'Jun' },
    { code: '07', name: 'Jul' },
    { code: '08', name: 'Agt' },
    { code: '09', name: 'Sep' },
    { code: '10', name: 'Okt' },
    { code: '11', name: 'Nov' },
    { code: '12', name: 'Des' },
  ];

  const dataSheetRows: any[][] = [];
  dataSheetRows.push([
    'Buku', 'Tanggal', 'Jenis', 'Kategori', 'Nominal', 'Keterangan', 'Link Nota',
    '',
    'Kategori Belanja', 'Total Nominal',
    '',
    'Bulan', 'Pemasukan', 'Pengeluaran',
    '',
    'Nama Buku', 'Total Masuk', 'Total Keluar', 'Sisa Saldo',
  ]);

  const row2: any[] = [
    vstackAllBooks, '', '', '', '', '', '',
    '',
    categoryQuery, '',
    '',
    'Jan',
    `=SUMIFS(_DashboardData!E:E, _DashboardData!C:C, "*Pemasukan*", _DashboardData!A:A, IF(Dashboard!C6="Semua Sumber", "*", Dashboard!C6), _DashboardData!B:B, IF(Dashboard!C9="Semua Tahun", "*", "*"&Dashboard!C9&"*"), _DashboardData!B:B, "*-01-*", _DashboardData!D:D, IF(Dashboard!C14="Semua Kategori", "*", Dashboard!C14))`,
    `=SUMIFS(_DashboardData!E:E, _DashboardData!C:C, "*Pengeluaran*", _DashboardData!A:A, IF(Dashboard!C6="Semua Sumber", "*", Dashboard!C6), _DashboardData!B:B, IF(Dashboard!C9="Semua Tahun", "*", "*"&Dashboard!C9&"*"), _DashboardData!B:B, "*-01-*", _DashboardData!D:D, IF(Dashboard!C14="Semua Kategori", "*", Dashboard!C14))`,
    '',
  ];

  const firstBook = books[0] || 'Kas';
  row2.push(
    firstBook,
    `=SUMIFS(_DashboardData!E:E, _DashboardData!A:A, "${firstBook}", _DashboardData!C:C, "*Pemasukan*", _DashboardData!B:B, IF(Dashboard!C9="Semua Tahun", "*", "*"&Dashboard!C9&"*"), _DashboardData!B:B, IF(Dashboard!C11="Semua Bulan", "*", "*-"&LEFT(Dashboard!C11,2)&"-*"), _DashboardData!D:D, IF(Dashboard!C14="Semua Kategori", "*", Dashboard!C14))`,
    `=SUMIFS(_DashboardData!E:E, _DashboardData!A:A, "${firstBook}", _DashboardData!C:C, "*Pengeluaran*", _DashboardData!B:B, IF(Dashboard!C9="Semua Tahun", "*", "*"&Dashboard!C9&"*"), _DashboardData!B:B, IF(Dashboard!C11="Semua Bulan", "*", "*-"&LEFT(Dashboard!C11,2)&"-*"), _DashboardData!D:D, IF(Dashboard!C14="Semua Kategori", "*", Dashboard!C14))`,
    `=Q2 - R2`
  );
  dataSheetRows.push(row2);

  for (let mIdx = 1; mIdx < 12; mIdx++) {
    const m = months[mIdx];
    const bRowIndex = mIdx + 2;
    const mRow: any[] = ['', '', '', '', '', '', '', '', '', '', ''];

    mRow.push(
      m.name,
      `=SUMIFS(_DashboardData!E:E, _DashboardData!C:C, "*Pemasukan*", _DashboardData!A:A, IF(Dashboard!C6="Semua Sumber", "*", Dashboard!C6), _DashboardData!B:B, IF(Dashboard!C9="Semua Tahun", "*", "*"&Dashboard!C9&"*"), _DashboardData!B:B, "*-${m.code}-*", _DashboardData!D:D, IF(Dashboard!C14="Semua Kategori", "*", Dashboard!C14))`,
      `=SUMIFS(_DashboardData!E:E, _DashboardData!C:C, "*Pengeluaran*", _DashboardData!A:A, IF(Dashboard!C6="Semua Sumber", "*", Dashboard!C6), _DashboardData!B:B, IF(Dashboard!C9="Semua Tahun", "*", "*"&Dashboard!C9&"*"), _DashboardData!B:B, "*-${m.code}-*", _DashboardData!D:D, IF(Dashboard!C14="Semua Kategori", "*", Dashboard!C14))`
    );

    mRow.push('');

    if (mIdx < books.length) {
      const bookName = books[mIdx];
      mRow.push(
        bookName,
        `=SUMIFS(_DashboardData!E:E, _DashboardData!A:A, "${bookName}", _DashboardData!C:C, "*Pemasukan*", _DashboardData!B:B, IF(Dashboard!C9="Semua Tahun", "*", "*"&Dashboard!C9&"*"), _DashboardData!B:B, IF(Dashboard!C11="Semua Bulan", "*", "*-"&LEFT(Dashboard!C11,2)&"-*"), _DashboardData!D:D, IF(Dashboard!C14="Semua Kategori", "*", Dashboard!C14))`,
        `=SUMIFS(_DashboardData!E:E, _DashboardData!A:A, "${bookName}", _DashboardData!C:C, "*Pengeluaran*", _DashboardData!B:B, IF(Dashboard!C9="Semua Tahun", "*", "*"&Dashboard!C9&"*"), _DashboardData!B:B, IF(Dashboard!C11="Semua Bulan", "*", "*-"&LEFT(Dashboard!C11,2)&"-*"), _DashboardData!D:D, IF(Dashboard!C14="Semua Kategori", "*", Dashboard!C14))`,
        `=Q${bRowIndex} - R${bRowIndex}`
      );
    }

    dataSheetRows.push(mRow);
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: '_DashboardData!A1',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: dataSheetRows },
  });

  // 5. Susun Struktur Teks & Formula di Sheet Dashboard
  // Grid Presisi: Kolom B sampai I adalah 1-to-1 unmerged kolom!
  console.log('✨ Menulis Struktur Grid Rapi di Sheet Dashboard...');

  const bookTableRows: any[][] = [];
  for (let i = 0; i < 4; i++) {
    const rowIdx = i + 2;
    if (i < books.length) {
      bookTableRows.push([
        i + 1,
        `=_DashboardData!P${rowIdx}`,
        `=_DashboardData!Q${rowIdx}`,
        `=_DashboardData!R${rowIdx}`,
        `=_DashboardData!S${rowIdx}`,
        `=IFERROR(_DashboardData!R${rowIdx} / $E$6, 0)`,
        `=IF(_DashboardData!S${rowIdx} > 0, "Aktif", IF(_DashboardData!S${rowIdx} = 0, "Selesai", "Defisit"))`,
        i === 0 ? 'Kas Utama Bendahara' : `Kegiatan ${books[i]}`,
      ]);
    } else {
      bookTableRows.push(['-', '-', 0, 0, 0, 0, '-', '-']);
    }
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'Dashboard!A1:I34',
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [
        // Baris 1: Margin
        [],
        // Baris 2: Header Utama (B2: Title, H2: Quote)
        [
          '',
          'FINANCIAL & CASH MONITORING DASHBOARD', '', '', '', '', '',
          'Small Progress, Big Results ♡', '',
        ],
        // Baris 3: Subtitle
        [
          '',
          'Track Cashflow • Multi-Book Sync • Stay Organized',
        ],
        // Baris 4: Spacer
        [],
        // Baris 5: KPI Card Headers (D5 s/d I5) & Sidebar Header (B5:C5)
        [
          '',
          'FILTER DATA', '',
          'TOTAL PEMASUKAN',
          'TOTAL PENGELUARAN',
          'SALDO KAS BERSIH',
          'KAS ANGGOTA LUNAS',
          'RASIO SURPLUS', '',
        ],
        // Baris 6: Nilai Filter & Nilai KPI
        [
          '',
          'Sumber:', 'Semua Sumber',
          '=SUMIFS(_DashboardData!E:E, _DashboardData!C:C, "*Pemasukan*", _DashboardData!A:A, IF(C6="Semua Sumber", "*", C6), _DashboardData!B:B, IF(C9="Semua Tahun", "*", "*"&C9&"*"), _DashboardData!B:B, IF(C11="Semua Bulan", "*", "*-"&LEFT(C11,2)&"-*"), _DashboardData!D:D, IF(C14="Semua Kategori", "*", C14))',
          '=SUMIFS(_DashboardData!E:E, _DashboardData!C:C, "*Pengeluaran*", _DashboardData!A:A, IF(C6="Semua Sumber", "*", C6), _DashboardData!B:B, IF(C9="Semua Tahun", "*", "*"&C9&"*"), _DashboardData!B:B, IF(C11="Semua Bulan", "*", "*-"&LEFT(C11,2)&"-*"), _DashboardData!D:D, IF(C14="Semua Kategori", "*", C14))',
          '=D6 - E6',
          '=IFERROR(SUM(Kas_Anggota!D2:D), 0)',
          '=IFERROR(F6 / D6, 0)', '',
        ],
        // Baris 7: Subtext KPI
        [
          '',
          '', '',
          'Inflow Kas Terdata',
          'Outflow / Belanja',
          '=IF(F6>=0, "Surplus Kas Aman", "Defisit Kas")',
          '=IFERROR(COUNTIF(Kas_Anggota!F2:F, "Lunas"), 0) & " Pembayaran"',
          'Pertumbuhan Dana Sehat', '',
        ],
        // Baris 8: Sidebar Filter 2 Header
        [
          '',
          'PERIODE WAKTU',
        ],
        // Baris 9: Dropdown Tahun
        [
          '',
          'Tahun:', 'Semua Tahun',
        ],
        // Baris 10: Spacer
        [],
        // Baris 11: Dropdown Bulan
        [
          '',
          'Bulan:', 'Semua Bulan',
        ],
        // Baris 12: Spacer
        [],
        // Baris 13: Sidebar Filter 3 Header
        [
          '',
          'KATEGORI TRANSAKSI',
        ],
        // Baris 14: Dropdown Kategori
        [
          '',
          'Kategori:', 'Semua Kategori',
        ],
        // Baris 15: Spacer
        [],
        // Baris 16: Sidebar Filter 4 Header
        [
          '',
          'STATUS BOT TELEGRAM',
        ],
        // Baris 17: Nilai Status Bot
        [
          '',
          'Sync:', '🟢 Active Realtime',
        ],
        // Baris 18-23: Spacer
        [], [], [], [], [], [],
        // Baris 24: Spacer sebelum tabel
        [],
        // Baris 25: Header Title DAFTAR BUKU & RINGKASAN KEUANGAN (B25:I25)
        [
          '',
          'DAFTAR BUKU & RINGKASAN KEUANGAN KEGIATAN',
        ],
        // Baris 26: Subheader Kolom Tabel Presisi (B26:I26 - Single Cell Masing-masing!)
        [
          '',
          'No',
          'Nama Buku / Kegiatan',
          'Total Pemasukan',
          'Total Pengeluaran',
          'Sisa Saldo',
          'Porsi Belanja',
          'Status Kegiatan',
          'Keterangan & PIC',
        ],
        // Baris 27: Data Buku 1
        [
          '',
          bookTableRows[0][0],
          bookTableRows[0][1],
          bookTableRows[0][2],
          bookTableRows[0][3],
          bookTableRows[0][4],
          bookTableRows[0][5],
          bookTableRows[0][6],
          bookTableRows[0][7],
        ],
        // Baris 28: Data Buku 2
        [
          '',
          bookTableRows[1][0],
          bookTableRows[1][1],
          bookTableRows[1][2],
          bookTableRows[1][3],
          bookTableRows[1][4],
          bookTableRows[1][5],
          bookTableRows[1][6],
          bookTableRows[1][7],
        ],
        // Baris 29: Data Buku 3
        [
          '',
          bookTableRows[2][0],
          bookTableRows[2][1],
          bookTableRows[2][2],
          bookTableRows[2][3],
          bookTableRows[2][4],
          bookTableRows[2][5],
          bookTableRows[2][6],
          bookTableRows[2][7],
        ],
        // Baris 30: Data Buku 4
        [
          '',
          bookTableRows[3][0],
          bookTableRows[3][1],
          bookTableRows[3][2],
          bookTableRows[3][3],
          bookTableRows[3][4],
          bookTableRows[3][5],
          bookTableRows[3][6],
          bookTableRows[3][7],
        ],
        // Baris 31: Total Row
        [
          '',
          'TOTAL',
          'Konsolidasi Seluruh Buku',
          '=SUM(D27:D30)',
          '=SUM(E27:E30)',
          '=SUM(F27:F30)',
          '=SUM(G27:G30)',
          '=IF(F31>=0, "Surplus Kas Aman", "Defisit")',
          'Realtime Multi-Book Aggregation',
        ],
        // Baris 32: Spacer
        [],
        // Baris 33: Quote Footer Cantik (B33:I33)
        [
          '',
          '"A more organized cashflow, a more peaceful mind" ♡', '', '', '', '', '',
          'VlookupDaily Style | DKC Banyumas', '',
        ],
      ],
    },
  });

  // 6. Styling, Merges, Validations & Charts
  console.log('🎨 Menerapkan Styling Presisi 100%...');

  const borderCard = { style: 'SOLID', width: 1, color: PALETTE.cardBorder };
  const borderTable = { style: 'SOLID', width: 1, color: PALETTE.tableBorder };
  const borderFilter = { style: 'SOLID', width: 1, color: PALETTE.filterInputBorder };

  const uiRequests: any[] = [
    // Bersihkan semua validasi lama
    {
      setDataValidation: {
        range: { sheetId: dashId, startRowIndex: 0, endRowIndex: 50, startColumnIndex: 0, endColumnIndex: 26 },
      },
    },

    // 💰 Format seluruh data angka di _DashboardData dengan format Rupiah agar saat di-hover kursor, tooltip chart menampilkan nominal resmi "Rp"
    {
      repeatCell: {
        range: { sheetId: dDataId, startRowIndex: 1, endRowIndex: 25, startColumnIndex: 9, endColumnIndex: 10 },
        cell: { userEnteredFormat: { numberFormat: { type: 'CURRENCY', pattern: '"Rp"#,##0' } } },
        fields: 'userEnteredFormat.numberFormat',
      },
    },
    {
      repeatCell: {
        range: { sheetId: dDataId, startRowIndex: 1, endRowIndex: 15, startColumnIndex: 12, endColumnIndex: 14 },
        cell: { userEnteredFormat: { numberFormat: { type: 'CURRENCY', pattern: '"Rp"#,##0' } } },
        fields: 'userEnteredFormat.numberFormat',
      },
    },
    {
      repeatCell: {
        range: { sheetId: dDataId, startRowIndex: 1, endRowIndex: 10, startColumnIndex: 16, endColumnIndex: 19 },
        cell: { userEnteredFormat: { numberFormat: { type: 'CURRENCY', pattern: '"Rp"#,##0' } } },
        fields: 'userEnteredFormat.numberFormat',
      },
    },

    // 📏 Pengaturan Lebar Kolom yang Presisi 100% (A s/d I)
    // Total Lebar = 20 + 40 + 175 + 145 + 145 + 145 + 110 + 130 + 240 = 1,150px
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 20 }, fields: 'pixelSize' } },  // A margin
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 45 }, fields: 'pixelSize' } },  // B (Sidebar label / No)
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 2, endIndex: 3 }, properties: { pixelSize: 175 }, fields: 'pixelSize' } }, // C (Sidebar input / Nama Buku)
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 3, endIndex: 4 }, properties: { pixelSize: 155 }, fields: 'pixelSize' } }, // D (Card 1 / Masuk)
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 4, endIndex: 5 }, properties: { pixelSize: 155 }, fields: 'pixelSize' } }, // E (Card 2 / Keluar)
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 5, endIndex: 6 }, properties: { pixelSize: 155 }, fields: 'pixelSize' } }, // F (Card 3 / Saldo)
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 6, endIndex: 7 }, properties: { pixelSize: 155 }, fields: 'pixelSize' } }, // G (Card 4 / Kas Anggota)
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 7, endIndex: 8 }, properties: { pixelSize: 130 }, fields: 'pixelSize' } }, // H (Card 5 / Rasio)
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 8, endIndex: 9 }, properties: { pixelSize: 175 }, fields: 'pixelSize' } }, // I (Ket / Card 5 part 2)
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'COLUMNS', startIndex: 9, endIndex: 10 }, properties: { pixelSize: 20 }, fields: 'pixelSize' } }, // J margin

    // 📏 Pengaturan Tinggi Baris Kunci
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'ROWS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 34 }, fields: 'pixelSize' } }, // Row 2 Header
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'ROWS', startIndex: 2, endIndex: 3 }, properties: { pixelSize: 20 }, fields: 'pixelSize' } }, // Row 3 Subtitle
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'ROWS', startIndex: 4, endIndex: 5 }, properties: { pixelSize: 26 }, fields: 'pixelSize' } }, // Row 5 KPI Header
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'ROWS', startIndex: 5, endIndex: 6 }, properties: { pixelSize: 36 }, fields: 'pixelSize' } }, // Row 6 KPI Value
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'ROWS', startIndex: 6, endIndex: 7 }, properties: { pixelSize: 22 }, fields: 'pixelSize' } }, // Row 7 KPI Subtext
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'ROWS', startIndex: 24, endIndex: 25 }, properties: { pixelSize: 32 }, fields: 'pixelSize' } }, // Row 25 Table Title Banner
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'ROWS', startIndex: 25, endIndex: 26 }, properties: { pixelSize: 26 }, fields: 'pixelSize' } }, // Row 26 Table Column Header
    { updateDimensionProperties: { range: { sheetId: dashId, dimension: 'ROWS', startIndex: 26, endIndex: 31 }, properties: { pixelSize: 26 }, fields: 'pixelSize' } }, // Rows 27-31 Table Data

    // 🔗 MERGES HANYA DI HEADER, SIDEBAR & BANNER (TIDAK ADA MERGE DI DALAM TABEL DATA!)
    // Header Title (B2:G2) & Quote (H2:I2)
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 1, endColumnIndex: 7 }, mergeType: 'MERGE_ALL' } },
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 7, endColumnIndex: 9 }, mergeType: 'MERGE_ALL' } },
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 1, endColumnIndex: 9 }, mergeType: 'MERGE_ALL' } },

    // Sidebar Merges
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 1, endColumnIndex: 3 }, mergeType: 'MERGE_ALL' } }, // Filter Data
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 7, endRowIndex: 8, startColumnIndex: 1, endColumnIndex: 3 }, mergeType: 'MERGE_ALL' } }, // Periode Waktu
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 12, endRowIndex: 13, startColumnIndex: 1, endColumnIndex: 3 }, mergeType: 'MERGE_ALL' } }, // Kategori
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 15, endRowIndex: 16, startColumnIndex: 1, endColumnIndex: 3 }, mergeType: 'MERGE_ALL' } }, // Status Bot

    // KPI Card 5 Merge (H5:I5, H6:I6, H7:I7)
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 7, endColumnIndex: 9 }, mergeType: 'MERGE_ALL' } },
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 5, endRowIndex: 6, startColumnIndex: 7, endColumnIndex: 9 }, mergeType: 'MERGE_ALL' } },
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 6, endRowIndex: 7, startColumnIndex: 7, endColumnIndex: 9 }, mergeType: 'MERGE_ALL' } },

    // Banner Title Table (B25:I25)
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 24, endRowIndex: 25, startColumnIndex: 1, endColumnIndex: 9 }, mergeType: 'MERGE_ALL' } },

    // Quote Footer Merge (B33:G33) & Brand (H33:I33)
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 32, endRowIndex: 33, startColumnIndex: 1, endColumnIndex: 7 }, mergeType: 'MERGE_ALL' } },
    { mergeCells: { range: { sheetId: dashId, startRowIndex: 32, endRowIndex: 33, startColumnIndex: 7, endColumnIndex: 9 }, mergeType: 'MERGE_ALL' } },

    // 🎯 DATA VALIDATION (Dropdown Filters di Sidebar: C6, C9, C11, C14)
    {
      setDataValidation: {
        range: { sheetId: dashId, startRowIndex: 5, endRowIndex: 6, startColumnIndex: 2, endColumnIndex: 3 },
        rule: {
          condition: {
            type: 'ONE_OF_LIST',
            values: [{ userEnteredValue: 'Semua Sumber' }, ...books.map((b) => ({ userEnteredValue: b }))],
          },
          showCustomUi: true,
          strict: false,
        },
      },
    },
    {
      setDataValidation: {
        range: { sheetId: dashId, startRowIndex: 8, endRowIndex: 9, startColumnIndex: 2, endColumnIndex: 3 },
        rule: {
          condition: {
            type: 'ONE_OF_LIST',
            values: [{ userEnteredValue: 'Semua Tahun' }, { userEnteredValue: '2026' }, { userEnteredValue: '2025' }, { userEnteredValue: '2024' }],
          },
          showCustomUi: true,
          strict: false,
        },
      },
    },
    {
      setDataValidation: {
        range: { sheetId: dashId, startRowIndex: 10, endRowIndex: 11, startColumnIndex: 2, endColumnIndex: 3 },
        rule: {
          condition: {
            type: 'ONE_OF_LIST',
            values: [
              { userEnteredValue: 'Semua Bulan' },
              ...months.map((m) => ({ userEnteredValue: `${m.code} - ${m.name}` })),
            ],
          },
          showCustomUi: true,
          strict: false,
        },
      },
    },
    {
      setDataValidation: {
        range: { sheetId: dashId, startRowIndex: 13, endRowIndex: 14, startColumnIndex: 2, endColumnIndex: 3 },
        rule: {
          condition: {
            type: 'ONE_OF_LIST',
            values: [
              { userEnteredValue: 'Semua Kategori' },
              { userEnteredValue: 'Iuran Kas' },
              { userEnteredValue: 'Operasional' },
              { userEnteredValue: 'Konsumsi' },
              { userEnteredValue: 'Transportasi' },
              { userEnteredValue: 'Perlengkapan' },
              { userEnteredValue: 'Atribut' },
              { userEnteredValue: 'Pindah Saldo' },
              { userEnteredValue: 'Donasi' },
              { userEnteredValue: 'Lain-lain' },
            ],
          },
          showCustomUi: true,
          strict: false,
        },
      },
    },

    // 🎨 STYLING
    // Title Header & Quote
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 1, endColumnIndex: 7 },
        cell: {
          userEnteredFormat: {
            textFormat: { foregroundColor: PALETTE.titleText, bold: true, fontSize: 16 },
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(textFormat,verticalAlignment)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 7, endColumnIndex: 9 },
        cell: {
          userEnteredFormat: {
            textFormat: { foregroundColor: PALETTE.scriptQuote, italic: true, fontSize: 11 },
            horizontalAlignment: 'RIGHT',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 1, endColumnIndex: 9 },
        cell: {
          userEnteredFormat: {
            textFormat: { foregroundColor: PALETTE.subtitleText, fontSize: 8 },
            verticalAlignment: 'TOP',
          },
        },
        fields: 'userEnteredFormat(textFormat,verticalAlignment)',
      },
    },

    // Sidebar Container (B5:C23)
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 4, endRowIndex: 23, startColumnIndex: 1, endColumnIndex: 3 },
        cell: {
          userEnteredFormat: {
            backgroundColor: PALETTE.cardBg,
            borders: { top: borderCard, bottom: borderCard, left: borderCard, right: borderCard },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,borders)',
      },
    },
    // Sidebar Section Headers (B5, B8, B13, B16)
    ...[4, 7, 12, 15].map((r) => ({
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 1, endColumnIndex: 3 },
        cell: {
          userEnteredFormat: {
            backgroundColor: PALETTE.sidebarHeaderBg,
            textFormat: { foregroundColor: PALETTE.sidebarHeaderText, bold: true, fontSize: 8 },
            verticalAlignment: 'MIDDLE',
            padding: { left: 8 },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,padding)',
      },
    })),
    // Sidebar Labels (B6, B9, B11, B14, B17)
    ...[5, 8, 10, 13, 16].map((r) => ({
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 1, endColumnIndex: 2 },
        cell: {
          userEnteredFormat: {
            textFormat: { foregroundColor: PALETTE.filterLabel, bold: true, fontSize: 8 },
            verticalAlignment: 'MIDDLE',
            horizontalAlignment: 'RIGHT',
          },
        },
        fields: 'userEnteredFormat(textFormat,verticalAlignment,horizontalAlignment)',
      },
    })),
    // Sidebar Inputs (C6, C9, C11, C14, C17)
    ...[5, 8, 10, 13, 16].map((r) => ({
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 2, endColumnIndex: 3 },
        cell: {
          userEnteredFormat: {
            backgroundColor: PALETTE.filterInputBg,
            borders: { top: borderFilter, bottom: borderFilter, left: borderFilter, right: borderFilter },
            textFormat: { foregroundColor: PALETTE.filterInputText, bold: true, fontSize: 8 },
            verticalAlignment: 'MIDDLE',
            horizontalAlignment: 'CENTER',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,borders,textFormat,verticalAlignment,horizontalAlignment)',
      },
    })),

    // 5 KPI Cards Styling (Col D, E, F, G, H:I)
    ...[
      { startCol: 3, endCol: 4, color: PALETTE.valGreen, pattern: '"Rp"#,##0' },
      { startCol: 4, endCol: 5, color: PALETTE.valRose, pattern: '"Rp"#,##0' },
      { startCol: 5, endCol: 6, color: PALETTE.valPlum, pattern: '"Rp"#,##0' },
      { startCol: 6, endCol: 7, color: PALETTE.valTeal, pattern: '"Rp"#,##0' },
      { startCol: 7, endCol: 9, color: PALETTE.valBlue, pattern: '0.0%' },
    ].map((c) => ({
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 4, endRowIndex: 7, startColumnIndex: c.startCol, endColumnIndex: c.endCol },
        cell: {
          userEnteredFormat: {
            backgroundColor: PALETTE.cardBg,
            borders: { top: borderCard, bottom: borderCard, left: borderCard, right: borderCard },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,borders,horizontalAlignment,verticalAlignment)',
      },
    })),
    // KPI Titles (Row 5)
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 3, endColumnIndex: 9 },
        cell: { userEnteredFormat: { textFormat: { foregroundColor: PALETTE.kpiLabel, bold: true, fontSize: 8 } } },
        fields: 'userEnteredFormat.textFormat',
      },
    },
    // KPI Amounts (Row 6)
    ...[
      { startCol: 3, endCol: 4, color: PALETTE.valGreen, pattern: '"Rp"#,##0' },
      { startCol: 4, endCol: 5, color: PALETTE.valRose, pattern: '"Rp"#,##0' },
      { startCol: 5, endCol: 6, color: PALETTE.valPlum, pattern: '"Rp"#,##0' },
      { startCol: 6, endCol: 7, color: PALETTE.valTeal, pattern: '"Rp"#,##0' },
      { startCol: 7, endCol: 9, color: PALETTE.valBlue, pattern: '0.0%' },
    ].map((k) => ({
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 5, endRowIndex: 6, startColumnIndex: k.startCol, endColumnIndex: k.endCol },
        cell: {
          userEnteredFormat: {
            textFormat: { foregroundColor: k.color, bold: true, fontSize: 13 },
            numberFormat: { type: 'CURRENCY', pattern: k.pattern },
          },
        },
        fields: 'userEnteredFormat(textFormat,numberFormat)',
      },
    })),
    // KPI Subtext (Row 7)
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 6, endRowIndex: 7, startColumnIndex: 3, endColumnIndex: 9 },
        cell: { userEnteredFormat: { textFormat: { foregroundColor: PALETTE.kpiSubtext, fontSize: 8 } } },
        fields: 'userEnteredFormat.textFormat',
      },
    },

    // 3 Chart Container Cards (Row 9 to 23)
    // Container 1 (Col D:E), Container 2 (Col F:G), Container 3 (Col H:I)
    ...[
      { startCol: 3, endCol: 5 },
      { startCol: 5, endCol: 7 },
      { startCol: 7, endCol: 9 },
    ].map((b) => ({
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 8, endRowIndex: 23, startColumnIndex: b.startCol, endColumnIndex: b.endCol },
        cell: {
          userEnteredFormat: {
            backgroundColor: PALETTE.cardBg,
            borders: { top: borderCard, bottom: borderCard, left: borderCard, right: borderCard },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,borders)',
      },
    })),

    // Table Styling (B25:I31)
    // Banner Title (B25:I25)
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 24, endRowIndex: 25, startColumnIndex: 1, endColumnIndex: 9 },
        cell: {
          userEnteredFormat: {
            backgroundColor: PALETTE.tableHeaderBg,
            textFormat: { foregroundColor: PALETTE.tableHeaderText, bold: true, fontSize: 9 },
            verticalAlignment: 'MIDDLE',
            padding: { left: 12 },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,padding)',
      },
    },
    // Subheader Row (B26:I26)
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 25, endRowIndex: 26, startColumnIndex: 1, endColumnIndex: 9 },
        cell: {
          userEnteredFormat: {
            backgroundColor: PALETTE.tableSubheaderBg,
            textFormat: { foregroundColor: PALETTE.tableSubheaderText, bold: true, fontSize: 8 },
            borders: { top: borderTable, bottom: borderTable, left: borderTable, right: borderTable },
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,borders,verticalAlignment)',
      },
    },
    // Subheader Individual Alignments:
    // B: Center (No)
    { repeatCell: { range: { sheetId: dashId, startRowIndex: 25, endRowIndex: 26, startColumnIndex: 1, endColumnIndex: 2 }, cell: { userEnteredFormat: { horizontalAlignment: 'CENTER' } }, fields: 'userEnteredFormat.horizontalAlignment' } },
    // C: Left (Nama Buku)
    { repeatCell: { range: { sheetId: dashId, startRowIndex: 25, endRowIndex: 26, startColumnIndex: 2, endColumnIndex: 3 }, cell: { userEnteredFormat: { horizontalAlignment: 'LEFT', padding: { left: 10 } } }, fields: 'userEnteredFormat(horizontalAlignment,padding)' } },
    // D, E, F, G: Right (Amounts & Porsi)
    { repeatCell: { range: { sheetId: dashId, startRowIndex: 25, endRowIndex: 26, startColumnIndex: 3, endColumnIndex: 7 }, cell: { userEnteredFormat: { horizontalAlignment: 'RIGHT', padding: { right: 8 } } }, fields: 'userEnteredFormat(horizontalAlignment,padding)' } },
    // H: Center (Status)
    { repeatCell: { range: { sheetId: dashId, startRowIndex: 25, endRowIndex: 26, startColumnIndex: 7, endColumnIndex: 8 }, cell: { userEnteredFormat: { horizontalAlignment: 'CENTER' } }, fields: 'userEnteredFormat.horizontalAlignment' } },
    // I: Left (Keterangan)
    { repeatCell: { range: { sheetId: dashId, startRowIndex: 25, endRowIndex: 26, startColumnIndex: 8, endColumnIndex: 9 }, cell: { userEnteredFormat: { horizontalAlignment: 'LEFT', padding: { left: 10 } } }, fields: 'userEnteredFormat(horizontalAlignment,padding)' } },

    // Table Data Rows (B27:I30)
    ...[26, 27, 28, 29].map((r, idx) => ({
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 1, endColumnIndex: 9 },
        cell: {
          userEnteredFormat: {
            backgroundColor: idx % 2 === 0 ? PALETTE.tableRowEven : PALETTE.tableRowOdd,
            borders: { top: borderTable, bottom: borderTable, left: borderTable, right: borderTable },
            verticalAlignment: 'MIDDLE',
            textFormat: { fontSize: 8 },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,borders,verticalAlignment,textFormat)',
      },
    })),
    // Table Total Row (B31:I31)
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 30, endRowIndex: 31, startColumnIndex: 1, endColumnIndex: 9 },
        cell: {
          userEnteredFormat: {
            backgroundColor: PALETTE.tableTotalBg,
            borders: { top: borderTable, bottom: borderTable, left: borderTable, right: borderTable },
            textFormat: { foregroundColor: PALETTE.tableTotalText, bold: true, fontSize: 8 },
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,borders,textFormat,verticalAlignment)',
      },
    },

    // Individual Column Alignments in Data Rows (B27:I31):
    // Col B: No -> Center
    { repeatCell: { range: { sheetId: dashId, startRowIndex: 26, endRowIndex: 31, startColumnIndex: 1, endColumnIndex: 2 }, cell: { userEnteredFormat: { horizontalAlignment: 'CENTER' } }, fields: 'userEnteredFormat.horizontalAlignment' } },
    // Col C: Nama Buku -> Left with 10px padding
    { repeatCell: { range: { sheetId: dashId, startRowIndex: 26, endRowIndex: 31, startColumnIndex: 2, endColumnIndex: 3 }, cell: { userEnteredFormat: { horizontalAlignment: 'LEFT', padding: { left: 10 }, textFormat: { bold: true } } }, fields: 'userEnteredFormat(horizontalAlignment,padding,textFormat)' } },
    // Col D, E, F: Currency -> Right with 8px padding
    ...[3, 4, 5].map((colIdx) => ({
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 26, endRowIndex: 31, startColumnIndex: colIdx, endColumnIndex: colIdx + 1 },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: 'CURRENCY', pattern: '"Rp"#,##0' },
            horizontalAlignment: 'RIGHT',
            padding: { right: 8 },
            textFormat: colIdx === 5 ? { bold: true } : undefined,
          },
        },
        fields: 'userEnteredFormat(numberFormat,horizontalAlignment,padding,textFormat)',
      },
    })),
    // Col G: Porsi % -> Right with 8px padding
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 26, endRowIndex: 31, startColumnIndex: 6, endColumnIndex: 7 },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: 'PERCENT', pattern: '0.0%' },
            horizontalAlignment: 'RIGHT',
            padding: { right: 8 },
          },
        },
        fields: 'userEnteredFormat(numberFormat,horizontalAlignment,padding)',
      },
    },
    // Col H: Status -> Center with bold text
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 26, endRowIndex: 31, startColumnIndex: 7, endColumnIndex: 8 },
        cell: {
          userEnteredFormat: {
            horizontalAlignment: 'CENTER',
            textFormat: { bold: true },
          },
        },
        fields: 'userEnteredFormat(horizontalAlignment,textFormat)',
      },
    },
    // Col I: Keterangan -> Left with 10px padding
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 26, endRowIndex: 31, startColumnIndex: 8, endColumnIndex: 9 },
        cell: {
          userEnteredFormat: {
            horizontalAlignment: 'LEFT',
            padding: { left: 10 },
          },
        },
        fields: 'userEnteredFormat(horizontalAlignment,padding)',
      },
    },

    // Footer Quote (B33:G33) & Brand (H33:I33)
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 32, endRowIndex: 33, startColumnIndex: 1, endColumnIndex: 7 },
        cell: {
          userEnteredFormat: {
            textFormat: { foregroundColor: PALETTE.scriptQuote, italic: true, fontSize: 10 },
            horizontalAlignment: 'LEFT',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: dashId, startRowIndex: 32, endRowIndex: 33, startColumnIndex: 7, endColumnIndex: 9 },
        cell: {
          userEnteredFormat: {
            textFormat: { foregroundColor: PALETTE.subtitleText, fontSize: 8 },
            horizontalAlignment: 'RIGHT',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment)',
      },
    },

    // 📊 CHART 1: CLEAN 2D DONUT "PROPORSI BUKU KEGIATAN" (Wadah Kiri D9:E23)
    {
      addChart: {
        chart: {
          spec: {
            title: 'PROPORSI BUKU KEGIATAN',
            titleTextFormat: { bold: true, fontSize: 9, foregroundColor: PALETTE.titleText },
            pieChart: {
              threeDimensional: true,
              pieHole: 0.4,
              legendPosition: 'RIGHT_LEGEND',
              domain: {
                sourceRange: {
                  sources: [
                    {
                      sheetId: dDataId,
                      startRowIndex: 1,
                      endRowIndex: 1 + books.length,
                      startColumnIndex: 15,
                      endColumnIndex: 16,
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
                      endRowIndex: 1 + books.length,
                      startColumnIndex: 17,
                      endColumnIndex: 18,
                    },
                  ],
                },
              },
            },
          },
          position: {
            overlayPosition: {
              anchorCell: { sheetId: dashId, rowIndex: 8, columnIndex: 3 },
              offsetXPixels: 6,
              offsetYPixels: 6,
              widthPixels: 300,
              heightPixels: 265,
            },
          },
        },
      },
    },

    // 📊 CHART 2: CLEAN BAR COLUMN "ARUS KAS BULANAN" (Wadah Tengah F9:G23)
    {
      addChart: {
        chart: {
          spec: {
            title: 'ARUS KAS BULANAN',
            titleTextFormat: { bold: true, fontSize: 9, foregroundColor: PALETTE.titleText },
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
                          startColumnIndex: 11,
                          endColumnIndex: 12,
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
                          startColumnIndex: 12,
                          endColumnIndex: 13,
                        },
                      ],
                    },
                  },
                  targetAxis: 'LEFT_AXIS',
                  colorStyle: { rgbColor: PALETTE.chartPemasukan },
                },
                {
                  series: {
                    sourceRange: {
                      sources: [
                        {
                          sheetId: dDataId,
                          startRowIndex: 0,
                          endRowIndex: 13,
                          startColumnIndex: 13,
                          endColumnIndex: 14,
                        },
                      ],
                    },
                  },
                  targetAxis: 'LEFT_AXIS',
                  colorStyle: { rgbColor: PALETTE.chartPengeluaran },
                },
              ],
            },
          },
          position: {
            overlayPosition: {
              anchorCell: { sheetId: dashId, rowIndex: 8, columnIndex: 5 },
              offsetXPixels: 6,
              offsetYPixels: 6,
              widthPixels: 300,
              heightPixels: 265,
            },
          },
        },
      },
    },

    // 📊 CHART 3: CLEAN 3D DONUT "KATEGORI PENGELUARAN" (Wadah Kanan H9:I23)
    {
      addChart: {
        chart: {
          spec: {
            title: 'KATEGORI PENGELUARAN',
            titleTextFormat: { bold: true, fontSize: 9, foregroundColor: PALETTE.titleText },
            pieChart: {
              threeDimensional: true,
              pieHole: 0.4,
              legendPosition: 'RIGHT_LEGEND',
              domain: {
                sourceRange: {
                  sources: [
                    {
                      sheetId: dDataId,
                      startRowIndex: 1,
                      endRowIndex: 7,
                      startColumnIndex: 8,
                      endColumnIndex: 9,
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
                      endRowIndex: 7,
                      startColumnIndex: 9,
                      endColumnIndex: 10,
                    },
                  ],
                },
              },
            },
          },
          position: {
            overlayPosition: {
              anchorCell: { sheetId: dashId, rowIndex: 8, columnIndex: 7 },
              offsetXPixels: 6,
              offsetYPixels: 6,
              widthPixels: 295,
              heightPixels: 265,
            },
          },
        },
      },
    },
  ];

  console.log(`Mengirim ${uiRequests.length} konfigurasi styling 100% presisi ke Google Sheets...`);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: uiRequests },
  });

  console.log('🎉 Dashboard VlookupDaily 100% Presisi Berhasil Terpasang!');
}

run().catch((err) => {
  console.error('❌ Gagal merapikan dashboard:', err);
  process.exit(1);
});
