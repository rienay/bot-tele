import { NextResponse } from 'next/server';
import { uploadReceiptToDrive } from '@/lib/googleDrive';
import { parseMultipleDocumentsSurat, SuratFileInput } from '@/lib/gemini';
import { formatDriveImageUrl } from '@/lib/inventaris';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const files = formData.getAll('files') as File[];
    const singleFile = formData.get('file') as File | null;
    const caption = (formData.get('caption') as string) || '';

    const allFiles: File[] = files.length > 0 ? files : singleFile ? [singleFile] : [];

    if (allFiles.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Berkas dokumen atau foto tidak ditemukan.' },
        { status: 400 }
      );
    }

    const timestamp = Date.now();
    const preparedFiles: SuratFileInput[] = [];

    for (let i = 0; i < allFiles.length; i++) {
      const f = allFiles[i];
      const arrayBuffer = await f.arrayBuffer();
      preparedFiles.push({
        buffer: Buffer.from(arrayBuffer),
        mimeType: f.type || 'application/pdf',
        fileName: f.name || `surat_${timestamp}_hal${i + 1}.pdf`,
      });
    }

    // 1. Eksekusi Upload ke Google Drive & Analisis AI Gemini secara paralel
    const uploadPromises = preparedFiles.map((f, i) => {
      const ext = (f.fileName || 'file.pdf').split('.').pop() || 'jpg';
      const driveFileName = `surat_dkc_${timestamp}_hal${i + 1}.${ext}`;
      return uploadReceiptToDrive(f.buffer, driveFileName, f.mimeType).catch((err) => {
        console.error(`Gagal upload berkas ${i + 1} ke Drive:`, err);
        return null;
      });
    });

    const aiPromise = parseMultipleDocumentsSurat(preparedFiles, caption).catch((err) => {
      console.error('Gagal analisis dokumen dengan Gemini:', err);
      return null;
    });

    const [driveUrls, parsedSurat] = await Promise.all([
      Promise.all(uploadPromises),
      aiPromise,
    ]);

    const validUrls = driveUrls.filter((u): u is string => Boolean(u));
    const firstUrl = validUrls[0] || '';
    const displayUrl = firstUrl ? formatDriveImageUrl(firstUrl) : '';

    return NextResponse.json({
      success: true,
      fileUrls: validUrls,
      fileUrl: validUrls.join('\n'),
      displayUrl,
      fileCount: validUrls.length,
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
