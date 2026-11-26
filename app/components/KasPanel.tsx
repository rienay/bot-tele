'use client';

import { useState, useEffect, useCallback } from 'react';

interface KasData {
  anggota: { nama: string; jabatan: string; tahunMasuk: string; status: string }[];
  statusBulan: {
    bulan: string;
    tahun: number;
    sudahBayar: { nama: string; jabatan: string; bayar: number; tgl: string }[];
    belumBayar: { nama: string; jabatan: string; kurang: number }[];
    totalTerkumpul: number;
  };
  nominalDefault: number;
  daftarBulan: string[];
}

const BULAN_LIST = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

export default function KasPanel({ refreshTrigger = 0 }: { refreshTrigger?: number }) {
  const now = new Date();
  const [bulan, setBulan] = useState(BULAN_LIST[now.getMonth()]);
  const [tahun, setTahun] = useState(now.getFullYear());
  const [data, setData] = useState<KasData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyNama, setBusyNama] = useState<string | null>(null);
  const [newNama, setNewNama] = useState('');
  const [newJabatan, setNewJabatan] = useState('Anggota');
  const [msg, setMsg] = useState<string | null>(null);

  const loadKas = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/kas?bulan=${encodeURIComponent(bulan)}&tahun=${tahun}`);
      const json = await res.json();
      if (json.success) setData(json.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [bulan, tahun]);

  useEffect(() => {
    loadKas();
  }, [loadKas, refreshTrigger]);

  const bayarKas = async (nama: string) => {
    setBusyNama(nama);
    setMsg(null);
    try {
      const res = await fetch('/api/kas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'bayar',
          nama,
          bulan,
          tahun,
          nominal: data?.nominalDefault || 10000,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || json.error);
      setMsg(`✅ Kas ${nama} bulan ${bulan} ${tahun} berhasil dicatat lunas.`);
      await loadKas();
    } catch (err: any) {
      setMsg(`❌ ${err?.message || 'Gagal mencatat pembayaran'}`);
    } finally {
      setBusyNama(null);
    }
  };

  const tambahAnggota = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNama.trim()) return;
    setBusyNama('__add__');
    setMsg(null);
    try {
      const res = await fetch('/api/kas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'tambah_anggota', nama: newNama.trim(), jabatan: newJabatan.trim() }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setMsg(`✅ ${json.message}`);
      setNewNama('');
      await loadKas();
    } catch (err: any) {
      setMsg(`❌ ${err?.message || 'Gagal menambah anggota'}`);
    } finally {
      setBusyNama(null);
    }
  };

  const st = data?.statusBulan;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {msg && (
        <div className="p-card" style={{ padding: '12px 16px', fontSize: 14, fontWeight: 600 }}>
          {msg}
        </div>
      )}

      {/* Filter Bulan & Tahun */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select className="p-select" style={{ width: 'auto' }} value={bulan} onChange={(e) => setBulan(e.target.value)}>
            {BULAN_LIST.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <input
            className="p-input"
            type="number"
            style={{ width: 100 }}
            value={tahun}
            onChange={(e) => setTahun(Number(e.target.value) || now.getFullYear())}
          />
          <button type="button" className="p-btn p-btn-outline" onClick={loadKas} disabled={loading}>
            {loading ? 'Memuat...' : '↻ Segarkan'}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="p-grid-stats" style={{ marginBottom: 0 }}>
        <div className="p-stat-card highlight">
          <div className="p-stat-label">Terkumpul ({bulan} {tahun})</div>
          <div className="p-stat-value">Rp{(st?.totalTerkumpul || 0).toLocaleString('id-ID')}</div>
        </div>
        <div className="p-stat-card">
          <div className="p-stat-label" style={{ color: '#047857' }}>Sudah Bayar</div>
          <div className="p-stat-value" style={{ color: '#047857' }}>{st?.sudahBayar.length || 0} orang</div>
        </div>
        <div className="p-stat-card">
          <div className="p-stat-label" style={{ color: '#B91C1C' }}>Belum Bayar</div>
          <div className="p-stat-value" style={{ color: '#B91C1C' }}>{st?.belumBayar.length || 0} orang</div>
        </div>
      </div>

      {/* Two columns: Belum Bayar & Sudah Bayar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
        <div className="p-card">
          <h3 style={{ margin: '0 0 12px', fontSize: 16, color: '#B91C1C' }}>
            Belum Bayar ({st?.belumBayar.length || 0})
          </h3>
          {loading && !data ? (
            <p style={{ color: '#64748B', fontSize: 14 }}>Memuat...</p>
          ) : (st?.belumBayar.length || 0) === 0 ? (
            <p style={{ color: '#047857', fontSize: 14, fontWeight: 600 }}>Semua anggota sudah lunas!</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {st?.belumBayar.map((item) => (
                <div
                  key={item.nama}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 12px',
                    borderRadius: 10,
                    background: '#FEF2F2',
                    border: '1px solid #FECACA',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{item.nama}</div>
                    <div style={{ fontSize: 12, color: '#64748B' }}>{item.jabatan}</div>
                  </div>
                  <button
                    type="button"
                    className="p-btn p-btn-primary"
                    style={{ padding: '6px 12px', fontSize: 12 }}
                    disabled={busyNama === item.nama}
                    onClick={() => bayarKas(item.nama)}
                  >
                    {busyNama === item.nama ? 'Menyimpan...' : 'Tandai Lunas'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-card">
          <h3 style={{ margin: '0 0 12px', fontSize: 16, color: '#047857' }}>
            Sudah Lunas ({st?.sudahBayar.length || 0})
          </h3>
          {loading && !data ? (
            <p style={{ color: '#64748B', fontSize: 14 }}>Memuat...</p>
          ) : (st?.sudahBayar.length || 0) === 0 ? (
            <p style={{ color: '#64748B', fontSize: 14 }}>Belum ada yang membayar bulan ini.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {st?.sudahBayar.map((item) => (
                <div
                  key={item.nama}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 12px',
                    borderRadius: 10,
                    background: '#ECFDF5',
                    border: '1px solid #A7F3D0',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{item.nama}</div>
                    <div style={{ fontSize: 12, color: '#047857' }}>
                      {item.jabatan} {item.tgl ? `• ${item.tgl}` : ''}
                    </div>
                  </div>
                  <span className="p-badge" style={{ background: '#D1FAE5', color: '#065F46' }}>
                    Rp{item.bayar.toLocaleString('id-ID')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Tambah Anggota */}
      <div className="p-card">
        <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>Tambah Anggota Kas Baru</h3>
        <form onSubmit={tambahAnggota} style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          <input
            className="p-input"
            style={{ flex: '1 1 200px' }}
            placeholder="Nama anggota"
            value={newNama}
            onChange={(e) => setNewNama(e.target.value)}
            required
          />
          <input
            className="p-input"
            style={{ flex: '1 1 160px' }}
            placeholder="Jabatan (cth: Anggota)"
            value={newJabatan}
            onChange={(e) => setNewJabatan(e.target.value)}
          />
          <button type="submit" className="p-btn p-btn-primary" disabled={busyNama === '__add__'}>
            {busyNama === '__add__' ? 'Menambah...' : '+ Tambah Anggota'}
          </button>
        </form>
      </div>
    </div>
  );
}
