import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth';
import { formatDriveImageUrl } from './inventaris';
import { searchDriveFiles } from './googleDrive';

export const SHEET_SURAT = 'Surat_DKC';

export const HEADER_SURAT = [
  'Kode Arsip',
  'Jenis Surat',
  'Nomor Surat',
  'Tanggal Surat',
  'Tanggal Diterima/Keluar',
  'Pengirim / Asal',
  'Tujuan / Penerima',
  'Perihal',
  'Kategori',
  'Sifat',
  'Ringkasan / Keterangan',
  'Tautan Berkas Drive',
  'Waktu Input',
  'PIC',
];

export type JenisSurat = 'Surat Masuk' | 'Surat Keluar';

export type SifatSurat =
  | 'Biasa'
  | 'Penting'
  | 'Segera'
  | 'Sangat Segera'
  | 'Rahasia';

export type KategoriSurat =
  | 'Undangan'
  | 'Permohonan'
  | 'Pemberitahuan'
  | 'Mandat / Tugas'
  | 'Keputusan'
  | 'Rekomendasi'
  | 'Edaran'
  | 'Lain-lain';

export interface SuratItem {
  rowNumber?: number;
  kodeArsip: string; // e.g. SM-0001 (Masuk) / SK-0001 (Keluar)
  jenis: JenisSurat;
  nomorSurat: string;
  tanggalSurat: string;
  tanggalDiterima: string;
  pengirim: string;
  tujuan: string;
  perihal: string;
  kategori: string;
  sifat: SifatSurat | string;
  ringkasan: string;
  berkas: string;
  displayBerkas?: string;
  waktuInput: string;
  pic: string;
}

export interface SuratStats {
  totalSurat: number;
  totalMasuk: number;
  totalKeluar: number;
  totalPenting: number;
  bulanIniMasuk: number;
  bulanIniKeluar: number;
}

function getSpreadsheetId(): string {
  const id = process.env.GOOGLE_SHEET_ID || process.env.GOOGLE_SPREADSHEET_ID;
  if (!id) {
    throw new Error('GOOGLE_SHEET_ID belum dikonfigurasi di file .env');
  }
  return id;
}

function formatJakartaNow(): string {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date());
}

/**
 * Memastikan sheet 'Surat_DKC' tersedia di Google Spreadsheet
 */
export async function ensureSuratSheet(): Promise<void> {
  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = getSpreadsheetId();

  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetExists = meta.data.sheets?.some(
    (s) => s.properties?.title === SHEET_SURAT
  );

  if (!sheetExists) {
    // Buat tab baru Surat_DKC
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: SHEET_SURAT,
                gridProperties: {
                  rowCount: 200,
                  columnCount: HEADER_SURAT.length + 2,
                  frozenRowCount: 1,
                },
                tabColor: { red: 0.1, green: 0.35, blue: 0.74 }, // Biru Word
              },
            },
          },
        ],
      },
    });

    // Tulis header
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${SHEET_SURAT}'!A1:N1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [HEADER_SURAT],
      },
    });

    // Beri format styling header (Biru Tua Microsoft Word & Teks Putih Tebal)
    const newMeta = await sheets.spreadsheets.get({ spreadsheetId });
    const targetSheet = newMeta.data.sheets?.find(
      (s) => s.properties?.title === SHEET_SURAT
    );
    const sheetId = targetSheet?.properties?.sheetId || 0;

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            repeatCell: {
              range: {
                sheetId,
                startRowIndex: 0,
                endRowIndex: 1,
                startColumnIndex: 0,
                endColumnIndex: HEADER_SURAT.length,
              },
              cell: {
                userEnteredFormat: {
                  backgroundColor: { red: 0.09, green: 0.35, blue: 0.74 },
                  textFormat: {
                    foregroundColor: { red: 1.0, green: 1.0, blue: 1.0 },
                    bold: true,
                    fontSize: 10,
                  },
                  horizontalAlignment: 'CENTER',
                  verticalAlignment: 'MIDDLE',
                },
              },
              fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
            },
          },
        ],
      },
    });
  }
}

