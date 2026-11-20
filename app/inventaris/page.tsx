'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';

export interface InventarisItem {
  rowNumber?: number;
  kodeBarang: string;
  namaBarang: string;
  unit: string;
  jumlah: string | number;
  tahun: string | number;
  sumber: string;
  kondisi: string;
  foto: string;
  keterangan: string;
  waktuInput: string;
}

export interface UnitConfig {
  id: string;
  name: string;
  prefix: string;
  fullName: string;
  badgeBg: string;
  badgeText: string;
}

const DAFTAR_UNIT: UnitConfig[] = [
  { id: 'DKC', name: 'DKC', prefix: 'D', fullName: 'Dewan Kerja Cabang', badgeBg: '#e0edff', badgeText: '#185abd' },
  { id: 'CYJI', name: 'CYJI', prefix: 'C', fullName: 'Cilacap Youth Journalist', badgeBg: '#e0f2fe', badgeText: '#0284c7' },
  { id: 'Paspanca', name: 'Paspanca', prefix: 'PS', fullName: 'Pasukan Tunas Panca', badgeBg: '#ede9fe', badgeText: '#6366f1' },
  { id: 'Ubaloka', name: 'Ubaloka', prefix: 'U', fullName: 'Unit Bantu Pertolongan Pramuka', badgeBg: '#ccfbf1', badgeText: '#0f766e' },
  { id: 'UNPASA', name: 'UNPASA', prefix: 'P', fullName: 'Unit Protokol Satria', badgeBg: '#cffafe', badgeText: '#0891b2' },
];

