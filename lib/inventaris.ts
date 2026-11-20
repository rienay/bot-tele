import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth';

export const SHEET_INVENTARIS = 'Inventaris';

export const HEADER_INVENTARIS = [
  'Kode Barang',
  'Nama Barang',
  'Unit',
  'Jumlah',
  'Tahun',
  'Sumber',
  'Kondisi',
  'Foto',
  'Keterangan',
  'Waktu Input',
];

export type UnitInventaris = 'DKC' | 'CYJI' | 'Paspanca' | 'Ubaloka' | 'UNPASA';

export type KondisiBarang = 'Baik' | 'Rusak Ringan' | 'Rusak Berat' | 'Hilang';

export interface UnitConfig {
  id: UnitInventaris;
  name: string;
  prefix: string;
  fullName: string;
  badgeBg: string;
  badgeText: string;
}

export const DAFTAR_UNIT: UnitConfig[] = [
  {
    id: 'DKC',
    name: 'DKC',
    prefix: 'D',
    fullName: 'Dewan Kerja Cabang Cilacap',
    badgeBg: '#e0edff',
    badgeText: '#185abd',
  },
  {
    id: 'CYJI',
    name: 'CYJI',
    prefix: 'C',
    fullName: 'Cilacap Youth Journalist',
    badgeBg: '#e0f2fe',
    badgeText: '#0284c7',
  },
  {
    id: 'Paspanca',
    name: 'Paspanca',
    prefix: 'PS',
    fullName: 'Pasukan Tunas Panca',
    badgeBg: '#ede9fe',
    badgeText: '#6366f1',
  },
  {
    id: 'Ubaloka',
    name: 'Ubaloka',
    prefix: 'U',
    fullName: 'Unit Bantu Pertolongan Pramuka',
    badgeBg: '#ccfbf1',
    badgeText: '#0f766e',
  },
  {
    id: 'UNPASA',
    name: 'UNPASA',
    prefix: 'P',
    fullName: 'Unit Protokol Satria',
    badgeBg: '#cffafe',
    badgeText: '#0891b2',
  },
];

export interface InventarisItem {
  rowNumber?: number;
  kodeBarang: string;
  namaBarang: string;
  unit: UnitInventaris | string;
  jumlah: string | number;
  tahun: string | number;
  sumber: string;
  kondisi: KondisiBarang | string;
  foto: string;
  keterangan: string;
  waktuInput: string;
}

export interface InventarisStats {
  totalItems: number;
  totalQuantity: number;
  byUnit: Record<string, { count: number; totalQty: number }>;
  byKondisi: Record<string, number>;
}

function getSpreadsheetId(): string {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) {
    throw new Error('GOOGLE_SHEET_ID belum dikonfigurasi di file .env');
  }
  return spreadsheetId;
}

/**
 * Normalisasi input nama unit ke id unit kanonikal
 */
export function normalisasiUnit(raw: string): UnitInventaris {
  const clean = String(raw || '').trim().toLowerCase();
  if (clean === 'dkc') return 'DKC';
  if (clean === 'cyji' || clean === 'jurnalis') return 'CYJI';
  if (clean === 'paspanca' || clean === 'pasukan tunas panca') return 'Paspanca';
  if (clean === 'ubaloka') return 'Ubaloka';
  if (clean === 'unpasa' || clean === 'protokol' || clean === 'protokoler') return 'UNPASA';
  return 'DKC';
}

/**
 * Mendapatkan prefix kode barang untuk unit tertentu
 * - DKC -> D
 * - CYJI -> C
 * - Paspanca -> PS
 * - Ubaloka -> U
 * - UNPASA -> P
 */
export function getUnitPrefix(unit: string): string {
  const norm = normalisasiUnit(unit);
  const found = DAFTAR_UNIT.find((u) => u.id === norm);
  return found ? found.prefix : 'D';
}

/**
 * Memastikan sheet 'Inventaris' sudah ada dan memiliki header kolom lengkap
 */
export async function ensureInventarisSheet(): Promise<void> {
  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = getSpreadsheetId();

  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const sheetExists = meta.data.sheets?.some(
      (s) => s.properties?.title?.toLowerCase() === SHEET_INVENTARIS.toLowerCase()
    );

    if (!sheetExists) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: SHEET_INVENTARIS,
                  gridProperties: {
                    frozenRowCount: 1,
                  },
                },
              },
            },
          ],
        },
      });

      // Beri header baris 1
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${SHEET_INVENTARIS}'!A1:J1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [HEADER_INVENTARIS],
        },
      });
      return;
    }

    // Periksa apakah baris header sudah terisi
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${SHEET_INVENTARIS}'!A1:J1`,
    });

    if (!res.data.values || res.data.values.length === 0 || !res.data.values[0] || res.data.values[0].length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${SHEET_INVENTARIS}'!A1:J1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [HEADER_INVENTARIS],
        },
      });
    }
  } catch (err) {
    console.warn('ensureInventarisSheet warning:', err);
  }
}

/**
 * Mengambil semua data barang inventaris dari Google Sheets
 */