/**
 * Mengambil seluruh daftar surat dari tab Surat_DKC
 */
export async function getAllSurat(): Promise<SuratItem[]> {
  await ensureSuratSheet();
  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = getSpreadsheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${SHEET_SURAT}'!A2:N`,
  });

  const rows = res.data.values || [];
  const items: SuratItem[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length === 0 || !r[0]) continue;

    const kodeArsip = String(r[0] || '').trim();
    const rawJenis = String(r[1] || '').trim().toLowerCase();
    const jenis: JenisSurat = rawJenis.includes('keluar') ? 'Surat Keluar' : 'Surat Masuk';
    const nomorSurat = String(r[2] || '-').trim();
    const tanggalSurat = String(r[3] || '-').trim();
    const tanggalDiterima = String(r[4] || '-').trim();
    const pengirim = String(r[5] || '-').trim();
    const tujuan = String(r[6] || '-').trim();
    const perihal = String(r[7] || '-').trim();
    const kategori = String(r[8] || 'Lain-lain').trim();
    const sifat = String(r[9] || 'Biasa').trim();
    const ringkasan = String(r[10] || '-').trim();
    const berkas = String(r[11] || '').trim();
    const waktuInput = String(r[12] || '-').trim();
    const pic = String(r[13] || 'Staff DKC').trim();

    const displayBerkas = berkas ? formatDriveImageUrl(berkas) : '';

    items.push({
      rowNumber: i + 2,
      kodeArsip,
      jenis,
      nomorSurat,
      tanggalSurat,
      tanggalDiterima,
      pengirim,
      tujuan,
      perihal,
      kategori,
      sifat,
      ringkasan,
      berkas,
      displayBerkas,
      waktuInput,
      pic,
    });
  }

  // Urutkan dari yang terbaru (kode arsip terbesar atau row terbesar)
  return items.reverse();
}

/**
 * Menghasilkan kode arsip otomatis berikutnya (SM-0001 untuk Masuk, SK-0001 untuk Keluar)
 */
export async function generateNextSuratCode(jenis: JenisSurat): Promise<string> {
  const all = await getAllSurat();
  const prefix = jenis === 'Surat Keluar' ? 'SK' : 'SM';

  const existingNums: number[] = [];
  const regex = new RegExp(`^${prefix}-(\\d+)`, 'i');

  all.forEach((it) => {
    const match = it.kodeArsip.match(regex);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num)) existingNums.push(num);
    }
  });

  const nextNum = existingNums.length > 0 ? Math.max(...existingNums) + 1 : 1;
  return `${prefix}-${String(nextNum).padStart(4, '0')}`;
}

/**
 * Menambahkan data surat baru ke Google Sheets
 */
