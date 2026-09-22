import { GoogleGenerativeAI } from '@google/generative-ai';
import { ParsedTransaction } from './types';

function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY belum dikonfigurasi di file .env');
  }
  return new GoogleGenerativeAI(apiKey);
}

// Format tanggal ke YYYY-MM-DD sesuai zona waktu lokal (Asia/Jakarta)
export function getLocalTodayDateString(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * Ekstraksi transaksi dari pesan teks bahasa natural
 */
export async function parseTextMessage(
  text: string,
  referenceDate: Date = new Date()
): Promise<ParsedTransaction | null> {
  const genAI = getGeminiClient();
  // Gunakan gemini-2.5-flash jika tersedia, atau gemini-1.5-flash / gemini-2.0-flash
  const model = genAI.getGenerativeModel({
    model: 'gemini-3.6-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.1,
    },
  });

  const todayStr = getLocalTodayDateString(referenceDate);

  const prompt = `Kamu adalah asisten keuangan pribadi yang sangat pintar dalam menganalisis catatan keuangan dalam Bahasa Indonesia.
Tanggal referensi hari ini adalah: ${todayStr} (Zona Waktu: Asia/Jakarta).

Tugasmu adalah menganalisis pesan dari pengguna dan mengekstrak rincian transaksi dalam format JSON murni.

Aturan Penting:
1. Nominal: Ubah kata seperti "35rb", "35k", "35 ribu", "1.5jt", "1,5 juta", "200.000" menjadi angka murni (integer). Contoh: "35rb" -> 35000, "1.5jt" -> 1500000.
2. Tanggal:
   - Jika pengguna menyebutkan "kemarin", hitung tanggal H-1 dari ${todayStr}.
   - Jika "kemarin lusa", H-2.
   - Jika tanggal spesifik seperti "tgl 5 agustus", "10/09/2026", "2 hari lalu", konversikan ke format standar YYYY-MM-DD.
   - Jika tidak ada tanggal yang disebut, gunakan tanggal hari ini: ${todayStr}.
3. Tipe:
   - "Pemasukan": jika ada indikasi gaji, freelance, jualan, dapat uang, transfer masuk, piutang dibayar, dividen, dll.
   - "Pengeluaran": jika membeli sesuatu, makan, bensin, bayar tagihan, belanja, dll.
4. Kategori: Tentukan kategori yang paling tepat dalam Bahasa Indonesia, contoh: "Makanan & Minuman", "Transportasi", "Belanja Harian", "Tagihan & Utilitas", "Hiburan", "Kesehatan", "Pendidikan", "Gaji & Pemasukan", "Lain-lain".
5. Keterangan: Deskripsi singkat dan jelas tentang transaksi tersebut.

Pesan pengguna: "${text}"

Kembalikan respon JSON persis dengan struktur berikut:
{
  "type": "Pengeluaran" | "Pemasukan",
  "amount": number,
  "category": string,
  "description": string,
  "date": "YYYY-MM-DD"
}

Jika pesan tersebut bukan catatan keuangan (misal cuma menyapa "halo"), kembalikan JSON: null.`;

  try {
    const result = await model.generateContent(prompt);
    const responseText = result.response.text().trim();
    if (!responseText || responseText === 'null') {
      return null;
    }
    const parsed = JSON.parse(responseText) as ParsedTransaction;
    if (!parsed || !parsed.amount || !parsed.type) {
      return null;
    }
    return parsed;
  } catch (error) {
    console.error('Error saat parsing teks dengan Gemini:', error);
    throw error;
  }
}

/**
 * Ekstraksi transaksi dari foto nota/struk belanja (OCR Multimodal)
 */
export async function parseReceiptImage(
  imageBuffer: Buffer,
  mimeType: string,
  caption?: string,
  referenceDate: Date = new Date()
): Promise<ParsedTransaction | null> {
  const genAI = getGeminiClient();
  const model = genAI.getGenerativeModel({
    model: 'gemini-3.6-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.1,
    },
  });

  const todayStr = getLocalTodayDateString(referenceDate);

  const prompt = `Analisis foto struk / nota belanja ini.
Tanggal referensi hari ini: ${todayStr}.
Caption dari pengguna (jika ada): "${caption || '-'}"

Tugas:
1. Temukan TOTAL BAYAR / GRAND TOTAL transaksi ini (Pastikan bukan Subtotal, Pajak, Tunai/Cash, atau Kembalian). Masukkan dalam 'amount' sebagai angka murni (number).
2. Temukan TANGGAL transaksi pada struk jika terbaca (format YYYY-MM-DD). Jika tanggal tidak terbaca atau tidak ada pada struk, gunakan tanggal caption atau hari ini (${todayStr}).
3. Tentukan nama toko/merchant dan ringkasan pembelian untuk 'description' (contoh: "Belanja Indomaret", "Makan di Kopi Kenangan", "SPBU Pertamina").
4. Kategori: Tentukan kategori yang cocok (contoh: "Belanja Harian", "Makanan & Minuman", "Transportasi", dll).
5. Tipe: Secara default adalah "Pengeluaran".

Kembalikan JSON dengan struktur:
{
  "type": "Pengeluaran",
  "amount": number,
  "category": string,
  "description": string,
  "date": "YYYY-MM-DD",
  "rawMerchantOrItem": string
}

Jika gambar sama sekali bukan struk/nota belanja/bukti transfer, kembalikan JSON: null.`;

  try {
    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: imageBuffer.toString('base64'),
          mimeType: mimeType || 'image/jpeg',
        },
      },
    ]);

    const responseText = result.response.text().trim();
    if (!responseText || responseText === 'null') {
      return null;
    }
    const parsed = JSON.parse(responseText) as ParsedTransaction;
    if (!parsed || !parsed.amount) {
      return null;
    }
    return parsed;
  } catch (error) {
    console.error('Error saat parsing gambar nota dengan Gemini:', error);
    throw error;
  }
}