export default function InventarisPage() {
  const [items, setItems] = useState<InventarisItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter State
  const [selectedUnit, setSelectedUnit] = useState<string>('Semua');
  const [selectedKondisi, setSelectedKondisi] = useState<string>('Semua');
  const [selectedTahun, setSelectedTahun] = useState<string>('Semua');
  const [searchQuery, setSearchQuery] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Modal State
  const [previewPhoto, setPreviewPhoto] = useState<{ url: string; title: string; code: string } | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [addSuccessMsg, setAddSuccessMsg] = useState<string | null>(null);

  // Form State
  const [formUnit, setFormUnit] = useState('DKC');
  const [formNama, setFormNama] = useState('');
  const [formJumlah, setFormJumlah] = useState('1');
  const [formTahun, setFormTahun] = useState(String(new Date().getFullYear()));
  const [formSumber, setFormSumber] = useState('Pembelian Kas');
  const [formKondisi, setFormKondisi] = useState('Baik');
  const [formFoto, setFormFoto] = useState('');
  const [formKet, setFormKet] = useState('');

  const fetchData = async (showSpinner = false) => {
    if (showSpinner) setIsRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/inventaris');
      const json = await res.json();
      if (json.success && json.data) {
        setItems(json.data.items || []);
      } else {
        throw new Error(json.error || 'Gagal memuat data inventaris');
      }
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Terjadi gangguan saat mengambil data inventaris.');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Filter items
  const filteredItems = useMemo(() => {
    return items.filter((it) => {
      // Filter Unit
      if (selectedUnit !== 'Semua' && it.unit.toLowerCase() !== selectedUnit.toLowerCase()) {
        return false;
      }

      // Filter Kondisi
      if (selectedKondisi !== 'Semua' && it.kondisi.toLowerCase() !== selectedKondisi.toLowerCase()) {
        return false;
      }

      // Filter Tahun
      if (selectedTahun !== 'Semua' && String(it.tahun) !== selectedTahun) {
        return false;
      }

      // Filter Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchNama = it.namaBarang.toLowerCase().includes(q);
        const matchKode = it.kodeBarang.toLowerCase().includes(q);
        const matchUnit = it.unit.toLowerCase().includes(q);
        const matchSumber = it.sumber.toLowerCase().includes(q);
        const matchKet = it.keterangan.toLowerCase().includes(q);
        const matchTahun = String(it.tahun).includes(q);

        return matchNama || matchKode || matchUnit || matchSumber || matchKet || matchTahun;
      }

      return true;
    });
  }, [items, selectedUnit, selectedKondisi, selectedTahun, searchQuery]);

  // Available Years
  const availableYears = useMemo(() => {
    const years = new Set<string>();
    items.forEach((it) => {
      const y = String(it.tahun).trim();
      if (y && y !== '-') years.add(y);
    });
    return Array.from(years).sort((a, b) => b.localeCompare(a));
  }, [items]);

  // Summary Metrics
  const stats = useMemo(() => {
    let totalQty = 0;
    let baikCount = 0;
    let rusakCount = 0;

    const unitCounts: Record<string, number> = {
      DKC: 0,
      CYJI: 0,
      Paspanca: 0,
      Ubaloka: 0,
      UNPASA: 0,
    };

    items.forEach((it) => {
      const rawQty = parseInt(String(it.jumlah).replace(/[^0-9]/g, ''), 10) || 1;
      totalQty += rawQty;

      const u = it.unit;
      if (unitCounts[u] !== undefined) {
        unitCounts[u] += 1;
      }

      if (it.kondisi.toLowerCase().includes('baik')) {
        baikCount += 1;
      } else {
        rusakCount += 1;
      }
    });

    return {
      totalItems: items.length,
      totalQty,
      unitCounts,
      baikCount,
      rusakCount,
    };
  }, [items]);

  const handleResetFilters = () => {
    setSelectedUnit('Semua');
    setSelectedKondisi('Semua');
    setSelectedTahun('Semua');
    setSearchQuery('');
  };

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formNama.trim()) {
      alert('Nama barang wajib diisi!');
      return;
    }

    setIsSubmitting(true);
    setAddSuccessMsg(null);

    try {
      const res = await fetch('/api/inventaris', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unit: formUnit,
          namaBarang: formNama,
          jumlah: formJumlah,
          tahun: formTahun,
          sumber: formSumber,
          kondisi: formKondisi,
          foto: formFoto,
          keterangan: formKet,
        }),
      });

      const json = await res.json();
      if (json.success && json.item) {
        setAddSuccessMsg(`Barang berhasil dicatat dengan kode: ${json.item.kodeBarang}`);
        setFormNama('');
        setFormFoto('');
        setFormKet('');
        await fetchData(true);
        setTimeout(() => {
          setShowAddModal(false);
          setAddSuccessMsg(null);
        }, 1800);
      } else {
        throw new Error(json.error || 'Gagal menyimpan barang');
      }
    } catch (err: any) {
      alert(`Gagal: ${err?.message || err}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const exportCsv = () => {
    if (filteredItems.length === 0) {
      alert('Tidak ada data yang dapat diunduh.');
      return;
    }

    const headers = ['No', 'Kode Barang', 'Nama Barang', 'Unit', 'Jumlah', 'Tahun', 'Sumber', 'Kondisi', 'Keterangan', 'Link Foto', 'Waktu Input'];
    const rows = filteredItems.map((it, idx) => [
      idx + 1,
      `"${it.kodeBarang}"`,
      `"${it.namaBarang.replace(/"/g, '""')}"`,
      `"${it.unit}"`,
      `"${it.jumlah}"`,
      `"${it.tahun}"`,
      `"${it.sumber.replace(/"/g, '""')}"`,
      `"${it.kondisi}"`,
      `"${it.keterangan.replace(/"/g, '""')}"`,
      `"${it.foto}"`,
      `"${it.waktuInput}"`,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Inventaris_Barang_${selectedUnit}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="word-theme-wrapper">
      {/* Top Application Ribbon (Microsoft Word Style) */}
      <header className="word-ribbon">
        <div className="word-ribbon-container">
          <div className="word-brand-area">
            <div className="word-app-icon">
              <span>W</span>
            </div>
            <div>
              <div className="word-app-title">SISTEM INVENTARIS BARANG</div>
              <div className="word-app-subtitle">Kwarcab 11.01 Cilacap — Biro Perlengkapan & Logistik</div>
            </div>
          </div>

          <div className="word-nav-tabs">
            <Link href="/" className="word-nav-link">
              <span>💰</span>
              <span>Buku Kas & Keuangan</span>
            </Link>
            <Link href="/inventaris" className="word-nav-link active">
              <span>📦</span>
              <span>Inventaris Barang</span>
            </Link>
            <a
              href="https://t.me/duit_pwd_bot"
              target="_blank"
              rel="noopener noreferrer"
              className="word-nav-bot"
              title="Input via Bot Telegram"
            >
              <span>🤖</span>
              <span>@duit_pwd_bot</span>
            </a>
          </div>
        </div>
      </header>

      {/* Main Document Body */}
      <main className="word-document-container">
        {/* Document Header Banner */}
        <section className="word-doc-header">
          <div className="word-doc-title-row">
            <div>
              <span className="word-doc-tag">DAFTAR INVENTARISASI LOGISTIK</span>
              <h1 className="word-doc-h1">Buku Inventaris Barang & Perlengkapan</h1>
              <p className="word-doc-desc">
                Pendataan terpusat seluruh inventaris resmi DKC Cilacap, Unit CYJI, Unit Paspanca, Unit Ubaloka, dan Unit UNPASA.
              </p>
            </div>

            <div className="word-header-actions">
              <button
                onClick={() => fetchData(true)}
                disabled={isRefreshing}
                className="word-btn word-btn-secondary"
                title="Segarkan data terbaru"
              >
                <span>{isRefreshing ? '⏳' : '🔄'}</span>
                <span>{isRefreshing ? 'Menyinkronkan...' : 'Segarkan Data'}</span>
              </button>
              <button onClick={() => setShowAddModal(true)} className="word-btn word-btn-primary">
                <span>➕</span>
                <span>Tambah Barang</span>
              </button>
            </div>
          </div>

          {/* Metric Stat Ribbon Cards */}
          <div className="word-stats-ribbon">
            <div className="word-stat-card">
              <div className="word-stat-label">Total Barang</div>
              <div className="word-stat-val text-blue">{loading ? '...' : items.length} Jenis</div>
              <div className="word-stat-sub">({stats.totalQty} total unit fisik)</div>
            </div>

            <div className="word-stat-card">
              <div className="word-stat-label">DKC Cilacap (D)</div>
              <div className="word-stat-val">{loading ? '...' : stats.unitCounts.DKC || 0}</div>
              <div className="word-stat-sub">Kode: D0001+</div>
            </div>

            <div className="word-stat-card">
              <div className="word-stat-label">Unit CYJI (C)</div>
              <div className="word-stat-val">{loading ? '...' : stats.unitCounts.CYJI || 0}</div>
              <div className="word-stat-sub">Kode: C0001+</div>
            </div>

            <div className="word-stat-card">
              <div className="word-stat-label">Paspanca (PS)</div>
              <div className="word-stat-val">{loading ? '...' : stats.unitCounts.Paspanca || 0}</div>
              <div className="word-stat-sub">Kode: PS0001+</div>
            </div>

            <div className="word-stat-card">
              <div className="word-stat-label">Ubaloka (U)</div>
              <div className="word-stat-val">{loading ? '...' : stats.unitCounts.Ubaloka || 0}</div>
              <div className="word-stat-sub">Kode: U0001+</div>
            </div>

            <div className="word-stat-card">
              <div className="word-stat-label">UNPASA (P)</div>
              <div className="word-stat-val">{loading ? '...' : stats.unitCounts.UNPASA || 0}</div>
              <div className="word-stat-sub">Kode: P0001+</div>
            </div>

            <div className="word-stat-card condition-stat">
              <div className="word-stat-label">Kondisi Barang</div>
              <div className="word-stat-condition-row">
                <span className="cond-badge baik">🟢 {stats.baikCount} Baik</span>
                <span className="cond-badge rusak">🔴 {stats.rusakCount} Rusak/Perbaikan</span>
              </div>
            </div>
          </div>
        </section>

        {/* Toolbar & Filters (Word Table Tools Style) */}
        <section className="word-toolbar-box">
          {/* Segment Unit Tabs */}
          <div className="word-unit-tabs">
            <button
              onClick={() => setSelectedUnit('Semua')}
              className={`word-tab-btn ${selectedUnit === 'Semua' ? 'active' : ''}`}
            >
              <span>🏛️ Semua Unit</span>
              <span className="tab-count">{items.length}</span>
            </button>
            {DAFTAR_UNIT.map((u) => {
              const count = stats.unitCounts[u.id] || 0;
              return (
                <button
                  key={u.id}
                  onClick={() => setSelectedUnit(u.id)}
                  className={`word-tab-btn ${selectedUnit === u.id ? 'active' : ''}`}
                >
                  <span className="unit-prefix-pill">{u.prefix}</span>
                  <span>{u.name}</span>
                  <span className="tab-count">{count}</span>
                </button>
              );
            })}
          </div>

          {/* Filter Controls Row */}
          <div className="word-filter-controls">
            <div className="word-search-wrapper">
              <span className="search-icon">🔍</span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari nama barang, kode (D0001...), sumber, atau lokasi..."
                className="word-search-input"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="search-clear-btn" title="Hapus pencarian">
                  ✕
                </button>
              )}
            </div>

            {/* Filter Kondisi */}
            <div className="word-select-group">
              <label>Kondisi:</label>
              <select
                value={selectedKondisi}
                onChange={(e) => setSelectedKondisi(e.target.value)}
                className="word-select"
              >
                <option value="Semua">Semua Kondisi</option>
                <option value="Baik">🟢 Baik</option>
                <option value="Rusak Ringan">🟡 Rusak Ringan</option>
                <option value="Rusak Berat">🔴 Rusak Berat</option>
                <option value="Hilang">⚪ Hilang</option>
              </select>
            </div>

            {/* Filter Tahun */}
            <div className="word-select-group">
              <label>Tahun:</label>
              <select
                value={selectedTahun}
                onChange={(e) => setSelectedTahun(e.target.value)}
                className="word-select"
              >
                <option value="Semua">Semua Tahun</option>
                {availableYears.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>

            {/* Tombol Export / Print */}
            <div className="word-export-group">
              <button onClick={exportCsv} className="word-btn word-btn-outline" title="Download file CSV untuk Microsoft Excel">
                <span>📥</span>
                <span>Unduh CSV</span>
              </button>
              <button onClick={() => window.print()} className="word-btn word-btn-outline" title="Cetak dokumen atau Simpan PDF">
                <span>🖨️</span>
                <span>Cetak</span>
              </button>
            </div>
          </div>

          {/* Active Filter Bar Info */}
          {(selectedUnit !== 'Semua' || selectedKondisi !== 'Semua' || selectedTahun !== 'Semua' || searchQuery) && (
            <div className="word-active-filter-bar">
              <span>
                Menampilkan <strong>{filteredItems.length}</strong> dari {items.length} barang
                {selectedUnit !== 'Semua' && ` • Unit: ${selectedUnit}`}
                {selectedKondisi !== 'Semua' && ` • Kondisi: ${selectedKondisi}`}
                {selectedTahun !== 'Semua' && ` • Tahun: ${selectedTahun}`}
                {searchQuery && ` • Kata kunci: "${searchQuery}"`}
              </span>
              <button onClick={handleResetFilters} className="word-reset-btn">
                ✕ Reset Filter
              </button>
            </div>
          )}
        </section>

        {/* Status Error */}
        {error && (
          <div className="word-error-box">
            <span>⚠️ {error}</span>
            <button onClick={() => fetchData()} className="word-retry-btn">
              Coba Lagi
            </button>
          </div>
        )}

        {/* Word Document Table */}
        <section className="word-table-card">
          <div className="word-table-wrapper">
            <table className="word-table">
              <thead>
                <tr>
                  <th style={{ width: '45px', textAlign: 'center' }}>No</th>
                  <th style={{ width: '75px', textAlign: 'center' }}>Foto</th>
                  <th style={{ width: '110px' }}>Kode Barang</th>
                  <th style={{ minWidth: '220px' }}>Nama Barang</th>
                  <th style={{ width: '100px', textAlign: 'center' }}>Unit</th>
                  <th style={{ width: '85px', textAlign: 'center' }}>Jumlah</th>
                  <th style={{ width: '80px', textAlign: 'center' }}>Tahun</th>
                  <th style={{ width: '130px' }}>Sumber</th>
                  <th style={{ width: '120px', textAlign: 'center' }}>Kondisi</th>
                  <th style={{ minWidth: '150px' }}>Keterangan / Lokasi</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={10} className="word-empty-cell">
                      <div className="word-loading-spinner">
                        <div className="spinner"></div>
                        <span>Memuat data tabel inventaris dari Google Sheets...</span>
                      </div>
                    </td>
                  </tr>
                ) : filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="word-empty-cell">
                      <div className="word-empty-box">
                        <span style={{ fontSize: '2.5rem' }}>📦</span>
                        <h3>Belum Ada Data Barang</h3>
                        <p>
                          {items.length === 0
                            ? 'Daftar inventaris masih kosong. Silakan klik tombol "Tambah Barang" di atas atau kirimkan foto nota/barang via bot Telegram.'
                            : 'Tidak ditemukan barang yang cocok dengan kriteria filter saat ini.'}
                        </p>
                        {items.length === 0 && (
                          <button onClick={() => setShowAddModal(true)} className="word-btn word-btn-primary" style={{ marginTop: '0.75rem' }}>
                            ➕ Tambah Barang Pertama
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((it, idx) => {
                    const unitConf = DAFTAR_UNIT.find((u) => u.id === it.unit);
                    const isBaik = it.kondisi.toLowerCase().includes('baik');
                    const isRusakRingan = it.kondisi.toLowerCase().includes('ringan');
                    const isRusakBerat = it.kondisi.toLowerCase().includes('berat');

                    return (
                      <tr key={it.kodeBarang || idx} className="word-tr-item">
                        <td style={{ textAlign: 'center', color: '#64748b', fontWeight: 600 }}>{idx + 1}</td>
                        <td style={{ textAlign: 'center' }}>
                          {it.foto ? (
                            <button
                              onClick={() => setPreviewPhoto({ url: it.foto, title: it.namaBarang, code: it.kodeBarang })}
                              className="word-photo-thumb-btn"
                              title="Klik untuk melihat foto barang"
                            >
                              <img
                                src={it.foto}
                                alt={it.namaBarang}
                                className="word-photo-thumb"
                                onError={(e) => {
                                  // Fallback jika Google Drive iframe/direct link
                                  (e.target as HTMLElement).style.display = 'none';
                                }}
                              />
                              <span className="photo-icon-fallback">📸</span>
                            </button>
                          ) : (
                            <span className="word-no-photo" title="Foto belum diunggah">
                              —
                            </span>
                          )}
                        </td>
                        <td>
                          <span className="word-code-badge">{it.kodeBarang}</span>
                        </td>
                        <td>
                          <div className="word-item-name">{it.namaBarang}</div>
                          {it.foto && (
                            <a
                              href={it.foto}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="word-drive-link"
                            >
                              🔗 Buka Foto Drive
                            </a>
                          )}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <span
                            className="word-unit-badge"
                            style={{
                              backgroundColor: unitConf?.badgeBg || '#e2e8f0',
                              color: unitConf?.badgeText || '#185abd',
                            }}
                          >
                            {it.unit}
                          </span>
                        </td>
                        <td style={{ textAlign: 'center', fontWeight: 600 }}>{it.jumlah}</td>
                        <td style={{ textAlign: 'center', color: '#475569' }}>{it.tahun}</td>
                        <td style={{ color: '#334155' }}>{it.sumber}</td>
                        <td style={{ textAlign: 'center' }}>
                          <span
                            className={`word-kondisi-badge ${
                              isBaik ? 'kondisi-baik' : isRusakRingan ? 'kondisi-rusak-ringan' : isRusakBerat ? 'kondisi-rusak-berat' : 'kondisi-lainnya'
                            }`}
                          >
                            {it.kondisi}
                          </span>
                        </td>
                        <td style={{ color: '#64748b', fontSize: '0.85rem' }}>{it.keterangan || '-'}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Table Footer info */}
          <div className="word-table-footer">
            <div>
              Total: <strong>{filteredItems.length}</strong> data inventaris tercatat di Google Sheets (Tab <code>Inventaris</code>).
            </div>
            <div>
              Kwarcab 11.01 Cilacap • Sistem Informasi Logistik
            </div>
          </div>
        </section>
      </main>

      {/* Modal Preview Foto */}
      {previewPhoto && (
        <div className="word-modal-backdrop" onClick={() => setPreviewPhoto(null)}>
          <div className="word-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="word-modal-header">
              <div>
                <span className="word-code-badge">{previewPhoto.code}</span>
                <h3 className="word-modal-title">{previewPhoto.title}</h3>
              </div>
              <button onClick={() => setPreviewPhoto(null)} className="word-modal-close-btn">
                ✕
              </button>
            </div>
            <div className="word-modal-body">
              <img src={previewPhoto.url} alt={previewPhoto.title} className="word-modal-img" />
            </div>
            <div className="word-modal-footer">
              <a
                href={previewPhoto.url}
                target="_blank"
                rel="noopener noreferrer"
                className="word-btn word-btn-primary"
              >
                🔗 Buka Asli di Google Drive
              </a>
              <button onClick={() => setPreviewPhoto(null)} className="word-btn word-btn-secondary">
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Tambah Barang Baru */}
      {showAddModal && (
        <div className="word-modal-backdrop" onClick={() => !isSubmitting && setShowAddModal(false)}>
          <div className="word-modal-card form-card" onClick={(e) => e.stopPropagation()}>
            <div className="word-modal-header">
              <div>
                <div className="word-doc-tag" style={{ marginBottom: 4 }}>FORMULIR INVENTARIS</div>
                <h3 className="word-modal-title">Tambah Barang Inventaris Baru</h3>
              </div>
              <button
                disabled={isSubmitting}
                onClick={() => setShowAddModal(false)}
                className="word-modal-close-btn"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddItem}>
              <div className="word-modal-body">
                {addSuccessMsg && (
                  <div className="word-success-alert">
                    ✅ {addSuccessMsg}
                  </div>
                )}

                <div className="word-form-grid">
                  {/* Pilihan Unit */}
                  <div className="word-form-group">
                    <label>
                      Unit Pemilik <span className="req">*</span>
                    </label>
                    <select
                      value={formUnit}
                      onChange={(e) => setFormUnit(e.target.value)}
                      className="word-form-control"
                      required
                    >
                      {DAFTAR_UNIT.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name} — {u.fullName} (Kode awal: {u.prefix}0001)
                        </option>
                      ))}
                    </select>
                    <small className="form-hint">Kode barang akan di-generate otomatis sesuai urutan unit.</small>
                  </div>

                  {/* Kondisi Barang */}
                  <div className="word-form-group">
                    <label>
                      Kondisi Barang <span className="req">*</span>
                    </label>
                    <select
                      value={formKondisi}
                      onChange={(e) => setFormKondisi(e.target.value)}
                      className="word-form-control"
                      required
                    >
                      <option value="Baik">🟢 Baik</option>
                      <option value="Rusak Ringan">🟡 Rusak Ringan</option>
                      <option value="Rusak Berat">🔴 Rusak Berat</option>
                      <option value="Hilang">⚪ Hilang</option>
                    </select>
                  </div>

                  {/* Nama Barang */}
                  <div className="word-form-group full-col">
                    <label>
                      Nama Barang <span className="req">*</span>
                    </label>
                    <input
                      type="text"
                      value={formNama}
                      onChange={(e) => setFormNama(e.target.value)}
                      placeholder="Contoh: Handy Talky Baofeng BF-888S / Tenda Regu 6 Orang"
                      className="word-form-control"
                      required
                    />
                  </div>

                  {/* Jumlah Barang */}
                  <div className="word-form-group">
                    <label>Jumlah Barang</label>
                    <input
                      type="text"
                      value={formJumlah}
                      onChange={(e) => setFormJumlah(e.target.value)}
                      placeholder="Contoh: 1 Unit / 5 Buah / 2 Set"
                      className="word-form-control"
                    />
                  </div>

                  {/* Tahun Perolehan */}
                  <div className="word-form-group">
                    <label>Tahun Perolehan</label>
                    <input
                      type="number"
                      value={formTahun}
                      onChange={(e) => setFormTahun(e.target.value)}
                      placeholder="2024"
                      className="word-form-control"
                    />
                  </div>

                  {/* Sumber Barang */}
                  <div className="word-form-group">
                    <label>Sumber Barang</label>
                    <input
                      type="text"
                      value={formSumber}
                      onChange={(e) => setFormSumber(e.target.value)}
                      placeholder="Contoh: Pembelian Kas / Hibah Kwarcab / Bantuan Kwarda"
                      className="word-form-control"
                    />
                  </div>

                  {/* Link Foto Google Drive */}
                  <div className="word-form-group">
                    <label>Link Foto Google Drive (Opsional)</label>
                    <input
                      type="url"
                      value={formFoto}
                      onChange={(e) => setFormFoto(e.target.value)}
                      placeholder="https://drive.google.com/..."
                      className="word-form-control"
                    />
                  </div>

                  {/* Keterangan / Lokasi Simpan */}
                  <div className="word-form-group full-col">
                    <label>Keterangan / Lokasi Penyimpanan</label>
                    <input
                      type="text"
                      value={formKet}
                      onChange={(e) => setFormKet(e.target.value)}
                      placeholder="Contoh: Disimpan di lemari logistik DKC / Ruang Radio"
                      className="word-form-control"
                    />
                  </div>
                </div>
              </div>

              <div className="word-modal-footer">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => setShowAddModal(false)}
                  className="word-btn word-btn-secondary"
                >
                  Batal
                </button>
                <button type="submit" disabled={isSubmitting} className="word-btn word-btn-primary">
                  {isSubmitting ? '⏳ Menyimpan...' : 'Simpan Barang'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Embedded Styles for Microsoft Word Clean Palette */}
      <style jsx>{`
        .word-theme-wrapper {
          min-height: 100vh;
          background-color: #f8fafc;
          color: #1e293b;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        }

        /* Ribbon Navbar */
        .word-ribbon {
          background-color: #185abd; /* Microsoft Word Classic Blue */
          color: #ffffff;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
          position: sticky;
          top: 0;
          z-index: 50;
        }
        .word-ribbon-container {
          max-width: 1300px;
          margin: 0 auto;
          padding: 0.75rem 1.5rem;
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 1rem;
        }
        .word-brand-area {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }
        .word-app-icon {
          width: 38px;
          height: 38px;
          background-color: #ffffff;
          color: #185abd;
          font-weight: 900;
          font-size: 1.4rem;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 6px;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        }
        .word-app-title {
          font-size: 1.05rem;
          font-weight: 800;
          letter-spacing: 0.5px;
        }
        .word-app-subtitle {
          font-size: 0.75rem;
          opacity: 0.9;
        }
        .word-nav-tabs {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .word-nav-link {
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
          padding: 0.5rem 0.85rem;
          border-radius: 6px;
          color: #ffffff;
          text-decoration: none;
          font-size: 0.85rem;
          font-weight: 600;
          transition: background-color 0.15s ease;
        }
        .word-nav-link:hover {
          background-color: rgba(255, 255, 255, 0.15);
        }
        .word-nav-link.active {
          background-color: #ffffff;
          color: #185abd;
        }
        .word-nav-bot {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          background-color: rgba(255, 255, 255, 0.2);
          color: #ffffff;
          padding: 0.45rem 0.75rem;
          border-radius: 6px;
          text-decoration: none;
          font-size: 0.8rem;
          font-weight: 600;
          border: 1px solid rgba(255, 255, 255, 0.3);
        }
        .word-nav-bot:hover {
          background-color: rgba(255, 255, 255, 0.3);
        }

        /* Container */
        .word-document-container {
          max-width: 1300px;
          margin: 1.5rem auto;
          padding: 0 1.25rem 3rem 1.25rem;
        }

        /* Document Header */
        .word-doc-header {
          background-color: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          padding: 1.5rem;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
          margin-bottom: 1.25rem;
        }
        .word-doc-title-row {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          flex-wrap: wrap;
          gap: 1rem;
          border-bottom: 1px solid #e2e8f0;
          padding-bottom: 1.25rem;
          margin-bottom: 1.25rem;
        }
        .word-doc-tag {
          display: inline-block;
          font-size: 0.7rem;
          font-weight: 700;
          color: #185abd;
          background-color: #e0edff;
          padding: 0.2rem 0.5rem;
          border-radius: 4px;
          letter-spacing: 0.5px;
          margin-bottom: 0.4rem;
        }
        .word-doc-h1 {
          font-size: 1.5rem;
          font-weight: 800;
          color: #0f172a;
          margin-bottom: 0.3rem;
        }
        .word-doc-desc {
          color: #64748b;
          font-size: 0.9rem;
          max-width: 650px;
          line-height: 1.4;
        }
        .word-header-actions {
          display: flex;
          gap: 0.5rem;
          align-items: center;
        }

        /* Stat Ribbon */
        .word-stats-ribbon {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
          gap: 0.75rem;
        }
        .word-stat-card {
          background-color: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 6px;
          padding: 0.75rem 0.85rem;
        }
        .word-stat-label {
          font-size: 0.75rem;
          color: #64748b;
          font-weight: 600;
          margin-bottom: 0.25rem;
        }
        .word-stat-val {
          font-size: 1.25rem;
          font-weight: 800;
          color: #1e293b;
        }
        .word-stat-val.text-blue {
          color: #185abd;
        }
        .word-stat-sub {
          font-size: 0.7rem;
          color: #94a3b8;
          margin-top: 0.15rem;
        }
        .condition-stat {
          grid-column: span 1;
        }
        .word-stat-condition-row {
          display: flex;
          flex-direction: column;
          gap: 0.3rem;
          margin-top: 0.3rem;
        }
        .cond-badge {
          font-size: 0.75rem;
          font-weight: 700;
          padding: 0.15rem 0.4rem;
          border-radius: 4px;
          display: inline-block;
        }
        .cond-badge.baik {
          background-color: #dcfce7;
          color: #15803d;
        }
        .cond-badge.rusak {
          background-color: #fee2e2;
          color: #b91c1c;
        }

        /* Toolbar Box */
        .word-toolbar-box {
          background-color: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          padding: 1rem;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
          margin-bottom: 1.25rem;
        }
        .word-unit-tabs {
          display: flex;
          gap: 0.4rem;
          overflow-x: auto;
          padding-bottom: 0.75rem;
          border-bottom: 1px solid #f1f5f9;
          margin-bottom: 0.85rem;
        }
        .word-tab-btn {
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
          padding: 0.45rem 0.85rem;
          border: 1px solid #cbd5e1;
          background-color: #f8fafc;
          border-radius: 6px;
          font-size: 0.85rem;
          font-weight: 600;
          color: #334155;
          cursor: pointer;
          white-space: nowrap;
          transition: all 0.15s ease;
        }
        .word-tab-btn:hover {
          background-color: #e2e8f0;
        }
        .word-tab-btn.active {
          background-color: #185abd;
          border-color: #185abd;
          color: #ffffff;
        }
        .unit-prefix-pill {
          background-color: rgba(0, 0, 0, 0.1);
          padding: 0.1rem 0.35rem;
          border-radius: 4px;
          font-size: 0.7rem;
        }
        .tab-count {
          font-size: 0.75rem;
          opacity: 0.85;
          margin-left: 0.2rem;
        }

        /* Filter Controls */
        .word-filter-controls {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          flex-wrap: wrap;
        }
        .word-search-wrapper {
          flex: 1;
          min-width: 250px;
          position: relative;
          display: flex;
          align-items: center;
        }
        .search-icon {
          position: absolute;
          left: 0.75rem;
          color: #94a3b8;
          font-size: 0.9rem;
        }
        .word-search-input {
          width: 100%;
          padding: 0.5rem 2rem 0.5rem 2.2rem;
          border: 1px solid #cbd5e1;
          border-radius: 6px;
          font-size: 0.85rem;
          outline: none;
          color: #1e293b;
        }
        .word-search-input:focus {
          border-color: #185abd;
          box-shadow: 0 0 0 2px rgba(24, 90, 189, 0.15);
        }
        .search-clear-btn {
          position: absolute;
          right: 0.6rem;
          background: none;
          border: none;
          color: #94a3b8;
          cursor: pointer;
          font-size: 0.85rem;
        }
        .word-select-group {
          display: flex;
          align-items: center;
          gap: 0.35rem;
        }
        .word-select-group label {
          font-size: 0.8rem;
          color: #64748b;
          font-weight: 600;
        }
        .word-select {
          padding: 0.45rem 0.65rem;
          border: 1px solid #cbd5e1;
          border-radius: 6px;
          font-size: 0.85rem;
          outline: none;
          background-color: #ffffff;
          color: #1e293b;
        }
        .word-export-group {
          display: flex;
          gap: 0.4rem;
        }
        .word-active-filter-bar {
          margin-top: 0.75rem;
          padding: 0.5rem 0.75rem;
          background-color: #f1f5f9;
          border-radius: 6px;
          font-size: 0.8rem;
          color: #475569;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .word-reset-btn {
          background: none;
          border: none;
          color: #be123c;
          font-weight: 700;
          cursor: pointer;
          font-size: 0.8rem;
        }

        /* Buttons */
        .word-btn {
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
          padding: 0.5rem 0.9rem;
          border-radius: 6px;
          font-size: 0.85rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
          border: 1px solid transparent;
        }
        .word-btn-primary {
          background-color: #185abd;
          color: #ffffff;
          border-color: #185abd;
        }
        .word-btn-primary:hover {
          background-color: #124694;
        }
        .word-btn-secondary {
          background-color: #f1f5f9;
          color: #334155;
          border-color: #cbd5e1;
        }
        .word-btn-secondary:hover {
          background-color: #e2e8f0;
        }
        .word-btn-outline {
          background-color: #ffffff;
          color: #334155;
          border-color: #cbd5e1;
        }
        .word-btn-outline:hover {
          background-color: #f8fafc;
          border-color: #94a3b8;
        }

        /* Table Card */
        .word-table-card {
          background-color: #ffffff;
          border: 1px solid #cbd5e1;
          border-radius: 8px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
          overflow: hidden;
        }
        .word-table-wrapper {
          overflow-x: auto;
        }
        .word-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.875rem;
          text-align: left;
        }
        .word-table thead {
          background-color: #2b579a; /* Deep Word Table Blue */
          color: #ffffff;
        }
        .word-table th {
          padding: 0.75rem 0.85rem;
          font-weight: 700;
          font-size: 0.8rem;
          letter-spacing: 0.3px;
          border-right: 1px solid rgba(255, 255, 255, 0.15);
          white-space: nowrap;
        }
        .word-table th:last-child {
          border-right: none;
        }
        .word-table td {
          padding: 0.75rem 0.85rem;
          border-bottom: 1px solid #e2e8f0;
          border-right: 1px solid #f1f5f9;
          vertical-align: middle;
        }
        .word-table td:last-child {
          border-right: none;
        }
        .word-tr-item:nth-child(even) {
          background-color: #fbfcfe;
        }
        .word-tr-item:hover {
          background-color: #f0f7ff;
        }

        /* Table Elements */
        .word-code-badge {
          font-family: 'Courier New', Courier, monospace;
          font-weight: 800;
          font-size: 0.85rem;
          color: #185abd;
          background-color: #e0edff;
          padding: 0.2rem 0.45rem;
          border-radius: 4px;
          border: 1px solid #bcd8fd;
          display: inline-block;
          letter-spacing: 0.5px;
        }
        .word-item-name {
          font-weight: 700;
          color: #0f172a;
          margin-bottom: 0.15rem;
        }
        .word-drive-link {
          font-size: 0.75rem;
          color: #185abd;
          text-decoration: underline;
        }
        .word-unit-badge {
          display: inline-block;
          padding: 0.2rem 0.55rem;
          border-radius: 4px;
          font-size: 0.75rem;
          font-weight: 700;
        }
        .word-kondisi-badge {
          display: inline-block;
          padding: 0.2rem 0.55rem;
          border-radius: 4px;
          font-size: 0.75rem;
          font-weight: 700;
        }
        .kondisi-baik {
          background-color: #dcfce7;
          color: #15803d;
          border: 1px solid #bbf7d0;
        }
        .kondisi-rusak-ringan {
          background-color: #fef3c7;
          color: #b45309;
          border: 1px solid #fde68a;
        }
        .kondisi-rusak-berat {
          background-color: #fee2e2;
          color: #b91c1c;
          border: 1px solid #fecaca;
        }
        .kondisi-lainnya {
          background-color: #f1f5f9;
          color: #475569;
          border: 1px solid #e2e8f0;
        }

        /* Thumbnail */
        .word-photo-thumb-btn {
          background: none;
          border: 1px solid #cbd5e1;
          border-radius: 6px;
          padding: 2px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          position: relative;
          overflow: hidden;
          width: 44px;
          height: 44px;
        }
        .word-photo-thumb {
          width: 100%;
          height: 100%;
          object-fit: cover;
          border-radius: 4px;
        }
        .photo-icon-fallback {
          font-size: 1.1rem;
        }
        .word-no-photo {
          color: #cbd5e1;
          font-weight: 700;
        }

        /* Empty / Loading State */
        .word-empty-cell {
          text-align: center;
          padding: 3rem 1rem !important;
        }
        .word-empty-box {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.5rem;
          color: #64748b;
        }
        .word-empty-box h3 {
          font-size: 1.15rem;
          color: #1e293b;
        }
        .word-empty-box p {
          max-width: 450px;
          font-size: 0.85rem;
        }
        .word-loading-spinner {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.75rem;
          color: #185abd;
          font-weight: 600;
        }
        .spinner {
          width: 20px;
          height: 20px;
          border: 3px solid #e0edff;
          border-top-color: #185abd;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }
        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }

        /* Footer */
        .word-table-footer {
          padding: 0.85rem 1.25rem;
          background-color: #f8fafc;
          border-top: 1px solid #e2e8f0;
          font-size: 0.8rem;
          color: #64748b;
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 0.5rem;
        }

        /* Modal Styles */
        .word-modal-backdrop {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: rgba(15, 23, 42, 0.6);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 100;
          padding: 1rem;
        }
        .word-modal-card {
          background-color: #ffffff;
          border-radius: 8px;
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.2);
          width: 100%;
          max-width: 580px;
          overflow: hidden;
          animation: scaleUp 0.15s ease-out;
        }
        .word-modal-card.form-card {
          max-width: 650px;
        }
        @keyframes scaleUp {
          from {
            opacity: 0;
            transform: scale(0.95);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
        .word-modal-header {
          padding: 1rem 1.25rem;
          background-color: #f8fafc;
          border-bottom: 1px solid #e2e8f0;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .word-modal-title {
          font-size: 1.1rem;
          font-weight: 700;
          color: #0f172a;
          margin-top: 0.2rem;
        }
        .word-modal-close-btn {
          background: none;
          border: none;
          font-size: 1.25rem;
          color: #64748b;
          cursor: pointer;
        }
        .word-modal-body {
          padding: 1.25rem;
          max-height: 75vh;
          overflow-y: auto;
        }
        .word-modal-img {
          width: 100%;
          max-height: 450px;
          object-fit: contain;
          border-radius: 6px;
          background-color: #000000;
        }
        .word-modal-footer {
          padding: 0.85rem 1.25rem;
          background-color: #f8fafc;
          border-top: 1px solid #e2e8f0;
          display: flex;
          justify-content: flex-end;
          gap: 0.5rem;
        }

        /* Form Controls */
        .word-form-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1rem;
        }
        .word-form-group.full-col {
          grid-column: span 2;
        }
        .word-form-group label {
          display: block;
          font-size: 0.8rem;
          font-weight: 700;
          color: #334155;
          margin-bottom: 0.35rem;
        }
        .req {
          color: #be123c;
        }
        .word-form-control {
          width: 100%;
          padding: 0.55rem 0.75rem;
          border: 1px solid #cbd5e1;
          border-radius: 6px;
          font-size: 0.875rem;
          outline: none;
          color: #0f172a;
        }
        .word-form-control:focus {
          border-color: #185abd;
          box-shadow: 0 0 0 2px rgba(24, 90, 189, 0.15);
        }
        .form-hint {
          display: block;
          font-size: 0.75rem;
          color: #64748b;
          margin-top: 0.25rem;
        }
        .word-success-alert {
          background-color: #dcfce7;
          border: 1px solid #86efac;
          color: #15803d;
          padding: 0.75rem;
          border-radius: 6px;
          margin-bottom: 1rem;
          font-weight: 600;
          font-size: 0.85rem;
        }

        /* Error Box */
        .word-error-box {
          background-color: #fee2e2;
          border: 1px solid #fecaca;
          color: #b91c1c;
          padding: 0.85rem 1rem;
          border-radius: 6px;
          margin-bottom: 1.25rem;
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 0.875rem;
          font-weight: 600;
        }
        .word-retry-btn {
          background: none;
          border: none;
          color: #b91c1c;
          text-decoration: underline;
          cursor: pointer;
          font-weight: 700;
        }

        /* Print Media Query */
        @media print {
          .word-ribbon,
          .word-toolbar-box,
          .word-header-actions,
          .word-drive-link,
          .word-nav-tabs {
            display: none !important;
          }
          .word-document-container {
            max-width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          .word-doc-header {
            border: none !important;
            box-shadow: none !important;
            padding: 0 0 1rem 0 !important;
          }
          .word-table-card {
            border: 1px solid #000 !important;
            box-shadow: none !important;
          }
          .word-table th {
            background-color: #185abd !important;
            color: #fff !important;
            -webkit-print-color-adjust: exact;
          }
        }

        @media (max-width: 768px) {
          .word-form-grid {
            grid-template-columns: 1fr;
          }
          .word-form-group.full-col {
            grid-column: span 1;
          }
          .word-doc-title-row {
            flex-direction: column;
          }
          .word-header-actions {
            width: 100%;
            justify-content: flex-start;
          }
        }
      `}</style>
    </div>
  );
}