export async function tambahSurat(data: {
  jenis: JenisSurat;
  nomorSurat: string;
  tanggalSurat?: string;
  tanggalDiterima?: string;
  pengirim?: string;
  tujuan?: string;
  perihal: string;
  kategori?: string;
  sifat?: string;
  ringkasan?: string;
  berkas?: string;
  pic?: string;
}): Promise<SuratItem> {
  await ensureSuratSheet();
  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = getSpreadsheetId();

  const kodeArsip = await generateNextSuratCode(data.jenis);
  const nowJakarta = formatJakartaNow();

  const todayIso = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  const rowData = [
    kodeArsip,
    data.jenis,
    data.nomorSurat || '-',
    data.tanggalSurat || todayIso,
    data.tanggalDiterima || todayIso,
    data.pengirim || (data.jenis === 'Surat Keluar' ? 'DKC Cilacap' : '-'),
    data.tujuan || (data.jenis === 'Surat Masuk' ? 'DKC Cilacap' : '-'),
    data.perihal || 'Perihal Surat',
    data.kategori || 'Lain-lain',
    data.sifat || 'Biasa',
    data.ringkasan || '-',
    data.berkas || '',
    nowJakarta,
    data.pic || 'Staff DKC',
  ];

  const appendRes = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${SHEET_SURAT}'!A2`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [rowData],
    },
  });

  const updatedRange = appendRes.data.updates?.updatedRange || '';
  const matchRow = updatedRange.match(/!A(\d+)/);
  const rowNumber = matchRow ? parseInt(matchRow[1], 10) : undefined;

  return {
    rowNumber,
    kodeArsip,
    jenis: data.jenis,
    nomorSurat: data.nomorSurat || '-',
    tanggalSurat: data.tanggalSurat || todayIso,
    tanggalDiterima: data.tanggalDiterima || todayIso,
    pengirim: data.pengirim || (data.jenis === 'Surat Keluar' ? 'DKC Cilacap' : '-'),
    tujuan: data.tujuan || (data.jenis === 'Surat Masuk' ? 'DKC Cilacap' : '-'),
    perihal: data.perihal,
    kategori: data.kategori || 'Lain-lain',
    sifat: data.sifat || 'Biasa',
    ringkasan: data.ringkasan || '-',
    berkas: data.berkas || '',
    displayBerkas: data.berkas ? formatDriveImageUrl(data.berkas) : '',
    waktuInput: nowJakarta,
    pic: data.pic || 'Staff DKC',
  };
}

/**
 * Menghitung metrik statistik persuratan DKC
 */
export async function getSuratStats(): Promise<SuratStats> {
  const items = await getAllSurat();

  const now = new Date();
  const currentMonthStr = String(now.getMonth() + 1).padStart(2, '0');
  const currentYearStr = String(now.getFullYear());

  let totalMasuk = 0;
  let totalKeluar = 0;
  let totalPenting = 0;
  let bulanIniMasuk = 0;
  let bulanIniKeluar = 0;

  for (const it of items) {
    const isMasuk = it.jenis === 'Surat Masuk';
    const isKeluar = it.jenis === 'Surat Keluar';

    if (isMasuk) totalMasuk++;
    if (isKeluar) totalKeluar++;

    const sifatLower = it.sifat.toLowerCase();
    if (
      sifatLower.includes('penting') ||
      sifatLower.includes('segera') ||
      sifatLower.includes('rahasia')
    ) {
      totalPenting++;
    }

    // Cek apakah bulan ini
    const dateToCheck = it.tanggalDiterima || it.tanggalSurat || '';
    if (dateToCheck.startsWith(`${currentYearStr}-${currentMonthStr}`)) {
      if (isMasuk) bulanIniMasuk++;
      if (isKeluar) bulanIniKeluar++;
    }
  }

  return {
    totalSurat: items.length,
    totalMasuk,
    totalKeluar,
    totalPenting,
    bulanIniMasuk,
    bulanIniKeluar,
  };
}

export interface SuratSearchResult {
  id: string;
  source: 'sheet' | 'drive';
  kodeArsip?: string;
  jenis: 'Surat Masuk' | 'Surat Keluar' | 'Berkas Drive';
  nomorSurat: string;
  tanggalSurat: string;
  tanggalDiterima?: string;
  pengirim: string;
  tujuan: string;
  perihal: string;
  kategori: string;
  sifat: string;
  ringkasan: string;
  berkas: string;
  displayBerkas?: string;
  pic?: string;
  score: number;
}

/**
 * Mencari surat dan berkas di Google Sheets & Google Drive berdasarkan kata kunci
 */