export async function getAllInventaris(filterUnit?: string): Promise<InventarisItem[]> {
  await ensureInventarisSheet();

  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = getSpreadsheetId();

  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${SHEET_INVENTARIS}'!A2:J`,
    });

    const rows = res.data.values || [];
    const items: InventarisItem[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const [
        kodeRaw,
        namaRaw,
        unitRaw,
        jumlahRaw,
        tahunRaw,
        sumberRaw,
        kondisiRaw,
        fotoRaw,
        ketRaw,
        waktuRaw,
      ] = row;

      if (!kodeRaw && !namaRaw) continue;

      const rowUnit = normalisasiUnit(String(unitRaw || 'DKC'));

      if (filterUnit && filterUnit !== 'Semua' && normalisasiUnit(filterUnit) !== rowUnit) {
        continue;
      }

      items.push({
        rowNumber: i + 2,
        kodeBarang: String(kodeRaw || '').trim(),
        namaBarang: String(namaRaw || '').trim(),
        unit: rowUnit,
        jumlah: String(jumlahRaw || '1').trim(),
        tahun: String(tahunRaw || '-').trim(),
        sumber: String(sumberRaw || '-').trim(),
        kondisi: String(kondisiRaw || 'Baik').trim(),
        foto: String(fotoRaw || '').trim(),
        keterangan: String(ketRaw || '-').trim(),
        waktuInput: String(waktuRaw || '-').trim(),
      });
    }

    return items;
  } catch (err) {
    console.error('getAllInventaris error:', err);
    return [];
  }
}

/**
 * Menghasilkan kode barang otomatis berikutnya berdasarkan unit
 * Format:
 * - DKC: D0001, D0002, dst.
 * - CYJI: C0001, C0002, dst.
 * - Paspanca: PS0001, PS0002, dst.
 * - Ubaloka: U0001, U0002, dst.
 * - UNPASA: P0001, P0002, dst.
 */
export async function generateNextItemCode(unit: string): Promise<string> {
  const prefix = getUnitPrefix(unit);
  const allItems = await getAllInventaris();

  let maxNum = 0;
  const regex = new RegExp(`^${prefix}(\\d+)$`, 'i');

  for (const item of allItems) {
    const match = item.kodeBarang.trim().match(regex);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num > maxNum) {
        maxNum = num;
      }
    }
  }

  const nextNum = maxNum + 1;
  const padded = String(nextNum).padStart(4, '0');
  return `${prefix}${padded}`;
}

/**
 * Menambahkan barang inventaris baru ke Google Sheets
 */
export async function tambahInventaris(data: {
  namaBarang: string;
  unit: string;
  jumlah: string | number;
  tahun: string | number;
  sumber: string;
  kondisi: string;
  foto?: string;
  keterangan?: string;
  kodeBarang?: string;
}): Promise<InventarisItem> {
  await ensureInventarisSheet();

  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = getSpreadsheetId();

  const finalUnit = normalisasiUnit(data.unit);
  const finalCode = data.kodeBarang?.trim() || (await generateNextItemCode(finalUnit));

  const nowJakarta = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(new Date());

  const rowValues = [
    finalCode,
    data.namaBarang.trim(),
    finalUnit,
    String(data.jumlah || '1').trim(),
    String(data.tahun || new Date().getFullYear()).trim(),
    data.sumber?.trim() || '-',
    data.kondisi?.trim() || 'Baik',
    data.foto?.trim() || '',
    data.keterangan?.trim() || '-',
    nowJakarta,
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${SHEET_INVENTARIS}'!A:J`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [rowValues],
    },
  });

  return {
    kodeBarang: finalCode,
    namaBarang: data.namaBarang.trim(),
    unit: finalUnit,
    jumlah: data.jumlah,
    tahun: data.tahun,
    sumber: data.sumber,
    kondisi: data.kondisi,
    foto: data.foto || '',
    keterangan: data.keterangan || '-',
    waktuInput: nowJakarta,
  };
}

/**
 * Memperbarui link foto barang di Google Sheets
 */
export async function updateFotoInventaris(kodeBarang: string, fotoUrl: string): Promise<boolean> {
  await ensureInventarisSheet();

  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = getSpreadsheetId();

  const items = await getAllInventaris();
  const found = items.find((it) => it.kodeBarang.toLowerCase() === kodeBarang.trim().toLowerCase());

  if (!found || !found.rowNumber) {
    return false;
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${SHEET_INVENTARIS}'!H${found.rowNumber}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[fotoUrl]],
    },
  });

  return true;
}

/**
 * Mengambil ringkasan statistik inventaris
 */
export async function getInventarisStats(): Promise<InventarisStats> {
  const items = await getAllInventaris();

  const stats: InventarisStats = {
    totalItems: items.length,
    totalQuantity: 0,
    byUnit: {},
    byKondisi: {
      Baik: 0,
      'Rusak Ringan': 0,
      'Rusak Berat': 0,
      Hilang: 0,
    },
  };

  for (const u of DAFTAR_UNIT) {
    stats.byUnit[u.id] = { count: 0, totalQty: 0 };
  }

  for (const it of items) {
    const rawQty = parseInt(String(it.jumlah).replace(/[^0-9]/g, ''), 10) || 1;
    stats.totalQuantity += rawQty;

    const u = it.unit;
    if (!stats.byUnit[u]) {
      stats.byUnit[u] = { count: 0, totalQty: 0 };
    }
    stats.byUnit[u].count += 1;
    stats.byUnit[u].totalQty += rawQty;

    const k = it.kondisi || 'Baik';
    stats.byKondisi[k] = (stats.byKondisi[k] || 0) + 1;
  }

  return stats;
}

/**
 * Mencari barang berdasarkan kode atau kata kunci nama barang
 */
export async function cariInventaris(query: string): Promise<InventarisItem[]> {
  const items = await getAllInventaris();
  const q = query.trim().toLowerCase();

  if (!q) return items;

  return items.filter((it) => {
    return (
      it.kodeBarang.toLowerCase().includes(q) ||
      it.namaBarang.toLowerCase().includes(q) ||
      it.unit.toLowerCase().includes(q) ||
      it.sumber.toLowerCase().includes(q) ||
      it.keterangan.toLowerCase().includes(q) ||
      String(it.tahun).includes(q)
    );
  });
}
