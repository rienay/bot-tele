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

const GEMINI_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-3.5-flash'];

/**
 * Memanggil Gemini dengan fallback berantai antar model
 * untuk mengatasi 429 Too Many Requests, 503 Service Unavailable, atau model tidak tersedia.
 */
async function generateWithFallback(contents: any): Promise<any> {
  const genAI = getGeminiClient();
  let lastError: any = null;

  for (const modelName of GEMINI_MODELS) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.1,
        },
      });

      return await model.generateContent(contents);
    } catch (err: any) {
      lastError = err;
      const msg = String(err?.message || '').toLowerCase();
      const shouldFallback =
        err?.status === 429 ||
        err?.status === 503 ||
        err?.status === 404 ||
        msg.includes('429') ||
        msg.includes('quota') ||
        msg.includes('too many requests') ||
        msg.includes('503') ||
        msg.includes('high demand') ||
        msg.includes('temporarily unavailable') ||
        msg.includes('404') ||
        msg.includes('not found');

      if (shouldFallback) {
        console.warn(`[Gemini] Model ${modelName} gagal (${err?.status || 'error'}), mencoba model cadangan...`);
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}

/**
 * Ekstraksi transaksi dari pesan teks bahasa natural
 */
export async function parseTextMessage(
  text: string,
  referenceDate: Date = new Date()
): Promise<ParsedTransaction | null> {


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
    const result = await generateWithFallback(prompt);
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
  const todayStr = getLocalTodayDateString(referenceDate);

  const prompt = `Analisis foto ini. Foto ini bisa berupa berbagai macam bukti transaksi keuangan:
1. BUKTI TRANSFER BANK / E-WALLET / QRIS (BCA Mobile, Mandiri Livin, BRImo, BNI, Seabank, Bank Jago, GoPay, OVO, DANA, ShopeePay, Flip, dll).
2. STRUK KASIR / NOTA MESIN PRINT (struk minimarket, resto, toko, SPBU, tiket, parkir, dll).
3. NOTA TULISAN TANGAN / BON WARUNG / KUITANSI KERTAS (bon toko kelontong, pasar, toko ATK, toko bangunan/kayu, kuitansi manual, nota sewa/rental alat).
4. INVOICE / FAKTUR RESMI (lembar tagihan, purchase order, surat jalan dengan harga).

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
    const result = await generateWithFallback([
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

export interface ParsedSurat {
  isSurat: boolean;
  jenis: 'Surat Masuk' | 'Surat Keluar';
  nomorSurat: string;
  tanggalSurat: string;
  tanggalDiterima: string;
  pengirim: string;
  tujuan: string;
  perihal: string;
  kategori: string;
  sifat: string;
  ringkasan: string;
}

export interface SuratFileInput {
  buffer: Buffer;
  mimeType: string;
  fileName?: string;
}

/**
 * Ekstraksi rincian surat resmi (Surat Masuk & Surat Keluar) dari satu atau lebih foto (multi-halaman), PDF, atau Dokumen Word
 */
export async function parseMultipleDocumentsSurat(
  files: SuratFileInput[],
  caption?: string,
  referenceDate: Date = new Date()
): Promise<ParsedSurat | null> {
  if (!files || files.length === 0) return null;

  const todayStr = getLocalTodayDateString(referenceDate);

  let docxTexts = '';
  const inlineParts: any[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const isDocx =
      file.mimeType.includes('wordprocessingml') ||
      file.mimeType.includes('msword') ||
      file.fileName?.toLowerCase().endsWith('.docx');

    if (isDocx) {
      try {
        const mammoth = require('mammoth');
        const { value } = await mammoth.extractRawText({ buffer: file.buffer });
        if (value) docxTexts += `\n--- Berkas ${file.fileName || `Docx ${i + 1}`} ---\n${value}\n`;
      } catch (docxErr) {
        console.warn('Gagal membaca isi berkas docx dengan mammoth:', docxErr);
      }
    } else {
      const targetMime =
        file.mimeType === 'application/pdf'
          ? 'application/pdf'
          : file.mimeType.startsWith('image/')
          ? file.mimeType
          : 'image/jpeg';

      inlineParts.push({
        inlineData: {
          data: file.buffer.toString('base64'),
          mimeType: targetMime,
        },
      });
    }
  }

  const prompt = `Kamu adalah asisten tata persuratan dan kearsipan resmi untuk Dewan Kerja Pramuka Penegak dan Pandega Kwartir Cabang Cilacap (DKC Cilacap).
Tanggal referensi hari ini: ${todayStr} (WIB).
Keterangan/caption dari pengguna: "${caption || '-'}"
Jumlah berkas/halaman yang dianalisis: ${files.length} foto/halaman surat.

Tugas:
Analisis SELURUH foto/halaman berkas ini secara menyeluruh. Surat resmi seringkali memiliki lebih dari 1 halaman (misalnya halaman pertama memuat Kop Surat, Nomor Surat, Pengirim/Asal Surat, Tanggal Surat, Perihal; sedangkan halaman berikutnya memuat rincian acara, penutup, dan tanda tangan atau stempel).
Gabungkan seluruh informasi dari seluruh halaman tersebut dan ekstrak data persuratan ke dalam JSON murni.

Ketentuan Khusus Bidang Persuratan DKC:
1. isSurat:
   - true jika dokumen ini adalah surat resmi, undangan, permohonan, surat edaran, nota dinas, surat tugas/mandat, surat keputusan, atau arsip administrasi resmi.
   - false jika ini struk belanja/nota kasir atau gambar umum yang tidak berhubungan dengan persuratan.

2. SURAT MASUK (Surat dari pihak luar / Kwarran / Kwarda / Gudep / Instansi Dinas / Saka yang ditujukan ke DKC Cilacap):
   - tanggalDiterima: Tanggal masuk surat (kapan surat diterima di DKC, format YYYY-MM-DD, default hari ini: ${todayStr}).
   - pengirim: Asal surat (nama instansi / organisasi / pengirim yang mengeluarkan surat).
   - nomorSurat: Nomor surat dari pihak pengirim surat. Jika tidak tertulis, isi "-".
   - tanggalSurat: Tanggal surat dibuat/diterbitkan oleh pengirim (YYYY-MM-DD). Default: ${todayStr}.
   - perihal: Pokok/hal perihal surat masuk.
   - tujuan: "DKC Cilacap" (atau pimpinan/anggota yang dituju di DKC).

3. SURAT KELUAR (Surat resmi yang diterbitkan oleh DKC Cilacap ke pihak luar):
   - tanggalSurat: Tanggal surat keluar diterbitkan oleh DKC Cilacap (YYYY-MM-DD). Default: ${todayStr}.
   - nomorSurat: Nomor surat keluar resmi DKC Cilacap (contoh: "012/11.01-C/2026"). Jika tidak ada nomor, isi "-".
   - tujuan: Kepada (nama instansi, sekolah, atau pihak luar yang dituju oleh DKC Cilacap).
   - perihal: Pokok/hal perihal surat keluar.
   - pengirim: "DKC Cilacap".
   - tanggalDiterima: Samakan dengan tanggalSurat (YYYY-MM-DD).

4. Klasifikasi Tambahan:
   - Jika pengguna secara tegas menyebutkan "surat masuk" atau "surat keluar" pada keterangan/caption, WAJIB ikuti pilihan pengguna tersebut.
   - kategori: Pilih salah satu: "Undangan" | "Permohonan" | "Pemberitahuan" | "Mandat / Tugas" | "Keputusan" | "Rekomendasi" | "Edaran" | "Lain-lain".
   - sifat: Pilih salah satu: "Biasa" | "Penting" | "Segera" | "Sangat Segera" | "Rahasia".
   - ringkasan: 1-2 kalimat ringkasan isi surat, tempat/waktu agenda kegiatan, atau permohonan yang diajukan.

Kembalikan format JSON murni:
{
  "isSurat": boolean,
  "jenis": "Surat Masuk" | "Surat Keluar",
  "nomorSurat": string,
  "tanggalSurat": "YYYY-MM-DD",
  "tanggalDiterima": "YYYY-MM-DD",
  "pengirim": string,
  "tujuan": string,
  "perihal": string,
  "kategori": string,
  "sifat": string,
  "ringkasan": string
}`;

  try {
    const textPrompt = docxTexts
      ? `${prompt}\n\nIsi Teks Dokumen Word:\n${docxTexts.slice(0, 20000)}`
      : prompt;

    const contents = inlineParts.length > 0 ? [textPrompt, ...inlineParts] : textPrompt;

    const result = await generateWithFallback(contents);
    const responseText = result.response.text().trim();
    if (!responseText || responseText === 'null') {
      return null;
    }

    const parsed = JSON.parse(responseText) as ParsedSurat;
    if (!parsed || parsed.isSurat === false) {
      return null;
    }

    return parsed;
  } catch (error) {
    console.error('Error in parseMultipleDocumentsSurat:', error);
    return null;
  }
}

/**
 * Ekstraksi rincian surat resmi (Surat Masuk & Surat Keluar) dari single berkas
 */
export async function parseDocumentSurat(
  buffer: Buffer,
  mimeType: string,
  fileName?: string,
  caption?: string,
  referenceDate: Date = new Date()
): Promise<ParsedSurat | null> {
  return parseMultipleDocumentsSurat([{ buffer, mimeType, fileName }], caption, referenceDate);
}