export async function cariSurat(rawQuery: string): Promise<SuratSearchResult[]> {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return [];

  const queryTokens = query
    .replace(/[^a-z0-9/.-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);

  const expandedTokens = new Set<string>();
  queryTokens.forEach((t) => {
    expandedTokens.add(t);
    if (t === 'ijin') expandedTokens.add('izin');
    if (t === 'izin') expandedTokens.add('ijin');
    if (t === 'ortu') {
      expandedTokens.add('orang');
      expandedTokens.add('tua');
      expandedTokens.add('wali');
    }
    if (t === 'dispensasi') expandedTokens.add('permohonan');
  });

  const allItems = await getAllSurat();
  const results: SuratSearchResult[] = [];
  const registeredDriveIds = new Set<string>();

  const isShowAll =
    query === 'semua' ||
    query === 'all' ||
    query === 'daftar' ||
    query === 'list' ||
    query === 'semua surat' ||
    query === 'arsip';

  for (const it of allItems) {
    let score = isShowAll ? 100 : 0;
    const perihalLower = it.perihal.toLowerCase();
    const noLower = it.nomorSurat.toLowerCase();
    const kodeLower = it.kodeArsip.toLowerCase();
    const ringkasanLower = it.ringkasan.toLowerCase();
    const pengirimLower = it.pengirim.toLowerCase();
    const tujuanLower = it.tujuan.toLowerCase();
    const kategoriLower = it.kategori.toLowerCase();

    if (it.berkas) {
      const match = it.berkas.match(/\/d\/([a-zA-Z0-9_-]+)/);
      if (match) registeredDriveIds.add(match[1]);
    }

    if (!isShowAll) {
      // 1. Cocok persis seluruh query
      if (perihalLower.includes(query)) score += 80;
      if (noLower.includes(query)) score += 90;
      if (kodeLower.includes(query)) score += 100;
      if (ringkasanLower.includes(query)) score += 50;

      const stopWords = new Set(['surat', 'dan', 'di', 'ke', 'dari', 'tentang', 'untuk', 'yang']);
      const hasMeaningfulTokens = Array.from(expandedTokens).some((t) => !stopWords.has(t) && t.length > 2);

      // 2. Cocok per token
      for (const token of expandedTokens) {
        if (token.length <= 2) continue;
        if (hasMeaningfulTokens && stopWords.has(token)) continue;

        if (perihalLower.includes(token)) score += 35;
        if (noLower.includes(token)) score += 35;
        if (kodeLower.includes(token)) score += 40;
        if (ringkasanLower.includes(token)) score += 20;
        if (pengirimLower.includes(token) || tujuanLower.includes(token)) score += 20;
        if (kategoriLower.includes(token)) score += 15;
      }
    }

    if (score >= 30) {
      results.push({
        id: it.kodeArsip,
        source: 'sheet',
        kodeArsip: it.kodeArsip,
        jenis: it.jenis,
        nomorSurat: it.nomorSurat,
        tanggalSurat: it.tanggalSurat,
        tanggalDiterima: it.tanggalDiterima,
        pengirim: it.pengirim,
        tujuan: it.tujuan,
        perihal: it.perihal,
        kategori: it.kategori,
        sifat: it.sifat,
        ringkasan: it.ringkasan,
        berkas: it.berkas,
        displayBerkas: it.displayBerkas,
        pic: it.pic,
        score,
      });
    }
  }

  // 3. Cari juga berkas langsung di Google Drive
  try {
    const driveFiles = await searchDriveFiles(query);
    for (const df of driveFiles) {
      if (registeredDriveIds.has(df.id)) continue;

      let driveScore = 30;
      const dfName = df.name.toLowerCase();
      if (dfName.includes(query)) driveScore += 40;
      for (const token of expandedTokens) {
        if (token.length > 2 && dfName.includes(token)) driveScore += 20;
      }

      results.push({
        id: df.id,
        source: 'drive',
        jenis: 'Berkas Drive',
        nomorSurat: '-',
        tanggalSurat: df.createdTime ? df.createdTime.slice(0, 10) : '-',
        pengirim: 'Google Drive DKC',
        tujuan: 'DKC Cilacap',
        perihal: df.name,
        kategori: 'Berkas Drive',
        sifat: 'Biasa',
        ringkasan: `Berkas tersimpan di Google Drive`,
        berkas: df.webViewLink,
        displayBerkas: df.webViewLink,
        pic: 'Google Drive',
        score: driveScore,
      });
    }
  } catch (driveErr) {
    console.warn('Gagal mencari berkas di Google Drive:', driveErr);
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 100);
}

