import { NextResponse } from 'next/server';
import { resolveRoleByAccessCode } from '@/lib/webAuth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const code = String(body?.code || '').trim();
    const displayName = String(body?.name || '').trim();

    if (!code) {
      return NextResponse.json(
        { success: false, error: 'Masukkan kode akses terlebih dahulu.' },
        { status: 400 }
      );
    }

    const roleConfig = resolveRoleByAccessCode(code);
    if (!roleConfig) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Kode akses tidak dikenali. Gunakan kode sesuai bagian: bendahara, dkc, cyber, paspanca, ubaloka, atau unpasa.',
        },
        { status: 401 }
      );
    }

    return NextResponse.json({
      success: true,
      session: {
        role: roleConfig.key,
        userName: displayName || roleConfig.shortLabel,
        config: roleConfig,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Gagal memproses login.' },
      { status: 500 }
    );
  }
}
