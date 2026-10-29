import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth';
import { appendTransaction, ensureHeaderRow } from './googleSheets';

export const SHEET_ANGGOTA = 'Anggota';
export const SHEET_KAS_ANGGOTA = 'Kas_Anggota';
export const NOMINAL_IURAN_DEFAULT = 10_000;

const HEADER_ANGGOTA = ['Nama', 'Jabatan', 'Tahun Masuk', 'Status'];
const HEADER_KAS_ANGGOTA = [
  'Nama Anggota',
  'Bulan',
  'Tahun',
  'Nominal',
  'Tanggal Bayar',
  'Status',
  'Keterangan',
];

export const DAFTAR_BULAN = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

export interface Anggota {
  nama: string;
  jabatan: string;
  tahunMasuk: string;
  status: 'Aktif' | 'Nonaktif';
}

export interface PembayaranKasRecord {
  nama: string;
  bulan: string;
  tahun: number;
  nominal: number;
  tanggalBayar: string;
  status: string;
  keterangan: string;
}

function getSpreadsheetId(): string {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) {
    throw new Error('GOOGLE_SHEET_ID belum dikonfigurasi di file .env');
  }
  return spreadsheetId;
}

/**
 * Memastikan sheet Anggota dan Kas_Anggota sudah ada dengan header yang tepat
 */
export async function ensureAnggotaSheets(): Promise<void> {
  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = getSpreadsheetId();

  // 1. Sheet Anggota
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${SHEET_ANGGOTA}'!A1:D1`,
    });
    if (!res.data.values || res.data.values.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${SHEET_ANGGOTA}'!A1:D1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [HEADER_ANGGOTA] },
      });
    }
  } catch (err: any) {
    if (err?.message?.includes('Unable to parse range') || err?.message?.includes('not found')) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: SHEET_ANGGOTA } } }],
        },
      });
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${SHEET_ANGGOTA}'!A1:D1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [HEADER_ANGGOTA] },
      });
    }
  }

  // 2. Sheet Kas_Anggota
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${SHEET_KAS_ANGGOTA}'!A1:G1`,
    });
    if (!res.data.values || res.data.values.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${SHEET_KAS_ANGGOTA}'!A1:G1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [HEADER_KAS_ANGGOTA] },
      });
    }
  } catch (err: any) {
    if (err?.message?.includes('Unable to parse range') || err?.message?.includes('not found')) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: SHEET_KAS_ANGGOTA } } }],
        },
      });
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${SHEET_KAS_ANGGOTA}'!A1:G1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [HEADER_KAS_ANGGOTA] },
      });
    }
  }
}

/**
 * Mengambil daftar seluruh anggota dari sheet Anggota
 */
export async function getDaftarAnggota(hanyaAktif = false): Promise<Anggota[]> {
  await ensureAnggotaSheets();
  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = getSpreadsheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${SHEET_ANGGOTA}'!A2:D`,
  });

  const rows = res.data.values || [];
  const list: Anggota[] = [];

  for (const r of rows) {
    const nama = r[0] ? String(r[0]).trim() : '';
    if (!nama) continue;
    const jabatan = r[1] ? String(r[1]).trim() : 'Anggota';
    const tahunMasuk = r[2] ? String(r[2]).trim() : '';
    const statusRaw = r[3] ? String(r[3]).trim().toLowerCase() : 'aktif';
    const status: 'Aktif' | 'Nonaktif' =
      statusRaw.includes('non') || statusRaw.includes('tidak') ? 'Nonaktif' : 'Aktif';

    if (hanyaAktif && status !== 'Aktif') {
      continue;
    }

    list.push({ nama, jabatan, tahunMasuk, status });
  }

  return list;
}

/**
 * Menambahkan anggota baru ke sheet Anggota
 */
