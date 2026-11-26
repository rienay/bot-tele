'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';

interface SuratItem {
  kodeArsip: string;
  jenis: 'Surat Masuk' | 'Surat Keluar';
  nomorSurat: string;
  tanggalSurat: string;
  pengirim: string;
  tujuan: string;
  perihal: string;
  kategori: string;
  sifat: string;
  ringkasan: string;
  berkas: string;
}

const KATEGORI = ['Undangan', 'Permohonan', 'Pemberitahuan', 'Mandat / Tugas', 'Keputusan', 'Rekomendasi', 'Edaran', 'Lain-lain'];
const SIFAT = ['Biasa', 'Penting', 'Segera', 'Sangat Segera', 'Rahasia'];

export default function SuratPanel({
  userName = 'Staff DKC',
  refreshTrigger = 0,
}: {
  userName?: string;
  refreshTrigger?: number;
}) {
  const [items, setItems] = useState<SuratItem[]>([]);
  const [stats, setStats] = useState({ totalSurat: 0, totalMasuk: 0, totalKeluar: 0, totalPenting: 0 });
  const [loading, setLoading] = useState(true);
  const [jenisFilter, setJenisFilter] = useState('Semua');
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Form
  const [jenis, setJenis] = useState<'Surat Masuk' | 'Surat Keluar'>('Surat Masuk');
  const [nomorSurat, setNomorSurat] = useState('');
  const [tanggalSurat, setTanggalSurat] = useState(() => new Date().toISOString().slice(0, 10));
  const [pengirim, setPengirim] = useState('');
  const [tujuan, setTujuan] = useState('DKC Cilacap');
  const [perihal, setPerihal] = useState('');
  const [kategori, setKategori] = useState('Undangan');
  const [sifat, setSifat] = useState('Biasa');
  const [ringkasan, setRingkasan] = useState('');
  const [berkas, setBerkas] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/surat?jenis=${encodeURIComponent(jenisFilter)}`);
      const json = await res.json();
      if (json.success && json.data) {
        setItems(json.data.items || []);
        if (json.data.stats) setStats(json.data.stats);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [jenisFilter]);

  useEffect(() => {
    loadData();
  }, [loadData, refreshTrigger]);

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(
      (it) =>
        it.perihal.toLowerCase().includes(q) ||
        it.nomorSurat.toLowerCase().includes(q) ||
        it.pengirim.toLowerCase().includes(q) ||
        it.kodeArsip.toLowerCase().includes(q)
    );
  }, [items, search]);

  const handleScanFile = async (file: File) => {
    setScanning(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/surat/scan', { method: 'POST', body: fd });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);

      if (json.fileUrl) setBerkas(json.fileUrl);
      if (json.parsed) {
        const p = json.parsed;
        if (p.jenis) setJenis(p.jenis);
        if (p.nomorSurat) setNomorSurat(p.nomorSurat);
        if (p.tanggalSurat) setTanggalSurat(p.tanggalSurat);
        if (p.pengirim) setPengirim(p.pengirim);
        if (p.tujuan) setTujuan(p.tujuan);
        if (p.perihal) setPerihal(p.perihal);
        if (p.kategori) setKategori(p.kategori);
        if (p.sifat) setSifat(p.sifat);
        if (p.ringkasan) setRingkasan(p.ringkasan);
      }
      setMsg('✅ Berkas berhasil dipindai AI! Periksa isian di bawah lalu klik Simpan.');
    } catch (err: any) {
      setMsg(`❌ ${err?.message || 'Gagal memindai berkas surat'}`);
    } finally {
      setScanning(false);
    }
  };

  const submitSurat = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/surat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jenis,
          nomorSurat: nomorSurat || '-',
          tanggalSurat,
          tanggalDiterima: tanggalSurat,
          pengirim: pengirim || '-',
          tujuan: tujuan || '-',
          perihal,
          kategori,
          sifat,
          ringkasan: ringkasan || '-',
          berkas,
          pic: userName,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);

      setMsg(`✅ Surat berhasil diarsipkan (${json.item?.kodeArsip || ''}).`);
      setNomorSurat('');
      setPengirim('');
      setPerihal('');
      setRingkasan('');
      setBerkas('');
      setShowAdd(false);
      await loadData();
    } catch (err: any) {
      setMsg(`❌ ${err?.message || 'Gagal menyimpan surat'}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {msg && (
        <div className="p-card" style={{ padding: '12px 16px', fontSize: 14, fontWeight: 600 }}>
          {msg}
        </div>
      )}

      {/* Action Bar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select className="p-select" style={{ width: 'auto', fontWeight: 600 }} value={jenisFilter} onChange={(e) => setJenisFilter(e.target.value)}>
            <option value="Semua">Semua Surat</option>
            <option value="Surat Masuk">Surat Masuk</option>
            <option value="Surat Keluar">Surat Keluar</option>
          </select>
          <button type="button" className="p-btn p-btn-outline" onClick={loadData} disabled={loading}>
            {loading ? 'Memuat...' : '↻ Segarkan'}
          </button>
        </div>

        <button type="button" className="p-btn p-btn-primary" onClick={() => setShowAdd(true)}>
          + Catat / Scan Surat
        </button>
      </div>

      {/* Stats */}
      <div className="p-grid-stats" style={{ marginBottom: 0 }}>
        <div className="p-stat-card highlight">
          <div className="p-stat-label">Total Arsip Surat</div>
          <div className="p-stat-value">{stats.totalSurat}</div>
        </div>
        <div className="p-stat-card">
          <div className="p-stat-label">Surat Masuk</div>
          <div className="p-stat-value">{stats.totalMasuk}</div>
        </div>
        <div className="p-stat-card">
          <div className="p-stat-label">Surat Keluar</div>
          <div className="p-stat-value">{stats.totalKeluar}</div>
        </div>
        <div className="p-stat-card">
          <div className="p-stat-label" style={{ color: '#B91C1C' }}>Penting / Segera</div>
          <div className="p-stat-value" style={{ color: '#B91C1C' }}>{stats.totalPenting}</div>
        </div>
      </div>

      {/* Search */}
      <div className="p-card" style={{ padding: 12 }}>
        <input
          className="p-input"
          placeholder="Cari perihal, nomor surat, pengirim, atau kode arsip..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Table (Desktop) */}
      <div className="p-card desktop-only-table" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="p-table-wrap">
          <table className="p-table">
            <thead>
              <tr>
                <th>Kode</th>
                <th>Jenis</th>
                <th>Tanggal</th>
                <th>Perihal & Nomor</th>
                <th>Pengirim / Tujuan</th>
                <th>Berkas</th>
              </tr>
            </thead>
            <tbody>
              {loading && items.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: 32, color: '#64748B' }}>
                    Memuat arsip persuratan...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: 32, color: '#64748B' }}>
                    Belum ada arsip surat.
                  </td>
                </tr>
              ) : (
                filtered.map((s) => (
                  <tr key={s.kodeArsip}>
                    <td style={{ fontWeight: 700, fontSize: 13 }}>{s.kodeArsip}</td>
                    <td>
                      <span
                        className="p-badge"
                        style={{
                          background: s.jenis === 'Surat Masuk' ? '#DBEAFE' : '#DCFCE7',
                          color: s.jenis === 'Surat Masuk' ? '#1E40AF' : '#166534',
                        }}
                      >
                        {s.jenis}
                      </span>
                    </td>
                    <td style={{ whiteSpace: 'nowrap', fontSize: 13 }}>{s.tanggalSurat}</td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{s.perihal}</div>
                      <div style={{ fontSize: 12, color: '#64748B' }}>No: {s.nomorSurat} • {s.kategori}</div>
                    </td>
                    <td style={{ fontSize: 13 }}>
                      <div>Dari: {s.pengirim}</div>
                      <div style={{ color: '#64748B' }}>Ke: {s.tujuan}</div>
                    </td>
                    <td>
                      {s.berkas ? (
                        <a
                          href={s.berkas.split('\n')[0]}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: 'var(--accent)', fontWeight: 600, fontSize: 13 }}
                        >
                          Buka
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

      {/* Cards (Mobile HP) */}
      <div className="mobile-only-cards">
        {loading && items.length === 0 ? (
          <div className="p-card" style={{ textAlign: 'center', color: '#64748B', fontSize: 14 }}>
            Memuat arsip persuratan...
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-card" style={{ textAlign: 'center', color: '#64748B', fontSize: 14 }}>
            Belum ada arsip surat.
          </div>
        ) : (
          filtered.map((s) => (
            <div key={s.kodeArsip} className="m-item-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#64748B' }}>{s.kodeArsip} • {s.tanggalSurat}</span>
                <span
                  className="p-badge"
                  style={{
                    background: s.jenis === 'Surat Masuk' ? '#DBEAFE' : '#DCFCE7',
                    color: s.jenis === 'Surat Masuk' ? '#1E40AF' : '#166534',
                  }}
                >
                  {s.jenis}
                </span>
              </div>
              <div style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.35 }}>{s.perihal}</div>
              <div style={{ fontSize: 12, color: '#64748B' }}>
                No: {s.nomorSurat} • Dari: {s.pengirim}
              </div>
              {s.berkas && (
                <div>
                  <a
                    href={s.berkas.split('\n')[0]}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 13 }}
                  >
                    📄 Buka Berkas Surat
                  </a>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Add Modal */}
      {showAdd && (
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
          onClick={() => !busy && setShowAdd(false)}
        >
          <div
            className="p-card"
            style={{ width: '100%', maxWidth: 500, maxHeight: '90dvh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: 18 }}>Catat / Scan Surat Baru</h3>
              <button
                type="button"
                onClick={() => !busy && setShowAdd(false)}
                style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <div
              style={{
                padding: 12,
                borderRadius: 10,
                background: 'var(--accent-soft)',
                border: '1px dashed var(--accent-border)',
                marginBottom: 14,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                📷 Scan Otomatis dengan AI (Opsional)
              </div>
              <input
                type="file"
                accept="image/*,.pdf"
                disabled={scanning}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleScanFile(f);
                }}
              />
              {scanning && <div style={{ fontSize: 12, marginTop: 6, fontWeight: 600 }}>Sedang membaca isi surat...</div>}
            </div>

            <form onSubmit={submitSurat} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600 }}>Jenis Surat</label>
                  <select className="p-select" value={jenis} onChange={(e) => setJenis(e.target.value as any)}>
                    <option value="Surat Masuk">Surat Masuk</option>
                    <option value="Surat Keluar">Surat Keluar</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600 }}>Tanggal Surat</label>
                  <input className="p-input" type="date" value={tanggalSurat} onChange={(e) => setTanggalSurat(e.target.value)} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600 }}>Perihal</label>
                <input className="p-input" required value={perihal} onChange={(e) => setPerihal(e.target.value)} placeholder="Perihal surat" />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600 }}>Nomor Surat</label>
                <input className="p-input" value={nomorSurat} onChange={(e) => setNomorSurat(e.target.value)} placeholder="Nomor surat" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600 }}>Pengirim</label>
                  <input className="p-input" value={pengirim} onChange={(e) => setPengirim(e.target.value)} placeholder="Asal surat" />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600 }}>Tujuan</label>
                  <input className="p-input" value={tujuan} onChange={(e) => setTujuan(e.target.value)} placeholder="Tujuan surat" />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600 }}>Kategori</label>
                  <select className="p-select" value={kategori} onChange={(e) => setKategori(e.target.value)}>
                    {KATEGORI.map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600 }}>Sifat</label>
                  <select className="p-select" value={sifat} onChange={(e) => setSifat(e.target.value)}>
                    {SIFAT.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <button type="submit" className="p-btn p-btn-primary" disabled={busy || scanning}>
                {busy ? 'Menyimpan...' : 'Simpan Arsip Surat'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
