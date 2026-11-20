import { NextResponse } from 'next/server';
import {
  getAllInventaris,
  getInventarisStats,
  tambahInventaris,
  DAFTAR_UNIT,
  normalisasiUnit,
} from '@/lib/inventaris';
import { uploadReceiptToDrive } from '@/lib/googleDrive';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const unitParam = searchParams.get('unit') || 'Semua';
    const kondisiParam = searchParams.get('kondisi') || 'Semua';
    const searchParam = searchParams.get('search')?.trim().toLowerCase() || '';

    const [allItems, stats] = await Promise.all([
      getAllInventaris(),
      getInventarisStats(),
    ]);

    let filtered = allItems;

    // Filter Unit
    if (unitParam !== 'Semua') {
      const normUnit = normalisasiUnit(unitParam);
      filtered = filtered.filter((it) => it.unit === normUnit);
    }

    // Filter Kondisi
    if (kondisiParam !== 'Semua') {
      filtered = filtered.filter(
        (it) => it.kondisi.toLowerCase() === kondisiParam.toLowerCase()
      );
    }

    // Filter Search
    if (searchParam) {
      filtered = filtered.filter((it) => {
        return (
          it.kodeBarang.toLowerCase().includes(searchParam) ||
          it.namaBarang.toLowerCase().includes(searchParam) ||
          it.unit.toLowerCase().includes(searchParam) ||
          it.sumber.toLowerCase().includes(searchParam) ||
          it.keterangan.toLowerCase().includes(searchParam) ||
          String(it.tahun).includes(searchParam)
        );
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        items: filtered,
        stats,
        units: DAFTAR_UNIT,
        totalFiltered: filtered.length,
      },
    });
  } catch (error: any) {
    console.error('Error fetching inventaris:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Gagal memuat data inventaris' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get('content-type') || '';
    let namaBarang = '';
    let unit = 'DKC';
    let jumlah: any = '1';
    let tahun: any = new Date().getFullYear();
    let sumber = 'Pembelian Kas';
    let kondisi = 'Baik';
    let foto = '';
    let keterangan = '-';

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      namaBarang = (formData.get('namaBarang') as string) || '';
      unit = (formData.get('unit') as string) || 'DKC';
      jumlah = formData.get('jumlah') || '1';
      tahun = formData.get('tahun') || new Date().getFullYear();
      sumber = (formData.get('sumber') as string) || 'Pembelian Kas';
      kondisi = (formData.get('kondisi') as string) || 'Baik';
      foto = (formData.get('foto') as string) || '';
      keterangan = (formData.get('keterangan') as string) || '-';

      // Jika ada file gambar yang dikirim langsung di FormData
      const file = formData.get('file') as File | null;
      if (file && file.size > 0 && file.type.startsWith('image/')) {
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const safeUnit = String(unit).toLowerCase().replace(/[^a-z0-9]/g, '');
        const fileName = `inventaris_${safeUnit || 'barang'}_${Date.now()}.jpg`;
        const uploadedUrl = await uploadReceiptToDrive(buffer, fileName, file.type);
        if (uploadedUrl) {
          foto = uploadedUrl;
        }
      }
    } else {
      const body = await request.json();
      namaBarang = body.namaBarang;
      unit = body.unit || 'DKC';
      jumlah = body.jumlah || '1';
      tahun = body.tahun || new Date().getFullYear();
      sumber = body.sumber || 'Pembelian Kas';
      kondisi = body.kondisi || 'Baik';
      foto = body.foto || '';
      keterangan = body.keterangan || '-';
    }

    if (!namaBarang || !String(namaBarang).trim()) {
      return NextResponse.json(
        { success: false, error: 'Nama barang wajib diisi.' },
        { status: 400 }
      );
    }

    const newItem = await tambahInventaris({
      namaBarang: String(namaBarang).trim(),
      unit: String(unit || 'DKC').trim(),
      jumlah: jumlah || '1',
      tahun: tahun || new Date().getFullYear(),
      sumber: sumber || 'Pembelian Kas',
      kondisi: kondisi || 'Baik',
      foto: foto || '',
      keterangan: keterangan || '-',
    });

    return NextResponse.json({
      success: true,
      message: 'Barang inventaris berhasil dicatat.',
      item: newItem,
    });
  } catch (error: any) {
    console.error('Error adding inventaris:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Gagal menambahkan barang inventaris' },
      { status: 500 }
    );
  }
}