export async function tambahAnggota(
  nama: string,
  jabatan = 'Anggota',
  tahunMasuk = new Date().getFullYear().toString()
): Promise<{ success: boolean; message: string; nama: string }> {
  await ensureAnggotaSheets();
  const cleanNama = nama.trim();
  if (!cleanNama) {
    return { success: false, message: 'Nama anggota tidak boleh kosong.', nama: '' };
  }

  const existing = await getDaftarAnggota();
  const found = existing.find(
    (a) => a.nama.toLowerCase() === cleanNama.toLowerCase()
  );

  if (found) {
    if (found.status === 'Nonaktif') {
      // Re-aktifkan
      await ubahStatusAnggota(found.nama, 'Aktif');
      return {
        success: true,
        message: `Anggota *${found.nama}* sebelumnya non-aktif dan kini telah diaktifkan kembali.`,
        nama: found.nama,
      };
    }
    return {
      success: false,
      message: `Anggota dengan nama *${found.nama}* sudah terdaftar dalam daftar kas (Status: ${found.status}).`,
      nama: found.nama,
    };
  }

  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = getSpreadsheetId();

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${SHEET_ANGGOTA}'!A:D`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[cleanNama, jabatan, tahunMasuk, 'Aktif']],
    },
  });

  return {
    success: true,
    message: `✅ Anggota *${cleanNama}* berhasil ditambahkan ke daftar kas.`,
    nama: cleanNama,
  };
}

/**
 * Mengubah status anggota (Aktif atau Nonaktif)
 */
export async function ubahStatusAnggota(
  namaQuery: string,
  status: 'Aktif' | 'Nonaktif'
): Promise<{ success: boolean; message: string; nama: string }> {
  await ensureAnggotaSheets();
  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = getSpreadsheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${SHEET_ANGGOTA}'!A2:D`,
  });

  const rows = res.data.values || [];
  let targetRowIndex = -1;
  let targetNama = '';

  const q = namaQuery.trim().toLowerCase();
  for (let i = 0; i < rows.length; i++) {
    const curNama = rows[i][0] ? String(rows[i][0]).trim() : '';
    if (curNama.toLowerCase() === q || curNama.toLowerCase().includes(q)) {
      targetRowIndex = i + 2;
      targetNama = curNama;
      break;
    }
  }

  if (targetRowIndex === -1) {
    return {
      success: false,
      message: `Anggota dengan nama "${namaQuery}" tidak ditemukan.`,
      nama: '',
    };
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${SHEET_ANGGOTA}'!D${targetRowIndex}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[status]],
    },
  });

  return {
    success: true,
    message: `Status anggota *${targetNama}* berhasil diubah menjadi *${status}*.`,
    nama: targetNama,
  };
}

/**
 * Normalisasi nama bulan Indonesia
 */
export function normalisasiBulan(bulanStr: string): string | null {
  const b = bulanStr.trim().toLowerCase();
  for (const m of DAFTAR_BULAN) {
    if (m.toLowerCase().startsWith(b.slice(0, 3))) {
      return m;
    }
  }
  const angka = parseInt(b, 10);
  if (!isNaN(angka) && angka >= 1 && angka <= 12) {
    return DAFTAR_BULAN[angka - 1];
  }
  return null;
}

/**
 * Mencatat pembayaran kas anggota
 * 1. Simpan ke sheet Kas_Anggota
 * 2. Catat otomatis ke sheet Kas sebagai Pemasukan kategori Iuran Kas
 */
