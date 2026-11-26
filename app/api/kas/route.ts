import { NextResponse } from 'next/server';
import {
  getDaftarAnggota,
  tambahAnggota,
  ubahStatusAnggota,
  catatPembayaranKas,
  cekStatusKasBulan,
  DAFTAR_BULAN,
  NOMINAL_IURAN_DEFAULT,
} from '@/lib/kasAnggota';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const now = new Date();
    const defaultBulan = DAFTAR_BULAN[now.getMonth()];
    const bulan = searchParams.get('bulan') || defaultBulan;
    const tahun = parseInt(searchParams.get('tahun') || String(now.getFullYear()), 10) || now.getFullYear();

    const [anggota, statusBulan] = await Promise.all([
      getDaftarAnggota(false),
      cekStatusKasBulan(bulan, tahun),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        anggota,
        statusBulan,
        nominalDefault: NOMINAL_IURAN_DEFAULT,
        daftarBulan: DAFTAR_BULAN,
      },
    });
  } catch (error: any) {
    console.error('Error GET /api/kas:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Gagal memuat data kas anggota.' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const action = body?.action;

    if (action === 'bayar') {
      const nama = String(body?.nama || '').trim();
      const bulan = String(body?.bulan || '').trim();
      const tahun = Number(body?.tahun || new Date().getFullYear());
      const nominal = Number(body?.nominal || NOMINAL_IURAN_DEFAULT);
      const keterangan = String(body?.keterangan || '-').trim();

      if (!nama || !bulan) {
        return NextResponse.json(
          { success: false, error: 'Nama anggota dan bulan wajib diisi.' },
          { status: 400 }
        );
      }

      const res = await catatPembayaranKas(nama, bulan, tahun, nominal, keterangan);
      return NextResponse.json(res, { status: res.success ? 200 : 400 });
    }

    if (action === 'tambah_anggota') {
      const nama = String(body?.nama || '').trim();
      const jabatan = String(body?.jabatan || 'Anggota').trim();
      const tahunMasuk = String(body?.tahunMasuk || new Date().getFullYear()).trim();

      if (!nama) {
        return NextResponse.json({ success: false, error: 'Nama anggota wajib diisi.' }, { status: 400 });
      }

      const res = await tambahAnggota(nama, jabatan, tahunMasuk);
      return NextResponse.json(res, { status: res.success ? 200 : 400 });
    }

    if (action === 'ubah_status') {
      const nama = String(body?.nama || '').trim();
      const status = body?.status === 'Nonaktif' ? 'Nonaktif' : 'Aktif';
      if (!nama) {
        return NextResponse.json({ success: false, error: 'Nama anggota wajib diisi.' }, { status: 400 });
      }
      const ok = await ubahStatusAnggota(nama, status);
      return NextResponse.json({
        success: ok,
        message: ok ? `Status "${nama}" diubah menjadi ${status}.` : `Anggota "${nama}" tidak ditemukan.`,
      });
    }

    return NextResponse.json({ success: false, error: 'Aksi tidak dikenal.' }, { status: 400 });
  } catch (error: any) {
    console.error('Error POST /api/kas:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Gagal memproses kas anggota.' },
      { status: 500 }
    );
  }
}
