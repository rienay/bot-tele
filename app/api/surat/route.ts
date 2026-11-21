import { NextResponse } from 'next/server';
import {
  getAllSurat,
  getSuratStats,
  tambahSurat,
  JenisSurat,
} from '@/lib/surat';
import { uploadReceiptToDrive } from '@/lib/googleDrive';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const jenisParam = searchParams.get('jenis') || 'Semua';
    const kategoriParam = searchParams.get('kategori') || 'Semua';
    const sifatParam = searchParams.get('sifat') || 'Semua';
    const tahunParam = searchParams.get('tahun') || 'Semua';
    const searchParam = searchParams.get('search')?.trim().toLowerCase() || '';

    const [allItems, stats] = await Promise.all([
      getAllSurat(),
      getSuratStats(),
    ]);

    let filtered = allItems;

    // Filter Jenis (Surat Masuk / Surat Keluar)
    if (jenisParam !== 'Semua') {
      filtered = filtered.filter(
        (it) => it.jenis.toLowerCase() === jenisParam.toLowerCase()
      );
    }

    // Filter Kategori
    if (kategoriParam !== 'Semua') {
      filtered = filtered.filter(
        (it) => it.kategori.toLowerCase() === kategoriParam.toLowerCase()
      );
    }

    // Filter Sifat
    if (sifatParam !== 'Semua') {
      filtered = filtered.filter(
        (it) => it.sifat.toLowerCase() === sifatParam.toLowerCase()
      );
    }

    // Filter Tahun
    if (tahunParam !== 'Semua') {
      filtered = filtered.filter((it) => {
        const d = it.tanggalSurat || it.tanggalDiterima || '';
        return d.startsWith(tahunParam);
      });
    }

    // Filter Pencarian Teks
    if (searchParam) {
      filtered = filtered.filter((it) => {
        return (
          it.kodeArsip.toLowerCase().includes(searchParam) ||
          it.nomorSurat.toLowerCase().includes(searchParam) ||
          it.perihal.toLowerCase().includes(searchParam) ||
          it.pengirim.toLowerCase().includes(searchParam) ||
          it.tujuan.toLowerCase().includes(searchParam) ||
          it.kategori.toLowerCase().includes(searchParam) ||
          it.ringkasan.toLowerCase().includes(searchParam)
        );
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        items: filtered,
        stats,
        totalFiltered: filtered.length,
      },
    });
  } catch (error: any) {
    console.error('Error fetching persuratan:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Gagal memuat data persuratan' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get('content-type') || '';
    let jenis: JenisSurat = 'Surat Masuk';
    let nomorSurat = '-';
    let tanggalSurat = '';
    let tanggalDiterima = '';
    let pengirim = '-';
    let tujuan = '-';
    let perihal = '';
    let kategori = 'Lain-lain';
    let sifat = 'Biasa';
    let ringkasan = '-';
    let berkas = '';
    let pic = 'Staff DKC';

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      jenis = (formData.get('jenis') as JenisSurat) || 'Surat Masuk';
      nomorSurat = (formData.get('nomorSurat') as string) || '-';
      tanggalSurat = (formData.get('tanggalSurat') as string) || '';
      tanggalDiterima = (formData.get('tanggalDiterima') as string) || '';
      pengirim = (formData.get('pengirim') as string) || '-';
      tujuan = (formData.get('tujuan') as string) || '-';
      perihal = (formData.get('perihal') as string) || '';
      kategori = (formData.get('kategori') as string) || 'Lain-lain';
      sifat = (formData.get('sifat') as string) || 'Biasa';
      ringkasan = (formData.get('ringkasan') as string) || '-';
      berkas = (formData.get('berkas') as string) || '';
      pic = (formData.get('pic') as string) || 'Staff DKC';

      const file = formData.get('file') as File | null;
      if (file && file.size > 0) {
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const prefix = jenis === 'Surat Keluar' ? 'keluar' : 'masuk';
        const ext = file.name.split('.').pop() || 'pdf';
        const fileName = `surat_${prefix}_${Date.now()}.${ext}`;

        const uploadedUrl = await uploadReceiptToDrive(buffer, fileName, file.type);
        if (uploadedUrl) {
          berkas = uploadedUrl;
        }
      }
    } else {
      const body = await request.json();
      jenis = body.jenis || 'Surat Masuk';
      nomorSurat = body.nomorSurat || '-';
      tanggalSurat = body.tanggalSurat || '';
      tanggalDiterima = body.tanggalDiterima || '';
      pengirim = body.pengirim || '-';
      tujuan = body.tujuan || '-';
      perihal = body.perihal || '';
      kategori = body.kategori || 'Lain-lain';
      sifat = body.sifat || 'Biasa';
      ringkasan = body.ringkasan || '-';
      berkas = body.berkas || '';
      pic = body.pic || 'Staff DKC';
    }

    if (!perihal || !perihal.trim()) {
      return NextResponse.json(
        { success: false, error: 'Perihal surat wajib diisi.' },
        { status: 400 }
      );
    }

    const newItem = await tambahSurat({
      jenis,
      nomorSurat: nomorSurat.trim(),
      tanggalSurat,
      tanggalDiterima,
      pengirim: pengirim.trim(),
      tujuan: tujuan.trim(),
      perihal: perihal.trim(),
      kategori,
      sifat,
      ringkasan,
      berkas,
      pic,
    });

    return NextResponse.json({
      success: true,
      message: 'Surat berhasil dicatat ke arsip persuratan DKC.',
      item: newItem,
    });
  } catch (error: any) {
    console.error('Error adding surat:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Gagal mencatat surat' },
      { status: 500 }
    );
  }
}
