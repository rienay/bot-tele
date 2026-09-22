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
 * Memanggil Gemini generateContent dengan retry otomatis jika server mengalami spike 503
 */
async function generateWithRetry(model: any, contents: any, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await model.generateContent(contents);
    } catch (err: any) {
      const isTemporary =
        err?.status === 503 ||
        err?.message?.includes('503') ||
        err?.message?.includes('high demand') ||
        err?.message?.includes('temporarily unavailable');

      if (isTemporary && attempt < maxRetries) {
        console.warn(
          `[Gemini] Beban tinggi (Percobaan ${attempt}/${maxRetries}), mencoba ulang dalam ${attempt * 1.5}s...`
        );
        await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
        continue;
      }
      throw err;
    }
  }
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
   - "Pemasukan": jika ada uang masuk (gaji, transfer masuk, penjualan, pinjam uang/utang baru, atau orang bayar piutang ke kita).
   - "Pengeluaran": jika ada uang keluar (beli barang, bayar konsumsi, bensin, pinjamkan uang ke orang/kasbon/piutang, atau bayar cicilan utang kita).
4. Kategori: WAJIB pilih salah satu dari kategori berikut yang paling relevan:
   - "Konsumsi": untuk makanan, minuman, snack, catering, kopi, air mineral, dll.
   - "Perlengkapan": untuk alat, ATK, perlengkapan acara/kantor, banner, lakban, kabel, sewa alat, dll.
   - "Transportasi": untuk bensin, ongkir, grab/gojek, sewa kendaraan, tol, parkir, dll.
   - "Honor": untuk upah/fee pembicara, juri, narasumber, pengisi acara, insentif, gaji, dll.
   - "Media": untuk publikasi, dokumentasi, cetak poster/flyer, promosi, kamera, konten, dll.
   - "Peserta": untuk biaya terkait peserta, registrasi/tiket peserta, id card, sertifikat, merchandise/souvenir peserta, dll.
   - "Bendahara": untuk kas, uang modal/kas kecil, transfer dana, simpanan, admin bank, dll.
   - "Utang": untuk uang yang kita pinjam dari orang/pihak lain, atau pelunasan/cicilan utang kita ke orang lain.
   - "Piutang": untuk uang yang kita pinjamkan/kasbon ke orang lain, atau penerimaan uang saat orang melunasi utangnya ke kita.
   - "Lain-lain": hanya jika benar-benar tidak cocok dengan kategori di atas.
5. Keterangan: Deskripsi singkat dan jelas tentang transaksi tersebut (sertakan nama orang yang berutang/piutang jika ada di pesan).

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
    const result = await generateWithRetry(model, prompt);
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

  const prompt = `Analisis foto ini. Foto ini bisa berupa:
1. BUKTI TRANSFER BANK / E-WALLET / QRIS (BCA Mobile, Mandiri Livin, BRImo, BNI, Seabank, Bank Jago, GoPay, OVO, DANA, ShopeePay, Flip, dll).
2. STRUK / NOTA BELANJA (struk kasir minimarket, resto, toko, SPBU, invoice, dll).

Tanggal referensi hari ini: ${todayStr} (WIB).
Caption teks dari pengguna (SANGAT PENTING jika ada): "${caption || '-'}"

Tugas Analisis:
1. NOMINAL (amount):
   - Ambil jumlah uang transaksi (Nominal Transfer, Total Bayar, Grand Total, Jumlah).
   - Pastikan angka murni (integer/number), jangan ambil saldo sisa, biaya admin saja, atau nomor rekening/referensi.
2. TIPE (type):
   - "Pengeluaran": jika bukti transfer keluar (kirim uang, pembayaran, transfer ke rekening lain, bayar QRIS, belanja).
   - "Pemasukan": jika bukti transfer masuk (terima dana, transfer masuk, top up dari pihak lain).
3. TANGGAL (date):
   - Baca tanggal transaksi yang tertera pada bukti transfer / struk (format YYYY-MM-DD).
   - Jika tanggal pada gambar tidak terbaca, gunakan tanggal hari ini: ${todayStr}.
4. KETERANGAN (description):
   - Jika Bukti Transfer: sebutkan bank/e-wallet dan nama penerima/pengirim serta berita/catatan transfer jika ada. Contoh: "Transfer BCA ke Budi (Konsumsi)", "QRIS Resto Padang", "Transfer Masuk dari Ahmad".
   - Jika Struk Belanja: nama toko dan barang utama (contoh: "Indomaret", "SPBU Pertamina").
   - Utamakan informasi dari Caption pengguna jika pengguna menuliskan catatan tambahan.
5. KATEGORI (category): WAJIB pilih salah satu kategori yang paling relevan:
   - "Konsumsi": untuk makanan, minuman, katering, resto, cafe, minimarket bahan makanan.
   - "Perlengkapan": untuk alat, ATK, hardware, sewa alat, banner, operasional kantor/acara.
   - "Transportasi": bensin, tiket, tol, parkir, ojek/taksi online, sewa mobil.
   - "Honor": fee/honor pembicara, juri, pengisi acara, upah kerja, gaji.
   - "Media": cetak flyer/poster, dokumentasi, kamera, promosi, ads.
   - "Peserta": registrasi peserta, seminar kit, souvenir, sertifikat.
   - "Bendahara": transfer kas, tarik tunai, kas kecil, biaya admin, uang modal.
   - "Utang": pinjaman yang kita terima atau pembayaran cicilan/pelunasan utang ke orang lain.
   - "Piutang": pinjaman yang kita berikan ke orang lain (kasbon) atau orang melunasi utangnya ke kita.
   - "Lain-lain": jika tidak ada yang cocok.

Kembalikan respon JSON persis dengan struktur berikut:
{
  "type": "Pengeluaran" | "Pemasukan",
  "amount": number,
  "category": string,
  "description": string,
  "date": "YYYY-MM-DD"
}

Jika gambar sama sekali bukan bukti transfer, bukan struk/nota, dan tidak ada nominal transaksi finansial, kembalikan JSON: null.`;

  try {
    const result = await generateWithRetry(model, [
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
