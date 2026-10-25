import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth';
import { UserAccessRecord, UserAccessStatus, UserRole } from './types';

export const SHEET_AKSES_BOT = '_AksesBot';
const HEADER_AKSES_BOT = ['Telegram ID', 'Nama', 'Username', 'Role', 'Status', 'Waktu Diperbarui'];

function getSpreadsheetId(): string {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) {
    throw new Error('GOOGLE_SHEET_ID belum dikonfigurasi di file .env');
  }
  return spreadsheetId;
}

export function getAdminTelegramId(): string {
  return process.env.ADMIN_TELEGRAM_ID?.trim() || '1009092211';
}

// In-memory cache untuk daftar user akses (TTL 30 detik)
let cachedUsers: { data: Map<string, UserAccessRecord>; timestamp: number } | null = null;
const CACHE_TTL_MS = 30_000;

function formatJakartaNow(): string {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(new Date());
}

/**
 * Memastikan sheet _AksesBot sudah dibuat dengan header yang tepat.
 * Jika baru pertama kali dibuat, otomatis daftarkan Admin utama.
 */
export async function ensureUserAccessSheet(): Promise<void> {
  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = getSpreadsheetId();

  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${SHEET_AKSES_BOT}'!A1:F1`,
    });

    const values = res.data.values;
    if (!values || values.length === 0 || values[0].length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${SHEET_AKSES_BOT}'!A1:F1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [HEADER_AKSES_BOT] },
      });
      await seedDefaultAdmin();
    }
  } catch (error: any) {
    if (
      error?.message?.includes('Unable to parse range') ||
      error?.message?.includes('not found')
    ) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: { title: SHEET_AKSES_BOT },
              },
            },
          ],
        },
      });

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${SHEET_AKSES_BOT}'!A1:F1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [HEADER_AKSES_BOT] },
      });

      await seedDefaultAdmin();
    } else {
      throw error;
    }
  }
}

/**
 * Memasukkan akun Admin utama ke sheet _AksesBot jika belum ada
 */
async function seedDefaultAdmin(): Promise<void> {
  const adminId = getAdminTelegramId();
  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = getSpreadsheetId();

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${SHEET_AKSES_BOT}'!A:F`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[adminId, 'Owner / Admin', '', 'Admin', 'Aktif', formatJakartaNow()]],
    },
  });
}

/**
 * Mengambil seluruh data user akses dari sheet _AksesBot
 */
export async function getAllUsers(forceRefresh = false): Promise<UserAccessRecord[]> {
  const now = Date.now();
  if (!forceRefresh && cachedUsers && now - cachedUsers.timestamp < CACHE_TTL_MS) {
    return Array.from(cachedUsers.data.values());
  }

  await ensureUserAccessSheet();
  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = getSpreadsheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${SHEET_AKSES_BOT}'!A2:F`,
  });

  const rows = res.data.values || [];
  const userMap = new Map<string, UserAccessRecord>();

  // Selalu sertakan Admin dari konfigurasi sebagai basis
  const adminId = getAdminTelegramId();
  userMap.set(adminId, {
    id: adminId,
    name: 'Owner / Admin',
    username: '',
    role: 'Admin',
    status: 'Aktif',
    addedAt: formatJakartaNow(),
  });

  for (const r of rows) {
    if (!r[0]) continue;
    const id = String(r[0]).trim();
    const name = String(r[1] || 'Pengguna').trim();
    const username = String(r[2] || '').trim();
    const role = (String(r[3] || 'Member').trim() as UserRole) || 'Member';
    const status = (String(r[4] || 'Aktif').trim() as UserAccessStatus) || 'Aktif';
    const addedAt = String(r[5] || '').trim();

    userMap.set(id, {
      id,
      name,
      username,
      role: id === adminId ? 'Admin' : role,
      status,
      addedAt,
    });
  }

  // Juga periksa jika ada ALLOWED_TELEGRAM_USER_IDS di environment variable
  const envAllowed = process.env.ALLOWED_TELEGRAM_USER_IDS;
  if (envAllowed && envAllowed.trim() !== '') {
    const list = envAllowed.split(',').map((id) => id.trim());
    for (const envId of list) {
      if (envId && !userMap.has(envId)) {
        userMap.set(envId, {
          id: envId,
          name: 'Whitelist Env',
          username: '',
          role: 'Member',
          status: 'Aktif',
          addedAt: formatJakartaNow(),
        });
      }
    }
  }

  cachedUsers = { data: userMap, timestamp: now };
  return Array.from(userMap.values());
}

/**
 * Cek apakah seorang user adalah Admin
 */
export async function isUserAdmin(telegramId: number | string): Promise<boolean> {
  const strId = String(telegramId).trim();
  if (strId === getAdminTelegramId()) return true;

  const users = await getAllUsers();
  const user = users.find((u) => u.id === strId);
  return user?.role === 'Admin' && user?.status === 'Aktif';
}

