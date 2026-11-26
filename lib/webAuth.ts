export type WebRoleKey = 'bendahara' | 'dkc' | 'cyber' | 'paspanca' | 'ubaloka' | 'unpasa';

export interface RoleTheme {
  id: string;
  primary: string;
  primaryDark: string;
  primarySoft: string;
  border: string;
  bgPage: string;
  textHeadline: string;
  badgeBg: string;
  badgeText: string;
}

export interface WebRolePermissions {
  finance: boolean;
  kas: boolean;
  inventaris: boolean;
  surat: boolean;
  unitOnly: 'CYJI' | 'Paspanca' | 'Ubaloka' | 'UNPASA' | null;
}

export interface WebRoleConfig {
  key: WebRoleKey;
  label: string;
  shortLabel: string;
  subtitle: string;
  theme: RoleTheme;
  permissions: WebRolePermissions;
}

export const WEB_ROLES: Record<WebRoleKey, WebRoleConfig> = {
  bendahara: {
    key: 'bendahara',
    label: 'Bendahara',
    shortLabel: 'Bendahara',
    subtitle: 'Semua fitur keuangan, kas anggota & rekap pos',
    theme: {
      id: 'blue',
      primary: '#1D4ED8',
      primaryDark: '#1E40AF',
      primarySoft: '#EFF6FF',
      border: '#BFDBFE',
      bgPage: '#F8FAFC',
      textHeadline: '#0F172A',
      badgeBg: '#DBEAFE',
      badgeText: '#1E40AF',
    },
    permissions: {
      finance: true,
      kas: true,
      inventaris: false,
      surat: false,
      unitOnly: null,
    },
  },
  dkc: {
    key: 'dkc',
    label: 'DKC Cilacap',
    shortLabel: 'DKC',
    subtitle: 'Inventaris semua unit & arsip persuratan',
    theme: {
      id: 'green',
      primary: '#15803D',
      primaryDark: '#166534',
      primarySoft: '#F0FDF4',
      border: '#BBF7D0',
      bgPage: '#F7FBF8',
      textHeadline: '#052E16',
      badgeBg: '#DCFCE7',
      badgeText: '#166534',
    },
    permissions: {
      finance: false,
      kas: false,
      inventaris: true,
      surat: true,
      unitOnly: null,
    },
  },
  cyber: {
    key: 'cyber',
    label: 'Unit Cyber (CYJI)',
    shortLabel: 'Cyber',
    subtitle: 'Inventaris & asisten khusus unit Cyber / CYJI',
    theme: {
      id: 'navy',
      primary: '#1E3A8A',
      primaryDark: '#172554',
      primarySoft: '#EFF6FF',
      border: '#93C5FD',
      bgPage: '#F1F5F9',
      textHeadline: '#0F172A',
      badgeBg: '#DBEAFE',
      badgeText: '#172554',
    },
    permissions: {
      finance: false,
      kas: false,
      inventaris: true,
      surat: false,
      unitOnly: 'CYJI',
    },
  },
  paspanca: {
    key: 'paspanca',
    label: 'Unit Paspanca',
    shortLabel: 'Paspanca',
    subtitle: 'Inventaris & asisten khusus unit Paspanca',
    theme: {
      id: 'red',
      primary: '#DC2626',
      primaryDark: '#B91C1C',
      primarySoft: '#FEF2F2',
      border: '#FECACA',
      bgPage: '#FFF9F9',
      textHeadline: '#450A0A',
      badgeBg: '#FEE2E2',
      badgeText: '#991B1B',
    },
    permissions: {
      finance: false,
      kas: false,
      inventaris: true,
      surat: false,
      unitOnly: 'Paspanca',
    },
  },
  ubaloka: {
    key: 'ubaloka',
    label: 'Unit Ubaloka',
    shortLabel: 'Ubaloka',
    subtitle: 'Inventaris & asisten khusus unit Ubaloka',
    theme: {
      id: 'orange',
      primary: '#EA580C',
      primaryDark: '#C2410C',
      primarySoft: '#FFF7ED',
      border: '#FED7AA',
      bgPage: '#FFFBF7',
      textHeadline: '#431407',
      badgeBg: '#FFEDD5',
      badgeText: '#9A3412',
    },
    permissions: {
      finance: false,
      kas: false,
      inventaris: true,
      surat: false,
      unitOnly: 'Ubaloka',
    },
  },
  unpasa: {
    key: 'unpasa',
    label: 'Unit UNPASA',
    shortLabel: 'UNPASA',
    subtitle: 'Inventaris & asisten khusus unit UNPASA',
    theme: {
      id: 'yellow',
      primary: '#CA8A04',
      primaryDark: '#A16207',
      primarySoft: '#FEFCE8',
      border: '#FDE047',
      bgPage: '#FEFDF5',
      textHeadline: '#422006',
      badgeBg: '#FEF08A',
      badgeText: '#854D0E',
    },
    permissions: {
      finance: false,
      kas: false,
      inventaris: true,
      surat: false,
      unitOnly: 'UNPASA',
    },
  },
};

export function resolveRoleByAccessCode(rawCode: string): WebRoleConfig | null {
  const code = String(rawCode || '').trim().toLowerCase();
  if (!code) return null;

  const envMap: Record<WebRoleKey, string[]> = {
    bendahara: (process.env.WEB_ACCESS_BENDAHARA || 'bendahara').split(','),
    dkc: (process.env.WEB_ACCESS_DKC || 'dkc').split(','),
    cyber: (process.env.WEB_ACCESS_CYBER || 'cyber,cyji').split(','),
    paspanca: (process.env.WEB_ACCESS_PASPANCA || 'paspanca').split(','),
    ubaloka: (process.env.WEB_ACCESS_UBALOKA || 'ubaloka').split(','),
    unpasa: (process.env.WEB_ACCESS_UNPASA || 'unpasa').split(','),
  };

  for (const key of Object.keys(envMap) as WebRoleKey[]) {
    const validCodes = envMap[key].map((c) => c.trim().toLowerCase()).filter(Boolean);
    if (validCodes.includes(code)) {
      return WEB_ROLES[key];
    }
  }

  return null;
}

export function getRoleConfig(roleKey: string | null | undefined): WebRoleConfig | null {
  if (!roleKey) return null;
  const k = roleKey.toLowerCase() as WebRoleKey;
  return WEB_ROLES[k] || null;
}
