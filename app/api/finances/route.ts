import { NextResponse } from 'next/server';
import { getAllTransactionsForWeb } from '@/lib/googleSheets';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const book = searchParams.get('book') || 'Semua';
    const data = await getAllTransactionsForWeb(book);
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    console.error('Error fetching web finances:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Gagal memuat data keuangan' },
      { status: 500 }
    );
  }
}
