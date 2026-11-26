import { NextResponse } from 'next/server';
import { getRoleConfig } from '@/lib/webAuth';
import { parseTextMessage, parseReceiptImage, parseDocumentSurat } from '@/lib/gemini';
import {
  appendTransaction,
  getAllSheetBooks,
  getAllSheetsSummary,
  getMonthSummary,
} from '@/lib/googleSheets';
import { uploadReceiptToDrive } from '@/lib/googleDrive';
import {
  cekStatusKasBulan,
  catatPembayaranKas,
  DAFTAR_BULAN,
  NOMINAL_IURAN_DEFAULT,
} from '@/lib/kasAnggota';
import {
  getAllInventaris,
  getInventarisStats,
  tambahInventaris,
  cariInventaris,
} from '@/lib/inventaris';
import { getAllSurat, getSuratStats, cariSurat, tambahSurat } from '@/lib/surat';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function rp(n: number): string {
  return 'Rp' + Math.round(n).toLocaleString('id-ID');
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get('content-type') || '';
    let message = '';
    let roleKey = '';
    let book = 'Kas';
    let userName = 'Pengguna Web';
    let file: File | null = null;

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      message = String(formData.get('message') || '').trim();
      roleKey = String(formData.get('role') || '').trim();
      book = String(formData.get('book') || 'Kas').trim() || 'Kas';
      userName = String(formData.get('userName') || 'Pengguna Web').trim();
      file = formData.get('file') as File | null;
    } else {
      const body = await request.json();
      message = String(body?.message || '').trim();
      roleKey = String(body?.role || '').trim();
      book = String(body?.book || 'Kas').trim() || 'Kas';
      userName = String(body?.userName || 'Pengguna Web').trim();
    }

    const roleConfig = getRoleConfig(roleKey);
    if (!roleConfig) {
      return NextResponse.json(
        { success: false, reply: 'Sesi akses tidak valid. Silakan login ulang.' },
        { status: 401 }
      );
    }

    const lower = message.toLowerCase();
    const { permissions } = roleConfig;

    // 1. Handle Image Upload via Chat
    if (file && file.size > 0) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const mimeType = file.type || 'image/jpeg';

      if (permissions.finance) {
        const fileName = `chat_nota_${Date.now()}.jpg`;
        const [noteLink, parsed] = await Promise.all([
          uploadReceiptToDrive(buffer, fileName, mimeType).catch(() => ''),
          parseReceiptImage(buffer, mimeType, message),
        ]);

        if (!parsed) {
          return NextResponse.json({
            success: true,
            reply:
              'Maaf, saya belum bisa membaca nominal transaksi dari foto tersebut. Coba kirim foto yang lebih jelas atau ketik manual, misal: "keluar 25rb beli kertas".',
          });
        }

        await appendTransaction({ ...parsed, noteLink: noteLink || '-' }, book);
        return NextResponse.json({
          success: true,
          actionTaken: 'refresh_finance',
          reply: [
            `✅ Nota berhasil dicatat ke pos *${book}*!`,
            `• Jenis: ${parsed.type}`,
            `• Nominal: ${rp(parsed.amount)}`,
            `• Kategori: ${parsed.category}`,
            `• Keterangan: ${parsed.description}`,
            `• Tanggal: ${parsed.date}`,
          ].join('\n'),
        });
      }

      if (permissions.surat && (lower.includes('surat') || lower.includes('scan') || !lower.includes('barang'))) {
        const fileName = `chat_surat_${Date.now()}.jpg`;
        const [driveUrl, parsed] = await Promise.all([
          uploadReceiptToDrive(buffer, fileName, mimeType).catch(() => ''),
          parseDocumentSurat(buffer, mimeType, message),
        ]);

        if (!parsed) {
          return NextResponse.json({
            success: true,
            reply:
              'Berkas berhasil diunggah, tapi AI belum bisa mengekstrak detail surat. Silakan lengkapi di menu Persuratan.',
          });
        }

        const saved = await tambahSurat({
          jenis: parsed.jenis || 'Surat Masuk',
          nomorSurat: parsed.nomorSurat || '-',
          tanggalSurat: parsed.tanggalSurat || new Date().toISOString().slice(0, 10),
          tanggalDiterima: new Date().toISOString().slice(0, 10),
          pengirim: parsed.pengirim || '-',
          tujuan: parsed.tujuan || 'DKC Cilacap',
          perihal: parsed.perihal || 'Dokumen Surat',
          kategori: parsed.kategori || 'Lain-lain',
          sifat: parsed.sifat || 'Biasa',
          ringkasan: parsed.ringkasan || '-',
          berkas: driveUrl || '',
          pic: userName,
        });

        return NextResponse.json({
          success: true,
          actionTaken: 'refresh_surat',
          reply: [
            `✅ Surat berhasil dipindai & diarsipkan!`,
            `• Kode Arsip: ${saved.kodeArsip}`,
            `• Jenis: ${saved.jenis}`,
            `• Nomor: ${saved.nomorSurat}`,
            `• Perihal: ${saved.perihal}`,
            `• Pengirim: ${saved.pengirim}`,
          ].join('\n'),
        });
      }

      // Default for Inventaris (DKC or Unit)
      const targetUnit = permissions.unitOnly || 'DKC';
      const fileName = `chat_inv_${targetUnit.toLowerCase()}_${Date.now()}.jpg`;
      const fotoUrl = await uploadReceiptToDrive(buffer, fileName, mimeType).catch(() => '');
      const namaBarang = message || `Barang ${targetUnit} (${new Date().toLocaleDateString('id-ID')})`;

      const item = await tambahInventaris({
        namaBarang,
        unit: targetUnit,
        jumlah: 1,
        tahun: new Date().getFullYear(),
        sumber: 'Input Chat Web',
        kondisi: 'Baik',
        foto: fotoUrl || '',
        keterangan: `Diinput oleh ${userName}`,
      });

      return NextResponse.json({
        success: true,
        actionTaken: 'refresh_inventaris',
        reply: [
          `✅ Foto & data barang berhasil dicatat ke Inventaris *${item.unit}*!`,
          `• Kode: ${item.kodeBarang}`,
          `• Nama: ${item.namaBarang}`,
          `• Kondisi: ${item.kondisi}`,
        ].join('\n'),
      });
    }

    if (!message) {
      return NextResponse.json({
        success: true,
        reply: 'Ketik pesan atau perintah, atau kirim foto untuk diproses.',
      });
    }

    // 2. Help / Menu Command
    if (lower === 'help' || lower === '/help' || lower === 'menu' || lower === '/start' || lower === 'halo' || lower === 'hai') {
      if (permissions.finance) {
        return NextResponse.json({
          success: true,
          reply: [
            `Halo ${userName}! Saya Asisten Keuangan (${roleConfig.label}).`,
            `Kamu bisa langsung chat seperti di Telegram:`,
            `• Catat transaksi: "keluar 25rb beli kertas" atau "masuk 100rb donasi"`,
            `• Upload foto nota/struk untuk dicatat otomatis`,
            `• "rekap" atau "saldo" — ringkasan bulan ini & semua pos`,
            `• "cekkas" — status iuran kas anggota bulan ini`,
            `• "bayarkas [Nama] [Bulan]" — catat bayar kas anggota`,
            `• "buku" — lihat daftar pos keuangan`,
          ].join('\n'),
        });
      }

      if (permissions.surat) {
        return NextResponse.json({
          success: true,
          reply: [
            `Halo ${userName}! Saya Asisten DKC (${roleConfig.label}).`,
            `Perintah yang bisa kamu pakai:`,
            `• "inventaris" — ringkasan & daftar barang semua unit`,
            `• "cari barang [nama]" — cari barang inventaris`,
            `• "tambah barang [Nama] | [Unit] | [Jumlah]" — catat barang baru`,
            `• "surat" — ringkasan arsip surat masuk & keluar`,
            `• "cari surat [kata kunci]" — cari arsip surat`,
            `• Kirim foto surat untuk dipindai & diarsipkan otomatis oleh AI`,
          ].join('\n'),
        });
      }

      return NextResponse.json({
        success: true,
        reply: [
          `Halo ${userName}! Saya Asisten ${roleConfig.label}.`,
          `Perintah yang bisa kamu pakai:`,
          `• "inventaris" — lihat daftar & statistik barang ${permissions.unitOnly}`,
          `• "cari [nama barang]" — cari barang di unit ${permissions.unitOnly}`,
          `• "tambah barang [Nama] | [Jumlah] | [Kondisi]" — catat barang baru ke unit ${permissions.unitOnly}`,
          `• Kirim foto barang (beri keterangan nama barang) untuk langsung dicatat`,
        ].join('\n'),
      });
    }

    // 3. BENDAHARA COMMANDS
    if (permissions.finance) {
      if (lower === 'buku' || lower === '/buku') {
        const books = await getAllSheetBooks();
        const visible = books.filter((b) => !b.startsWith('_'));
        return NextResponse.json({
          success: true,
          reply: `📚 Daftar Pos Keuangan (${visible.length}):\n${visible.map((b) => `• ${b}`).join('\n')}\n\nPos aktif saat ini: *${book}*`,
        });
      }

      if (lower === 'rekap' || lower === '/rekap' || lower === 'saldo' || lower === '/saldo') {
        const now = new Date();
        const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const [monthRep, globalRep] = await Promise.all([
          getMonthSummary(ym, book),
          getAllSheetsSummary(),
        ]);

        const lines = [
          `📊 *Rekap Pos ${book} (${monthRep.periodeLabel})*`,
          `• Pemasukan: ${rp(monthRep.totalPemasukan)}`,
          `• Pengeluaran: ${rp(monthRep.totalPengeluaran)}`,
          `• Saldo Bulan Ini: ${rp(monthRep.saldo)}`,
          ``,
          `💼 *Total Semua Pos (${globalRep.books.length} pos)*`,
          `• Total Saldo: ${rp(globalRep.saldo)}`,
          ...globalRep.books.slice(0, 6).map((b) => `  - ${b.bookName}: ${rp(b.saldo)}`),
        ];
        return NextResponse.json({ success: true, reply: lines.join('\n') });
      }

      if (lower.startsWith('cekkas') || lower.startsWith('/cekkas') || lower === 'kas' || lower === '/kas') {
        const now = new Date();
        const parts = message.replace(/^\//, '').split(/\s+/);
        const bulanQuery = parts[1] || DAFTAR_BULAN[now.getMonth()];
        const tahun = parts[2] ? parseInt(parts[2], 10) || now.getFullYear() : now.getFullYear();

        const status = await cekStatusKasBulan(bulanQuery, tahun);
        const lines = [
          `🪙 *Status Kas ${status.bulan} ${status.tahun}*`,
          `• Terkumpul: ${rp(status.totalTerkumpul)}`,
          `• Sudah Bayar (${status.sudahBayar.length}): ${status.sudahBayar.map((s) => s.nama).join(', ') || '-'}`,
          `• Belum Bayar (${status.belumBayar.length}): ${status.belumBayar.map((b) => b.nama).join(', ') || 'Semua lunas!'}`,
        ];
        return NextResponse.json({ success: true, reply: lines.join('\n') });
      }

      if (lower.startsWith('bayarkas') || lower.startsWith('/bayarkas')) {
        const raw = message.replace(/^\/?bayarkas\s*/i, '').trim();
        const parts = raw.split(/\s+/);
        if (parts.length < 1 || !parts[0]) {
          return NextResponse.json({
            success: true,
            reply: 'Format: `bayarkas [Nama] [Bulan]`\nContoh: `bayarkas Budi Januari`',
          });
        }
        const now = new Date();
        const nama = parts[0];
        const bulan = parts[1] || DAFTAR_BULAN[now.getMonth()];
        const nominal = parts[2] ? parseInt(parts[2].replace(/\D/g, ''), 10) || NOMINAL_IURAN_DEFAULT : NOMINAL_IURAN_DEFAULT;

        const res = await catatPembayaranKas(nama, bulan, now.getFullYear(), nominal, `Via Chat Web (${userName})`);
        return NextResponse.json({
          success: true,
          actionTaken: res.success ? 'refresh_kas' : undefined,
          reply: res.success
            ? `✅ Kas *${res.nama}* bulan *${res.bulan} ${res.tahun}* (${rp(res.nominal)}) berhasil dicatat!`
            : res.message,
        });
      }

      // Natural language transaction via Gemini
      const parsed = await parseTextMessage(message);
      if (parsed) {
        await appendTransaction({ ...parsed, noteLink: '-' }, book);
        return NextResponse.json({
          success: true,
          actionTaken: 'refresh_finance',
          reply: [
            `✅ Transaksi dicatat ke pos *${book}*!`,
            `• Jenis: ${parsed.type}`,
            `• Nominal: ${rp(parsed.amount)}`,
            `• Kategori: ${parsed.category}`,
            `• Keterangan: ${parsed.description}`,
            `• Tanggal: ${parsed.date}`,
          ].join('\n'),
        });
      }

      return NextResponse.json({
        success: true,
        reply:
          'Saya belum mengenali pesan itu sebagai transaksi atau perintah keuangan. Coba ketik misalnya: "keluar 20rb beli snack", "rekap", atau "cekkas".',
      });
    }

    // 4. DKC & UNIT COMMANDS (Non-finance)
    if (permissions.inventaris) {
      const unitScope = permissions.unitOnly || undefined;

      if (lower.startsWith('tambah barang') || lower.startsWith('/tambahbarang')) {
        const raw = message.replace(/^\/?(tambah\s*barang|tambahbarang)\s*/i, '').trim();
        const parts = raw.split('|').map((s) => s.trim());
        if (!parts[0]) {
          return NextResponse.json({
            success: true,
            reply: unitScope
              ? `Format: \`tambah barang [Nama] | [Jumlah] | [Kondisi]\`\nContoh: \`tambah barang HT Motorola | 2 | Baik\``
              : `Format: \`tambah barang [Nama] | [Unit] | [Jumlah] | [Kondisi]\`\nContoh: \`tambah barang Tenda Dome | Ubaloka | 1 | Baik\``,
          });
        }

        const namaBarang = parts[0];
        const unit = unitScope ? unitScope : parts[1] || 'DKC';
        const jumlah = unitScope ? parts[1] || '1' : parts[2] || '1';
        const kondisi = unitScope ? parts[2] || 'Baik' : parts[3] || 'Baik';

        const item = await tambahInventaris({
          namaBarang,
          unit,
          jumlah,
          tahun: new Date().getFullYear(),
          sumber: 'Input Chat Web',
          kondisi,
          foto: '',
          keterangan: `Diinput oleh ${userName}`,
        });

        return NextResponse.json({
          success: true,
          actionTaken: 'refresh_inventaris',
          reply: `✅ Barang berhasil dicatat!\n• Kode: ${item.kodeBarang}\n• Nama: ${item.namaBarang}\n• Unit: ${item.unit}\n• Jumlah: ${item.jumlah}\n• Kondisi: ${item.kondisi}`,
        });
      }

      if (lower.startsWith('cari barang') || (unitScope && lower.startsWith('cari '))) {
        const q = message.replace(/^(cari\s*barang|cari)\s*/i, '').trim();
        if (!q) {
          return NextResponse.json({ success: true, reply: 'Ketik kata kunci setelah `cari`, misal: `cari tenda`.' });
        }
        let results = await cariInventaris(q);
        if (unitScope) {
          results = results.filter((it) => it.unit === unitScope);
        }
        if (results.length === 0) {
          return NextResponse.json({ success: true, reply: `Tidak ditemukan barang dengan kata kunci "${q}".` });
        }
        const lines = [
          `🔍 Ditemukan ${results.length} barang untuk "${q}":`,
          ...results.slice(0, 8).map((it) => `• [${it.kodeBarang}] ${it.namaBarang} (${it.unit}) — ${it.jumlah} unit, ${it.kondisi}`),
        ];
        return NextResponse.json({ success: true, reply: lines.join('\n') });
      }

      if (lower === 'inventaris' || lower === '/inventaris' || lower === 'barang' || lower === '/barang') {
        const items = await getAllInventaris(unitScope);
        const stats = await getInventarisStats();
        const scopeLabel = unitScope ? `Unit ${unitScope}` : 'Semua Unit';
        const lines = [
          `📦 *Inventaris ${scopeLabel}* (${items.length} jenis barang)`,
          ...(unitScope
            ? []
            : [
                `• Kondisi Baik: ${stats.byKondisi['Baik'] || 0}`,
                `• Rusak Ringan/Berat: ${(stats.byKondisi['Rusak Ringan'] || 0) + (stats.byKondisi['Rusak Berat'] || 0)}`,
              ]),
          ``,
          `Daftar terbaru:`,
          ...items.slice(0, 8).map((it) => `• [${it.kodeBarang}] ${it.namaBarang} — ${it.jumlah} (${it.kondisi})`),
        ];
        return NextResponse.json({ success: true, reply: lines.join('\n') });
      }
    }

    // 5. SURAT COMMANDS (DKC only)
    if (permissions.surat) {
      if (lower.startsWith('cari surat') || lower.startsWith('/carisurat') || lower.startsWith('cari ')) {
        const q = message.replace(/^\/?(cari\s*surat|carisurat|cari)\s*/i, '').trim();
        if (!q) {
          return NextResponse.json({ success: true, reply: 'Ketik kata kunci surat, misal: `cari surat undangan`.' });
        }
        const results = await cariSurat(q);
        if (results.length === 0) {
          return NextResponse.json({ success: true, reply: `Tidak ada surat yang cocok dengan "${q}".` });
        }
        const lines = [
          `✉️ Ditemukan ${results.length} arsip surat untuk "${q}":`,
          ...results
            .slice(0, 6)
            .map((r) => `• [${r.kodeArsip}] ${r.perihal} (${r.jenis}, ${r.tanggalSurat})`),
        ];
        return NextResponse.json({ success: true, reply: lines.join('\n') });
      }

      if (lower === 'surat' || lower === '/surat' || lower === 'persuratan') {
        const [all, stats] = await Promise.all([getAllSurat(), getSuratStats()]);
        const lines = [
          `✉️ *Ringkasan Arsip Persuratan DKC*`,
          `• Total Surat: ${stats.totalSurat}`,
          `• Surat Masuk: ${stats.totalMasuk}`,
          `• Surat Keluar: ${stats.totalKeluar}`,
          `• Sifat Penting/Segera: ${stats.totalPenting}`,
          ``,
          `Arsip terbaru:`,
          ...all.slice(0, 5).map((s) => `• [${s.kodeArsip}] ${s.perihal} (${s.jenis})`),
        ];
        return NextResponse.json({ success: true, reply: lines.join('\n') });
      }
    }

    return NextResponse.json({
      success: true,
      reply: `Perintah tidak dikenali untuk akses *${roleConfig.label}*. Ketik \`help\` untuk melihat daftar perintah yang tersedia.`,
    });
  } catch (error: any) {
    console.error('Error POST /api/chat:', error);
    return NextResponse.json(
      { success: false, reply: `Terjadi gangguan: ${error?.message || 'Gagal memproses pesan'}` },
      { status: 500 }
    );
  }
}