export async function catatPembayaranKas(
  namaQuery: string,
  bulanQuery: string,
  tahun: number = new Date().getFullYear(),
  nominal: number = NOMINAL_IURAN_DEFAULT,
  keterangan = '-'
): Promise<{
  success: boolean;
  message: string;
  nama: string;
  bulan: string;
  tahun: number;
  nominal: number;
}> {
  await ensureAnggotaSheets();
  const daftar = await getDaftarAnggota();

  const qNama = namaQuery.trim().toLowerCase();
  const foundAnggota = daftar.find(
    (a) => a.nama.toLowerCase() === qNama || a.nama.toLowerCase().includes(qNama)
  );

  if (!foundAnggota) {
    return {
      success: false,
      message: `Anggota dengan nama "${namaQuery}" tidak ditemukan di daftar anggota kas. Ketik /anggota untuk melihat daftar.`,
      nama: namaQuery,
      bulan: bulanQuery,
      tahun,
      nominal,
    };
  }

  const bulan = normalisasiBulan(bulanQuery);
  if (!bulan) {
    return {
      success: false,
      message: `Nama bulan "${bulanQuery}" tidak valid. Contoh yang benar: Januari, Feb, 03, dll.`,
      nama: foundAnggota.nama,
      bulan: bulanQuery,
      tahun,
      nominal,
    };
  }

  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = getSpreadsheetId();

  // Cek apakah sudah pernah bayar untuk bulan dan tahun ini
  const resKas = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${SHEET_KAS_ANGGOTA}'!A2:E`,
  });

  const kasRows = resKas.data.values || [];
  for (const row of kasRows) {
    const rNama = row[0] ? String(row[0]).trim() : '';
    const rBulan = row[1] ? String(row[1]).trim() : '';
    const rTahun = row[2] ? parseInt(String(row[2]).trim(), 10) : 0;

    if (
      rNama.toLowerCase() === foundAnggota.nama.toLowerCase() &&
      rBulan.toLowerCase() === bulan.toLowerCase() &&
      rTahun === tahun
    ) {
      const rTgl = row[4] ? String(row[4]) : '';
      return {
        success: false,
        message: `⚠️ *${foundAnggota.nama}* sudah tercatat LUNAS untuk kas bulan *${bulan} ${tahun}*${rTgl ? ` (dibayar tgl ${rTgl})` : ''}.`,
        nama: foundAnggota.nama,
        bulan,
        tahun,
        nominal,
      };
    }
  }

  const nowJakarta = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  const isoToday = new Date().toISOString().slice(0, 10);

  // 1. Catat ke sheet Kas_Anggota
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${SHEET_KAS_ANGGOTA}'!A:G`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [
        [
          foundAnggota.nama,
          bulan,
          tahun,
          nominal,
          `'${isoToday}`,
          'Lunas',
          keterangan,
        ],
      ],
    },
  });

  // 2. Masukkan otomatis sebagai transaksi Pemasukan di tab 'Kas' utama
  try {
    await appendTransaction(
      {
        type: 'Pemasukan',
        category: 'Iuran Kas',
        amount: nominal,
        description: `Iuran Kas Anggota ${foundAnggota.nama} - Bulan ${bulan} ${tahun}`,
        date: isoToday,
      },
      'Kas'
    );
  } catch (err) {
    console.warn('Gagal mencatat transaksi iuran ke tab Kas:', err);
  }

  return {
    success: true,
    message: `✅ Pembayaran kas berhasil dicatat!`,
    nama: foundAnggota.nama,
    bulan,
    tahun,
    nominal,
  };
}

export interface KasStatusBulanItem {
  nama: string;
  jabatan: string;
  bayar: number;
  kurang: number;
  tgl: string;
  isLunas: boolean;
}

/**
 * Mengecek status kas seluruh anggota untuk bulan dan tahun tertentu
 */
export async function cekStatusKasBulan(
  bulanQuery: string,
  tahun: number = new Date().getFullYear()
): Promise<{
  bulan: string;
  tahun: number;
  sudahBayar: KasStatusBulanItem[];
  belumBayar: KasStatusBulanItem[];
  totalTerkumpul: number;
  totalTunggakan: number;
  totalAnggotaAktif: number;
  targetKas: number;
}> {
  await ensureAnggotaSheets();
  const bulan = normalisasiBulan(bulanQuery) || DAFTAR_BULAN[new Date().getMonth()];

  const anggotaAktif = await getDaftarAnggota(true);

  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = getSpreadsheetId();

  const resKas = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${SHEET_KAS_ANGGOTA}'!A2:E`,
  });

  const kasRows = resKas.data.values || [];
  const paidMap = new Map<string, { nominal: number; tgl: string }>();

  for (const row of kasRows) {
    const rNama = row[0] ? String(row[0]).trim() : '';
    const rBulan = row[1] ? String(row[1]).trim() : '';
    const rTahun = row[2] ? parseInt(String(row[2]).trim(), 10) : 0;
    const rNominal = row[3] ? parseFloat(String(row[3]).replace(/[^0-9.]/g, '')) || NOMINAL_IURAN_DEFAULT : NOMINAL_IURAN_DEFAULT;
    const rTgl = row[4] ? String(row[4]).trim() : '-';

    if (
      rBulan.toLowerCase() === bulan.toLowerCase() &&
      rTahun === tahun
    ) {
      const key = rNama.toLowerCase();
      const existing = paidMap.get(key);
      if (existing) {
        paidMap.set(key, {
          nominal: existing.nominal + rNominal,
          tgl: rTgl !== '-' ? rTgl : existing.tgl,
        });
      } else {
        paidMap.set(key, { nominal: rNominal, tgl: rTgl });
      }
    }
  }

  const sudahBayar: KasStatusBulanItem[] = [];
  const belumBayar: KasStatusBulanItem[] = [];

  for (const a of anggotaAktif) {
    const paidInfo = paidMap.get(a.nama.toLowerCase());
    const bayar = paidInfo ? paidInfo.nominal : 0;
    const tgl = paidInfo ? paidInfo.tgl : '-';
    const kurang = Math.max(0, NOMINAL_IURAN_DEFAULT - bayar);
    const isLunas = bayar >= NOMINAL_IURAN_DEFAULT;

    const item: KasStatusBulanItem = {
      nama: a.nama,
      jabatan: a.jabatan,
      bayar,
      kurang,
      tgl,
      isLunas,
    };

    if (isLunas) {
      sudahBayar.push(item);
    } else {
      belumBayar.push(item);
    }
  }

  const totalTerkumpul = sudahBayar.reduce((acc, c) => acc + c.bayar, 0) + belumBayar.reduce((acc, c) => acc + c.bayar, 0);
  const totalTunggakan = belumBayar.reduce((acc, c) => acc + c.kurang, 0);
  const targetKas = anggotaAktif.length * NOMINAL_IURAN_DEFAULT;

  return {
    bulan,
    tahun,
    sudahBayar,
    belumBayar,
    totalTerkumpul,
    totalTunggakan,
    totalAnggotaAktif: anggotaAktif.length,
    targetKas,
  };
}