/**
 * Cek status akses user: 'Aktif' | 'Menunggu' | 'Ditolak' | 'Nonaktif' | 'Belum_Ada'
 */
export async function checkUserAccess(
  telegramId: number | string
): Promise<UserAccessStatus | 'Belum_Ada'> {
  const strId = String(telegramId).trim();
  if (strId === getAdminTelegramId()) return 'Aktif';

  const users = await getAllUsers();
  const user = users.find((u) => u.id === strId);
  if (!user) return 'Belum_Ada';

  return user.status;
}

/**
 * Mendaftarkan permintaan akses baru (Status: 'Menunggu')
 */
export async function registerUserRequest(
  id: string | number,
  name: string,
  username: string
): Promise<void> {
  const strId = String(id).trim();
  await ensureUserAccessSheet();

  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = getSpreadsheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${SHEET_AKSES_BOT}'!A2:F`,
  });

  const rows = res.data.values || [];
  let existingIndex = -1;

  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] && String(rows[i][0]).trim() === strId) {
      existingIndex = i + 2;
      break;
    }
  }

  const nowJakarta = formatJakartaNow();

  if (existingIndex > 0) {
    // Update data jika sebelumnya ditolak / belum aktif
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${SHEET_AKSES_BOT}'!B${existingIndex}:F${existingIndex}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[name, username, 'Member', 'Menunggu', nowJakarta]],
      },
    });
  } else {
    // Tambah baris baru
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `'${SHEET_AKSES_BOT}'!A:F`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [[strId, name, username, 'Member', 'Menunggu', nowJakarta]],
      },
    });
  }

  cachedUsers = null;
}

/**
 * Menyetujui akses user (Status: 'Aktif')
 */
export async function approveUser(
  id: string | number,
  name?: string,
  username?: string,
  role: UserRole = 'Member'
): Promise<void> {
  const strId = String(id).trim();
  await ensureUserAccessSheet();

  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = getSpreadsheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${SHEET_AKSES_BOT}'!A2:F`,
  });

  const rows = res.data.values || [];
  let existingIndex = -1;
  let oldName = name || 'Pengguna';
  let oldUsername = username || '';

  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] && String(rows[i][0]).trim() === strId) {
      existingIndex = i + 2;
      oldName = name || String(rows[i][1] || oldName);
      oldUsername = username || String(rows[i][2] || oldUsername);
      break;
    }
  }

  const nowJakarta = formatJakartaNow();

  if (existingIndex > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${SHEET_AKSES_BOT}'!B${existingIndex}:F${existingIndex}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[oldName, oldUsername, role, 'Aktif', nowJakarta]],
      },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `'${SHEET_AKSES_BOT}'!A:F`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [[strId, oldName, oldUsername, role, 'Aktif', nowJakarta]],
      },
    });
  }

  cachedUsers = null;
}

/**
 * Menolak permintaan akses user (Status: 'Ditolak')
 */
export async function rejectUser(id: string | number): Promise<void> {
  const strId = String(id).trim();
  await ensureUserAccessSheet();

  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = getSpreadsheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${SHEET_AKSES_BOT}'!A2:F`,
  });

  const rows = res.data.values || [];
  let existingIndex = -1;

  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] && String(rows[i][0]).trim() === strId) {
      existingIndex = i + 2;
      break;
    }
  }

  const nowJakarta = formatJakartaNow();

  if (existingIndex > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${SHEET_AKSES_BOT}'!E${existingIndex}:F${existingIndex}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [['Ditolak', nowJakarta]],
      },
    });
  }

  cachedUsers = null;
}

/**
 * Mencabut atau menonaktifkan akses user (Status: 'Nonaktif')
 */
export async function revokeUser(id: string | number): Promise<boolean> {
  const strId = String(id).trim();
  if (strId === getAdminTelegramId()) {
    throw new Error('Akses Admin utama tidak dapat dicabut.');
  }

  await ensureUserAccessSheet();
  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = getSpreadsheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${SHEET_AKSES_BOT}'!A2:F`,
  });

  const rows = res.data.values || [];
  let existingIndex = -1;

  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] && String(rows[i][0]).trim() === strId) {
      existingIndex = i + 2;
      break;
    }
  }

  if (existingIndex <= 0) return false;

  const nowJakarta = formatJakartaNow();
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${SHEET_AKSES_BOT}'!E${existingIndex}:F${existingIndex}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [['Nonaktif', nowJakarta]],
    },
  });

  cachedUsers = null;
  return true;
}

/**
 * Mengambil record detail satu user berdasarkan Telegram ID
 */
export async function getUserRecord(id: string | number): Promise<UserAccessRecord | null> {
  const strId = String(id).trim();
  const users = await getAllUsers();
  return users.find((u) => u.id === strId) || null;
}
