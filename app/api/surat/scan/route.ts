import { NextResponse } from 'next/server';
import { uploadReceiptToDrive } from '@/lib/googleDrive';
import { parseDocumentSurat } from '@/lib/gemini';
import { formatDriveImageUrl } from '@/lib/inventaris';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const caption = (formData.get('caption') as string) || '';

    if (!file) {
      return NextResponse.json(
        { success: false, error: 'Berkas dokumen atau foto tidak ditemukan.' },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const mimeType = file.type || 'application/pdf';
    const fileName = file.name || `surat_${Date.now()}.pdf`;

    // 1. Eksekusi Upload ke Google Drive & Analisis AI Gemini secara paralel
    const ext = fileName.split('.').pop() || 'pdf';
    const driveFileName = `surat_dkc_${Date.now()}.${ext}`;

    const [driveUrl, parsedSurat] = await Promise.all([
      uploadReceiptToDrive(buffer, driveFileName, mimeType).catch((err) => {
        console.error('Gagal upload ke Google Drive:', err);
        return null;
      }),
      parseDocumentSurat(buffer, mimeType, fileName, caption).catch((err) => {
        console.error('Gagal analisis dokumen dengan Gemini:', err);
        return null;
      }),
    ]);

    const displayUrl = driveUrl ? formatDriveImageUrl(driveUrl) : '';

    return NextResponse.json({
      success: true,
      fileUrl: driveUrl || '',
      displayUrl,
      fileName,
      parsed: parsedSurat,
    });
  } catch (error: any) {
    console.error('Error scanning surat:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Terjadi kesalahan saat memproses berkas surat' },
      { status: 500 }
    );
  }
}
