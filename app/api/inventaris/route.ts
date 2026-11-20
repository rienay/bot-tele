import { NextResponse } from 'next/server';
import {
  getAllInventaris,
  getInventarisStats,
  tambahInventaris,
  DAFTAR_UNIT,
  normalisasiUnit,
} from '@/lib/inventaris';

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
    const body = await request.json();
    const { namaBarang, unit, jumlah, tahun, sumber, kondisi, foto, keterangan } = body;

    if (!namaBarang || !namaBarang.trim()) {
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
