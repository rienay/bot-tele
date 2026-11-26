'use client';

import { useState, useMemo } from 'react';
import { WebFinanceData } from '@/lib/types';

function formatRupiah(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount);
}

const CATEGORIES = [
  'Konsumsi',
  'Perlengkapan',
  'Transportasi',
  'Honor',
  'Media',
  'Peserta',
  'Bendahara',
  'Iuran Kas',
  'Utang',
  'Piutang',
  'Lain-lain',
];

interface FinancePanelProps {
  data: WebFinanceData | null;
  loading: boolean;
  selectedBook: string;
  onSelectBook: (book: string) => void;
  onRefresh: () => void;
}

export default function FinancePanel({
  data,
  loading,
  selectedBook,
  onSelectBook,
  onRefresh,
}: FinancePanelProps) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'Pemasukan' | 'Pengeluaran'>('all');
  const [monthFilter, setMonthFilter] = useState('all');
  const [modal, setModal] = useState<'add' | 'scan' | 'book' | 'transfer' | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  // Add Transaction Form
  const [txType, setTxType] = useState<'Pengeluaran' | 'Pemasukan'>('Pengeluaran');
  const [txAmount, setTxAmount] = useState('');
  const [txCategory, setTxCategory] = useState('Perlengkapan');
  const [txDesc, setTxDesc] = useState('');
  const [txDate, setTxDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [txBook, setTxBook] = useState('Kas');
  const [txFile, setTxFile] = useState<File | null>(null);

  // Scan Receipt
  const [scanFile, setScanFile] = useState<File | null>(null);
  const [scanCaption, setScanCaption] = useState('');

  // New Book
  const [newBookName, setNewBookName] = useState('');

  // Transfer
  const [srcBook, setSrcBook] = useState('');
  const [dstBook, setDstBook] = useState('');
  const [tfAmount, setTfAmount] = useState('');
  const [tfDesc, setTfDesc] = useState('');

  const books = useMemo(
    () => (data?.books || ['Kas']).filter((b) => !b.startsWith('_')),
    [data?.books]
  );

  const filtered = useMemo(() => {
    if (!data?.transactions) return [];
    return data.transactions.filter((tx) => {
      if (typeFilter !== 'all' && tx.type !== typeFilter) return false;
      if (monthFilter !== 'all') {
        const m = tx.date?.slice(5, 7);
        if (m !== monthFilter) return false;
      }
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          tx.description.toLowerCase().includes(q) ||
          tx.category.toLowerCase().includes(q) ||
          tx.book.toLowerCase().includes(q) ||
          tx.date.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [data?.transactions, typeFilter, monthFilter, search]);

  const summary = useMemo(() => {
    let masuk = 0;
    let keluar = 0;
    for (const tx of filtered) {
      if (tx.type === 'Pemasukan') masuk += tx.amount;
      else keluar += tx.amount;
    }
    return { masuk, keluar, saldo: masuk - keluar, count: filtered.length };
  }, [filtered]);

  const submitAddTx = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      const fd = new FormData();
      fd.append('action', 'add_transaction');
      fd.append('book', txBook || (selectedBook === 'Semua' ? 'Kas' : selectedBook));
      fd.append('type', txType);
      fd.append('amount', txAmount);
      fd.append('category', txCategory);
      fd.append('description', txDesc);
      fd.append('date', txDate);
      if (txFile) fd.append('file', txFile);

      const res = await fetch('/api/finances', { method: 'POST', body: fd });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);

      setFeedback({ ok: true, text: json.message });
      setTxAmount('');
      setTxDesc('');
      setTxFile(null);
      setModal(null);
      onRefresh();
    } catch (err: any) {
      setFeedback({ ok: false, text: err?.message || 'Gagal mencatat transaksi' });
    } finally {
      setBusy(false);
    }
  };

  const submitScan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scanFile) return;
    setBusy(true);
    setFeedback(null);
    try {
      const fd = new FormData();
      fd.append('action', 'scan_receipt');
      fd.append('book', selectedBook === 'Semua' ? 'Kas' : selectedBook);
      fd.append('caption', scanCaption);
      fd.append('file', scanFile);

      const res = await fetch('/api/finances', { method: 'POST', body: fd });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);

      setFeedback({ ok: true, text: json.message });
      setScanFile(null);
      setScanCaption('');
      setModal(null);
      onRefresh();
    } catch (err: any) {
      setFeedback({ ok: false, text: err?.message || 'Gagal memindai nota' });
    } finally {
      setBusy(false);
    }
  };

  const submitNewBook = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/finances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_book', name: newBookName }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setFeedback({ ok: true, text: json.message });
      setNewBookName('');
      setModal(null);
      onRefresh();
    } catch (err: any) {
      setFeedback({ ok: false, text: err?.message || 'Gagal membuat pos baru' });
    } finally {
      setBusy(false);
    }
  };

  const submitTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/finances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'transfer',
          sourceBook: srcBook,
          targetBook: dstBook,
          amount: Number(tfAmount),
          description: tfDesc,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setFeedback({ ok: true, text: json.message });
      setTfAmount('');
      setTfDesc('');
      setModal(null);
      onRefresh();
    } catch (err: any) {
      setFeedback({ ok: false, text: err?.message || 'Gagal pindah saldo' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {feedback && (
        <div
          className="p-card"
          style={{
            padding: '12px 16px',
            background: feedback.ok ? '#ECFDF5' : '#FEF2F2',
            borderColor: feedback.ok ? '#A7F3D0' : '#FECACA',
            color: feedback.ok ? '#065F46' : '#991B1B',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 600 }}>{feedback.text}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Action Bar */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 10,
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <select
            className="p-select"
            style={{ width: 'auto', minWidth: 180, fontWeight: 600 }}
            value={selectedBook}
            onChange={(e) => onSelectBook(e.target.value)}
          >
            <option value="Semua">Semua Pos Keuangan</option>
            {books.map((b) => (
              <option key={b} value={b}>
                Pos: {b}
              </option>
            ))}
          </select>
          <button type="button" className="p-btn p-btn-outline" onClick={onRefresh} disabled={loading}>
            {loading ? 'Memuat...' : '↻ Segarkan'}
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="p-btn p-btn-primary"
            onClick={() => {
              setTxBook(selectedBook === 'Semua' ? books[0] || 'Kas' : selectedBook);
              setModal('add');
            }}
          >
            + Catat Transaksi
          </button>
          <button type="button" className="p-btn p-btn-outline" onClick={() => setModal('scan')}>
            📷 Scan Nota AI
          </button>
          <button
            type="button"
            className="p-btn p-btn-outline"
            onClick={() => {
              setSrcBook(books[0] || 'Kas');
              setDstBook(books[1] || books[0] || 'Kas');
              setModal('transfer');
            }}
          >
            ⇄ Pindah Saldo
          </button>
          <button type="button" className="p-btn p-btn-outline" onClick={() => setModal('book')}>
            + Pos Baru
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="p-grid-stats" style={{ marginBottom: 4 }}>
        <div className="p-stat-card highlight">
          <div className="p-stat-label">Saldo Bersih</div>
          <div className="p-stat-value">{formatRupiah(summary.saldo)}</div>
        </div>
        <div className="p-stat-card">
          <div className="p-stat-label" style={{ color: '#047857' }}>Total Pemasukan</div>
          <div className="p-stat-value" style={{ color: '#047857' }}>{formatRupiah(summary.masuk)}</div>
        </div>
        <div className="p-stat-card">
          <div className="p-stat-label" style={{ color: '#B91C1C' }}>Total Pengeluaran</div>
          <div className="p-stat-value" style={{ color: '#B91C1C' }}>{formatRupiah(summary.keluar)}</div>
        </div>
        <div className="p-stat-card">
          <div className="p-stat-label">Jumlah Transaksi</div>
          <div className="p-stat-value">{summary.count}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="p-card" style={{ padding: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          <input
            className="p-input"
            placeholder="Cari keterangan, kategori, pos..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="p-select"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as any)}
          >
            <option value="all">Semua Jenis</option>
            <option value="Pemasukan">Pemasukan Saja</option>
            <option value="Pengeluaran">Pengeluaran Saja</option>
          </select>
          <select
            className="p-select"
            value={monthFilter}
            onChange={(e) => setMonthFilter(e.target.value)}
          >
            <option value="all">Semua Bulan</option>
            {[
              ['01', 'Januari'], ['02', 'Februari'], ['03', 'Maret'], ['04', 'April'],
              ['05', 'Mei'], ['06', 'Juni'], ['07', 'Juli'], ['08', 'Agustus'],
              ['09', 'September'], ['10', 'Oktober'], ['11', 'November'], ['12', 'Desember'],
            ].map(([val, lbl]) => (
              <option key={val} value={val}>{lbl}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Transactions Table */}
      <div className="p-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="p-table-wrap">
          <table className="p-table">
            <thead>
              <tr>
                <th>Tanggal</th>
                <th>Pos</th>
                <th>Kategori</th>
                <th>Keterangan</th>
                <th style={{ textAlign: 'right' }}>Nominal</th>
                <th>Nota</th>
              </tr>
            </thead>
            <tbody>
              {loading && !data ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: 32, color: '#64748B' }}>
                    Memuat data keuangan...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: 32, color: '#64748B' }}>
                    Belum ada transaksi yang cocok dengan filter.
                  </td>
                </tr>
              ) : (
                filtered.slice(0, 80).map((tx) => (
                  <tr key={tx.id}>
                    <td style={{ whiteSpace: 'nowrap', fontSize: 13 }}>{tx.date}</td>
                    <td><span className="p-badge">{tx.book}</span></td>
                    <td style={{ fontSize: 13 }}>{tx.category}</td>
                    <td style={{ fontWeight: 500 }}>{tx.description}</td>
                    <td
                      style={{
                        textAlign: 'right',
                        fontWeight: 700,
                        whiteSpace: 'nowrap',
                        color: tx.type === 'Pemasukan' ? '#047857' : '#B91C1C',
                      }}
                    >
                      {tx.type === 'Pemasukan' ? '+' : '-'}{formatRupiah(tx.amount)}
                    </td>
                    <td>
                      {tx.noteLink ? (
                        <a
                          href={tx.noteLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: 'var(--accent)', fontWeight: 600, fontSize: 13 }}
                        >
                          Lihat
                        </a>
                      ) : (
                        <span style={{ color: '#94A3B8' }}>-</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modals */}
      {modal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.5)',
            zIndex: 60,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => !busy && setModal(null)}
        >
          <div
            className="p-card"
            style={{ width: '100%', maxWidth: 460, maxHeight: '90dvh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: 18 }}>
                {modal === 'add' && 'Catat Transaksi Baru'}
                {modal === 'scan' && 'Scan Foto Nota dengan AI'}
                {modal === 'book' && 'Buat Pos Keuangan Baru'}
                {modal === 'transfer' && 'Pindah Saldo Antar Pos'}
              </h3>
              <button
                type="button"
                onClick={() => !busy && setModal(null)}
                style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            {modal === 'add' && (
              <form onSubmit={submitAddTx} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600 }}>Jenis</label>
                    <select className="p-select" value={txType} onChange={(e) => setTxType(e.target.value as any)}>
                      <option value="Pengeluaran">Pengeluaran</option>
                      <option value="Pemasukan">Pemasukan</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600 }}>Pos / Buku</label>
                    <select className="p-select" value={txBook} onChange={(e) => setTxBook(e.target.value)}>
                      {books.map((b) => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600 }}>Nominal (Rp)</label>
                    <input className="p-input" type="number" min="1" required value={txAmount} onChange={(e) => setTxAmount(e.target.value)} placeholder="50000" />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600 }}>Tanggal</label>
                    <input className="p-input" type="date" required value={txDate} onChange={(e) => setTxDate(e.target.value)} />
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600 }}>Kategori</label>
                  <select className="p-select" value={txCategory} onChange={(e) => setTxCategory(e.target.value)}>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600 }}>Keterangan</label>
                  <input className="p-input" required value={txDesc} onChange={(e) => setTxDesc(e.target.value)} placeholder="Contoh: Beli ATK rapat" />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600 }}>Foto Nota (Opsional)</label>
                  <input className="p-input" type="file" accept="image/*" onChange={(e) => setTxFile(e.target.files?.[0] || null)} />
                </div>
                <button type="submit" className="p-btn p-btn-primary" disabled={busy}>
                  {busy ? 'Menyimpan...' : 'Simpan Transaksi'}
                </button>
              </form>
            )}

            {modal === 'scan' && (
              <form onSubmit={submitScan} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <p style={{ fontSize: 13, color: '#64748B', margin: 0 }}>
                  Unggah foto struk/nota/bukti transfer. AI akan membaca nominal, kategori, dan tanggal secara otomatis lalu menyimpannya ke pos{' '}
                  <strong>{selectedBook === 'Semua' ? 'Kas' : selectedBook}</strong>.
                </p>
                <input
                  className="p-input"
                  type="file"
                  accept="image/*"
                  required
                  onChange={(e) => setScanFile(e.target.files?.[0] || null)}
                />
                <input
                  className="p-input"
                  value={scanCaption}
                  onChange={(e) => setScanCaption(e.target.value)}
                  placeholder="Catatan tambahan (opsional)"
                />
                <button type="submit" className="p-btn p-btn-primary" disabled={busy || !scanFile}>
                  {busy ? 'Memindai dengan AI...' : 'Pindai & Simpan Otomatis'}
                </button>
              </form>
            )}

            {modal === 'book' && (
              <form onSubmit={submitNewBook} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <input
                  className="p-input"
                  required
                  value={newBookName}
                  onChange={(e) => setNewBookName(e.target.value)}
                  placeholder="Nama pos / kegiatan baru (cth: Raimuna Cabang)"
                />
                <button type="submit" className="p-btn p-btn-primary" disabled={busy}>
                  {busy ? 'Membuat...' : 'Buat Pos Baru'}
                </button>
              </form>
            )}

            {modal === 'transfer' && (
              <form onSubmit={submitTransfer} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600 }}>Dari Pos</label>
                  <select className="p-select" value={srcBook} onChange={(e) => setSrcBook(e.target.value)}>
                    {books.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600 }}>Ke Pos</label>
                  <select className="p-select" value={dstBook} onChange={(e) => setDstBook(e.target.value)}>
                    {books.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600 }}>Nominal (Rp)</label>
                  <input className="p-input" type="number" min="1" required value={tfAmount} onChange={(e) => setTfAmount(e.target.value)} placeholder="100000" />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600 }}>Keterangan (Opsional)</label>
                  <input className="p-input" value={tfDesc} onChange={(e) => setTfDesc(e.target.value)} placeholder="Dana kegiatan" />
                </div>
                <button type="submit" className="p-btn p-btn-primary" disabled={busy}>
                  {busy ? 'Memindahkan...' : 'Pindahkan Saldo'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
