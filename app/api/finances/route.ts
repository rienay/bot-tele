import { NextResponse } from 'next/server';
import {
  getAllTransactionsForWeb,
  appendTransaction,
  createSheetBook,
  transferBookBalance,
} from '@/lib/googleSheets';
import { uploadReceiptToDrive } from '@/lib/googleDrive';
import { parseReceiptImage, getLocalTodayDateString } from '@/lib/gemini';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const action = String(formData.get('action') || 'add_transaction');
      const book = String(formData.get('book') || 'Kas').trim() || 'Kas';
      const file = formData.get('file') as File | null;
      const caption = String(formData.get('caption') || '').trim();

      if (action === 'scan_receipt' && file && file.size > 0) {
        const buffer = Buffer.from(await file.arrayBuffer());
        const fileName = `nota_web_${Date.now()}.jpg`;
        const [noteLink, parsed] = await Promise.all([
          uploadReceiptToDrive(buffer, fileName, file.type || 'image/jpeg').catch(() => ''),
          parseReceiptImage(buffer, file.type || 'image/jpeg', caption),
        ]);

        if (!parsed) {
          return NextResponse.json(
            { success: false, error: 'AI tidak dapat membaca nominal transaksi dari foto nota.' },
            { status: 400 }
          );
        }

        const rowNum = await appendTransaction(
          {
            ...parsed,
            noteLink: noteLink || '-',
          },
          book
        );

        return NextResponse.json({
          success: true,
          message: 'Nota berhasil dipindai & dicatat.',
          transaction: { ...parsed, noteLink },
          rowNumber: rowNum,
          book,
        });
      }

      // Manual transaction with optional receipt image
      const type = (String(formData.get('type') || 'Pengeluaran') === 'Pemasukan'
        ? 'Pemasukan'
        : 'Pengeluaran') as 'Pemasukan' | 'Pengeluaran';
      const amount = Number(formData.get('amount') || 0);
      const category = String(formData.get('category') || 'Lain-lain').trim();
      const description = String(formData.get('description') || '').trim();
      const date = String(formData.get('date') || getLocalTodayDateString()).trim();

      if (!amount || amount <= 0 || !description) {
        return NextResponse.json(
          { success: false, error: 'Nominal dan keterangan wajib diisi.' },
          { status: 400 }
        );
      }

      let noteLink = '-';
      if (file && file.size > 0) {
        const buffer = Buffer.from(await file.arrayBuffer());
        const fileName = `nota_web_${Date.now()}.jpg`;
        noteLink = (await uploadReceiptToDrive(buffer, fileName, file.type || 'image/jpeg').catch(() => '-')) || '-';
      }

      const rowNum = await appendTransaction(
        { type, amount, category, description, date, noteLink },
        book
      );

      return NextResponse.json({
        success: true,
        message: 'Transaksi berhasil dicatat.',
        rowNumber: rowNum,
        book,
      });
    }

    const body = await request.json();
    const action = body?.action || 'add_transaction';

    if (action === 'create_book') {
      const name = String(body?.name || '').trim();
      if (!name) {
        return NextResponse.json({ success: false, error: 'Nama pos/buku wajib diisi.' }, { status: 400 });
      }
      const res = await createSheetBook(name);
      return NextResponse.json({
        success: true,
        created: res.created,
        bookName: res.bookName,
        message: res.created ? `Pos "${res.bookName}" berhasil dibuat.` : `Pos "${res.bookName}" sudah ada.`,
      });
    }

    if (action === 'transfer') {
      const sourceBook = String(body?.sourceBook || '').trim();
      const targetBook = String(body?.targetBook || '').trim();
      const amount = Number(body?.amount || 0);
      const description = String(body?.description || '').trim();

      if (!sourceBook || !targetBook || !amount || amount <= 0) {
        return NextResponse.json(
          { success: false, error: 'Buku asal, buku tujuan, dan nominal wajib diisi.' },
          { status: 400 }
        );
      }

      const result = await transferBookBalance({ sourceBook, targetBook, amount, description });
      return NextResponse.json({
        success: true,
        result,
        message: `Berhasil memindahkan Rp${amount.toLocaleString('id-ID')} dari ${result.sourceBook} ke ${result.targetBook}.`,
      });
    }

    // Default: add_transaction
    const book = String(body?.book || 'Kas').trim() || 'Kas';
    const type = body?.type === 'Pemasukan' ? 'Pemasukan' : 'Pengeluaran';
    const amount = Number(body?.amount || 0);
    const category = String(body?.category || 'Lain-lain').trim();
    const description = String(body?.description || '').trim();
    const date = String(body?.date || getLocalTodayDateString()).trim();
    const noteLink = String(body?.noteLink || '-').trim() || '-';

    if (!amount || amount <= 0 || !description) {
      return NextResponse.json(
        { success: false, error: 'Nominal dan keterangan wajib diisi.' },
        { status: 400 }
      );
    }

    const rowNumber = await appendTransaction(
      { type, amount, category, description, date, noteLink },
      book
    );

    return NextResponse.json({
      success: true,
      message: 'Transaksi berhasil dicatat.',
      rowNumber,
      book,
    });
  } catch (error: any) {
    console.error('Error in POST /api/finances:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Gagal memproses permintaan keuangan.' },
      { status: 500 }
    );
  }
}