/**
 * Mengecek status kas untuk 1 anggota spesifik sepanjang tahun
 */
export async function cekStatusKasAnggota(
  namaQuery: string,
  tahun: number = new Date().getFullYear()
): Promise<{
  found: boolean;
  nama: string;
  status: string;
  jabatan: string;
  tahun: number;
  bulanLunas: string[];
  bulanBelum: string[];
  totalBayar: number;
  totalKurang: number;
  targetTahun: number;
}> {
  await ensureAnggotaSheets();
  const daftar = await getDaftarAnggota();
  const q = namaQuery.trim().toLowerCase();

  const anggota = daftar.find(
    (a) => a.nama.toLowerCase() === q || a.nama.toLowerCase().includes(q)
  );

  if (!anggota) {
    return {
      found: false,
      nama: namaQuery,
      status: '',
      jabatan: '',
      tahun,
      bulanLunas: [],
      bulanBelum: [],
      totalBayar: 0,
      totalKurang: 0,
      targetTahun: 0,
    };
  }

  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = getSpreadsheetId();

  const resKas = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${SHEET_KAS_ANGGOTA}'!A2:E`,
  });

  const kasRows = resKas.data.values || [];
  const lunasBulanSet = new Set<string>();
  let totalBayar = 0;

  for (const row of kasRows) {
    const rNama = row[0] ? String(row[0]).trim() : '';
    const rBulan = row[1] ? String(row[1]).trim() : '';
    const rTahun = row[2] ? parseInt(String(row[2]).trim(), 10) : 0;
    const rNominal = row[3] ? parseFloat(String(row[3]).replace(/[^0-9.]/g, '')) || NOMINAL_IURAN_DEFAULT : NOMINAL_IURAN_DEFAULT;

    if (
      rNama.toLowerCase() === anggota.nama.toLowerCase() &&
      rTahun === tahun
    ) {
      const bNormal = normalisasiBulan(rBulan);
      if (bNormal) {
        lunasBulanSet.add(bNormal);
        totalBayar += rNominal;
      }
    }
  }

  const bulanLunas: string[] = [];
  const bulanBelum: string[] = [];

  for (const b of DAFTAR_BULAN) {
    if (lunasBulanSet.has(b)) {
      bulanLunas.push(b);
    } else {
      bulanBelum.push(b);
    }
  }

  return {
    found: true,
    nama: anggota.nama,
    status: anggota.status,
    jabatan: anggota.jabatan,
    tahun,
    bulanLunas,
    bulanBelum,
    totalBayar,
    totalKurang: bulanBelum.length * NOMINAL_IURAN_DEFAULT,
    targetTahun: 12 * NOMINAL_IURAN_DEFAULT,
  };
}
