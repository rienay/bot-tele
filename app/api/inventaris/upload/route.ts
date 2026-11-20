import { NextResponse } from 'next/server';
import { uploadReceiptToDrive } from '@/lib/googleDrive';
import { formatDriveImageUrl } from '@/lib/inventaris';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const unit = ((formData.get('unit') as string) || 'DKC').trim();

    if (!file) {
      return NextResponse.json(
        { success: false, error: 'File gambar tidak ditemukan.' },
        { status: 400 }
      );
    }

    if (!file.type.startsWith('image/')) {
      return NextResponse.json(
        { success: false, error: 'Format berkas harus berupa gambar (JPG, PNG, atau WEBP).' },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const safeUnit = unit.toLowerCase().replace(/[^a-z0-9]/g, '');
    const fileName = `inventaris_${safeUnit || 'barang'}_${Date.now()}.jpg`;

    // Unggah ke Google Drive menggunakan Webhook GAS / Service Account
    const driveUrl = await uploadReceiptToDrive(buffer, fileName, file.type || 'image/jpeg');

    if (!driveUrl) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Gagal mengunggah foto ke Google Drive. Pastikan konfigurasi Google Drive (Webhook GAS atau Service Account) aktif.',
        },
        { status: 500 }
      );
    }

    const displayUrl = formatDriveImageUrl(driveUrl);

    return NextResponse.json({
      success: true,
      url: driveUrl,
      displayUrl,
      fileName,
    });
  } catch (error: any) {
    console.error('Error uploading inventaris photo:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Terjadi kesalahan internal saat mengunggah foto' },
      { status: 500 }
    );
  }
}
