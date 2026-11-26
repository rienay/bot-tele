'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';

interface InventarisItem {
  kodeBarang: string;
  namaBarang: string;
  unit: string;
  jumlah: string | number;
  tahun: string | number;
  sumber: string;
  kondisi: string;
  foto: string;
  displayFoto?: string;
  keterangan: string;
}

const UNITS = ['DKC', 'CYJI', 'Paspanca', 'Ubaloka', 'UNPASA'];
const KONDISI_LIST = ['Baik', 'Rusak Ringan', 'Rusak Berat', 'Hilang'];

export default function InventarisPanel({
  unitOnly = null,
  refreshTrigger = 0,
}: {
  unitOnly?: 'CYJI' | 'Paspanca' | 'Ubaloka' | 'UNPASA' | null;
  refreshTrigger?: number;
}) {
  const [items, setItems] = useState<InventarisItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [unitFilter, setUnitFilter] = useState<string>(unitOnly || 'Semua');
  const [kondisiFilter, setKondisiFilter] = useState('Semua');
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Add form
  const [namaBarang, setNamaBarang] = useState('');
  const [unit, setUnit] = useState<string>(unitOnly || 'DKC');
  const [jumlah, setJumlah] = useState('1');
  const [tahun, setTahun] = useState(String(new Date().getFullYear()));
  const [sumber, setSumber] = useState('Pembelian Kas');
  const [kondisi, setKondisi] = useState('Baik');
  const [keterangan, setKeterangan] = useState('');
  const [file, setFile] = useState<File | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const targetUnit = unitOnly || unitFilter;
      const res = await fetch(
        `/api/inventaris?unit=${encodeURIComponent(targetUnit)}&kondisi=${encodeURIComponent(kondisiFilter)}`
      );
      const json = await res.json();
      if (json.success && json.data) {
        setItems(json.data.items || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [unitOnly, unitFilter, kondisiFilter]);

  useEffect(() => {
    loadData();
  }, [loadData, refreshTrigger]);

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(
      (it) =>
        it.namaBarang.toLowerCase().includes(q) ||
        it.kodeBarang.toLowerCase().includes(q) ||
        it.unit.toLowerCase().includes(q) ||
        it.keterangan.toLowerCase().includes(q)
    );
  }, [items, search]);

  const stats = useMemo(() => {
    let baik = 0;
    let rusak = 0;
    for (const it of filtered) {
      if (it.kondisi === 'Baik') baik++;
      else rusak++;
    }
    return { total: filtered.length, baik, rusak };
  }, [filtered]);

  const submitAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append('namaBarang', namaBarang);
      fd.append('unit', unitOnly || unit);
      fd.append('jumlah', jumlah);
      fd.append('tahun', tahun);
      fd.append('sumber', sumber);
      fd.append('kondisi', kondisi);
      fd.append('keterangan', keterangan || '-');
      if (file) fd.append('file', file);

      const res = await fetch('/api/inventaris', { method: 'POST', body: fd });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);

      setMsg(`✅ Barang "${namaBarang}" berhasil dicatat (${json.item?.kodeBarang || ''}).`);
      setNamaBarang('');
      setJumlah('1');
      setKeterangan('');
      setFile(null);
      setShowAdd(false);
      await loadData();
    } catch (err: any) {
      setMsg(`❌ ${err?.message || 'Gagal menambah barang'}`);
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

      {/* Top Action Bar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {!unitOnly && (
            <select
              className="p-select"
              style={{ width: 'auto', fontWeight: 600 }}
              value={unitFilter}
              onChange={(e) => setUnitFilter(e.target.value)}
            >
              <option value="Semua">Semua Unit</option>
              {UNITS.map((u) => (
                <option key={u} value={u}>{u === 'CYJI' ? 'CYJI (Cyber)' : u}</option>
              ))}
            </select>
          )}
          <select
            className="p-select"
            style={{ width: 'auto' }}
            value={kondisiFilter}
            onChange={(e) => setKondisiFilter(e.target.value)}
          >
            <option value="Semua">Semua Kondisi</option>
            {KONDISI_LIST.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <button type="button" className="p-btn p-btn-outline" onClick={loadData} disabled={loading}>
            {loading ? 'Memuat...' : '↻ Segarkan'}
          </button>
        </div>

        <button type="button" className="p-btn p-btn-primary" onClick={() => setShowAdd(true)}>
          + Tambah Barang {unitOnly ? `(${unitOnly})` : ''}
        </button>
      </div>

      {/* Stats */}
      <div className="p-grid-stats" style={{ marginBottom: 0 }}>
        <div className="p-stat-card highlight">
          <div className="p-stat-label">Total Barang {unitOnly ? `Unit ${unitOnly}` : ''}</div>
          <div className="p-stat-value">{stats.total}</div>
        </div>
        <div className="p-stat-card">
          <div className="p-stat-label" style={{ color: '#047857' }}>Kondisi Baik</div>
          <div className="p-stat-value" style={{ color: '#047857' }}>{stats.baik}</div>
        </div>
        <div className="p-stat-card">
          <div className="p-stat-label" style={{ color: '#B91C1C' }}>Perlu Perhatian / Rusak</div>
          <div className="p-stat-value" style={{ color: '#B91C1C' }}>{stats.rusak}</div>
        </div>
      </div>

      {/* Search */}
      <div className="p-card" style={{ padding: 12 }}>
        <input
          className="p-input"
          placeholder="Cari nama barang, kode barang, atau keterangan..."
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
                <th>Nama Barang</th>
                {!unitOnly && <th>Unit</th>}
                <th>Jumlah</th>
                <th>Tahun</th>
                <th>Kondisi</th>
                <th>Foto</th>
              </tr>
            </thead>
            <tbody>
              {loading && items.length === 0 ? (
                <tr>
                  <td colSpan={unitOnly ? 6 : 7} style={{ textAlign: 'center', padding: 32, color: '#64748B' }}>
                    Memuat data inventaris...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={unitOnly ? 6 : 7} style={{ textAlign: 'center', padding: 32, color: '#64748B' }}>
                    Belum ada barang inventaris.
                  </td>
                </tr>
              ) : (
                filtered.map((it) => (
                  <tr key={it.kodeBarang}>
                    <td style={{ fontWeight: 700, fontSize: 13 }}>{it.kodeBarang}</td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{it.namaBarang}</div>
                      {it.keterangan && it.keterangan !== '-' && (
                        <div style={{ fontSize: 12, color: '#64748B' }}>{it.keterangan}</div>
                      )}
                    </td>
                    {!unitOnly && (
                      <td><span className="p-badge">{it.unit}</span></td>
                    )}
                    <td>{it.jumlah}</td>
                    <td>{it.tahun}</td>
                    <td>
                      <span
                        className="p-badge"
                        style={{
                          background: it.kondisi === 'Baik' ? '#DCFCE7' : '#FEE2E2',
                          color: it.kondisi === 'Baik' ? '#166534' : '#991B1B',
                        }}
                      >
                        {it.kondisi}
                      </span>
                    </td>
                    <td>
                      {it.foto ? (
                        <a
                          href={it.foto}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: 'var(--accent)', fontWeight: 600, fontSize: 13 }}
                        >
                          Lihat Foto
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
            Memuat data inventaris...
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-card" style={{ textAlign: 'center', color: '#64748B', fontSize: 14 }}>
            Belum ada barang inventaris.
          </div>
        ) : (
          filtered.map((it) => (
            <div key={it.kodeBarang} className="m-item-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#64748B' }}>{it.kodeBarang}</div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{it.namaBarang}</div>
                </div>
                <span
                  className="p-badge"
                  style={{
                    background: it.kondisi === 'Baik' ? '#DCFCE7' : '#FEE2E2',
                    color: it.kondisi === 'Baik' ? '#166534' : '#991B1B',
                    flexShrink: 0,
                  }}
                >
                  {it.kondisi}
                </span>
              </div>
              {it.keterangan && it.keterangan !== '-' && (
                <div style={{ fontSize: 12, color: '#64748B' }}>{it.keterangan}</div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: '#475569' }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {!unitOnly && <span className="p-badge">{it.unit}</span>}
                  <span>Jumlah: <strong>{it.jumlah}</strong></span>
                  <span>• {it.tahun}</span>
                </div>
                {it.foto && (
                  <a
                    href={it.foto}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'var(--accent)', fontWeight: 700 }}
                  >
                    📷 Foto
                  </a>
                )}
              </div>
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
            style={{ width: '100%', maxWidth: 460, maxHeight: '90dvh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: 18 }}>Tambah Barang Inventaris</h3>
              <button
                type="button"
                onClick={() => !busy && setShowAdd(false)}
                style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={submitAdd} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600 }}>Nama Barang</label>
                <input className="p-input" required value={namaBarang} onChange={(e) => setNamaBarang(e.target.value)} placeholder="Contoh: Tenda Dome Kapasitas 4" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600 }}>Unit</label>
                  {unitOnly ? (
                    <input className="p-input" value={unitOnly} disabled />
                  ) : (
                    <select className="p-select" value={unit} onChange={(e) => setUnit(e.target.value)}>
                      {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                  )}
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600 }}>Jumlah</label>
                  <input className="p-input" required value={jumlah} onChange={(e) => setJumlah(e.target.value)} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600 }}>Kondisi</label>
                  <select className="p-select" value={kondisi} onChange={(e) => setKondisi(e.target.value)}>
                    {KONDISI_LIST.map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600 }}>Tahun</label>
                  <input className="p-input" value={tahun} onChange={(e) => setTahun(e.target.value)} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600 }}>Sumber</label>
                <input className="p-input" value={sumber} onChange={(e) => setSumber(e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600 }}>Keterangan (Opsional)</label>
                <input className="p-input" value={keterangan} onChange={(e) => setKeterangan(e.target.value)} placeholder="Lokasi simpan atau catatan" />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600 }}>Foto Barang (Opsional)</label>
                <input className="p-input" type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} />
              </div>
              <button type="submit" className="p-btn p-btn-primary" disabled={busy}>
                {busy ? 'Menyimpan...' : 'Simpan Barang'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
