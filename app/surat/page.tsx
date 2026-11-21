'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';

export interface SuratItem {
  rowNumber?: number;
  kodeArsip: string;
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
  berkas: string;
  displayBerkas?: string;
  waktuInput: string;
  pic: string;
}

export interface SuratStats {
  totalSurat: number;
  totalMasuk: number;
  totalKeluar: number;
  totalPenting: number;
  bulanIniMasuk: number;
  bulanIniKeluar: number;
}

const DAFTAR_KATEGORI = [
  'Undangan',
  'Permohonan',
  'Pemberitahuan',
  'Mandat / Tugas',
  'Keputusan',
  'Rekomendasi',
  'Edaran',
  'Lain-lain',
];

const DAFTAR_SIFAT = ['Biasa', 'Penting', 'Segera', 'Sangat Segera', 'Rahasia'];

export default function SuratPage() {
  const [items, setItems] = useState<SuratItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter State
  const [selectedJenis, setSelectedJenis] = useState<string>('Semua');
  const [selectedKategori, setSelectedKategori] = useState<string>('Semua');
  const [selectedSifat, setSelectedSifat] = useState<string>('Semua');
  const [selectedTahun, setSelectedTahun] = useState<string>('Semua');
  const [searchQuery, setSearchQuery] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [mobileView, setMobileView] = useState<'card' | 'table'>('card');

  // Modal State
  const [previewFile, setPreviewFile] = useState<{ url: string; title: string; code: string } | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [addSuccessMsg, setAddSuccessMsg] = useState<string | null>(null);

  // Form State
  const [formJenis, setFormJenis] = useState<'Surat Masuk' | 'Surat Keluar'>('Surat Masuk');
  const [formNomor, setFormNomor] = useState('');
  const [formTglSurat, setFormTglSurat] = useState('');
  const [formTglDiterima, setFormTglDiterima] = useState('');
  const [formPengirim, setFormPengirim] = useState('');
  const [formTujuan, setFormTujuan] = useState('DKC Cilacap');
  const [formPerihal, setFormPerihal] = useState('');
  const [formKategori, setFormKategori] = useState('Undangan');
  const [formSifat, setFormSifat] = useState('Biasa');
  const [formRingkasan, setFormRingkasan] = useState('');
  const [formBerkas, setFormBerkas] = useState('');
  const [formPic, setFormPic] = useState('Staff DKC');

  // File Upload & AI OCR State
  const [uploadingFile, setUploadingFile] = useState(false);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [uploadFileName, setUploadFileName] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [aiDetectedMsg, setAiDetectedMsg] = useState<string | null>(null);
  const [showManualUrl, setShowManualUrl] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchData = async (showSpinner = false) => {
    if (showSpinner) setIsRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/surat');
      const json = await res.json();
      if (json.success && json.data) {
        setItems(json.data.items || []);
      } else {
        throw new Error(json.error || 'Gagal memuat arsip persuratan');
      }
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Terjadi gangguan saat mengambil data persuratan.');
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
      // Filter Jenis
      if (selectedJenis !== 'Semua' && it.jenis.toLowerCase() !== selectedJenis.toLowerCase()) {
        return false;
      }

      // Filter Kategori
      if (selectedKategori !== 'Semua' && it.kategori.toLowerCase() !== selectedKategori.toLowerCase()) {
        return false;
      }

      // Filter Sifat
      if (selectedSifat !== 'Semua' && it.sifat.toLowerCase() !== selectedSifat.toLowerCase()) {
        return false;
      }

      // Filter Tahun
      if (selectedTahun !== 'Semua') {
        const d = it.tanggalSurat || it.tanggalDiterima || '';
        if (!d.startsWith(selectedTahun)) return false;
      }

      // Filter Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          it.kodeArsip.toLowerCase().includes(q) ||
          it.nomorSurat.toLowerCase().includes(q) ||
          it.perihal.toLowerCase().includes(q) ||
          it.pengirim.toLowerCase().includes(q) ||
          it.tujuan.toLowerCase().includes(q) ||
          it.kategori.toLowerCase().includes(q) ||
          it.ringkasan.toLowerCase().includes(q)
        );
      }

      return true;
    });
  }, [items, selectedJenis, selectedKategori, selectedSifat, selectedTahun, searchQuery]);

  // Available Years
  const availableYears = useMemo(() => {
    const years = new Set<string>();
    items.forEach((it) => {
      const d = it.tanggalSurat || it.tanggalDiterima || '';
      const y = d.split('-')[0];
      if (y && y.length === 4) years.add(y);
    });
    return Array.from(years).sort((a, b) => b.localeCompare(a));
  }, [items]);

  // Summary Metrics
  const stats = useMemo(() => {
    let masukCount = 0;
    let keluarCount = 0;
    let pentingCount = 0;

    items.forEach((it) => {
      if (it.jenis === 'Surat Masuk') masukCount++;
      else keluarCount++;

      const s = it.sifat.toLowerCase();
      if (s.includes('penting') || s.includes('segera') || s.includes('rahasia')) {
        pentingCount++;
      }
    });

    return {
      total: items.length,
      masuk: masukCount,
      keluar: keluarCount,
      penting: pentingCount,
    };
  }, [items]);

  const resetForm = () => {
    setFormJenis('Surat Masuk');
    setFormNomor('');
    setFormTglSurat('');
    setFormTglDiterima('');
    setFormPengirim('');
    setFormTujuan('DKC Cilacap');
    setFormPerihal('');
    setFormKategori('Undangan');
    setFormSifat('Biasa');
    setFormRingkasan('');
    setFormBerkas('');
    setFormPic('Staff DKC');
    setFilePreview(null);
    setUploadFileName(null);
    setUploadError(null);
    setAiDetectedMsg(null);
    setUploadingFile(false);
    setShowManualUrl(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError(null);
    setAiDetectedMsg(null);
    setUploadFileName(file.name);
    setUploadingFile(true);

    if (file.type.startsWith('image/')) {
      setFilePreview(URL.createObjectURL(file));
    } else {
      setFilePreview(null);
    }

    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('caption', `Surat DKC Cilacap: ${formJenis}`);

      const res = await fetch('/api/surat/scan', {
        method: 'POST',
        body: fd,
      });

      const json = await res.json();
      if (json.success) {
        if (json.fileUrl) {
          setFormBerkas(json.fileUrl);
          if (json.displayUrl && file.type.startsWith('image/')) {
            setFilePreview(json.displayUrl);
          }
        }

        // Auto-fill dari hasil analisa AI Gemini
        if (json.parsed) {
          const p = json.parsed;
          if (p.jenis) setFormJenis(p.jenis);
          if (p.nomorSurat && p.nomorSurat !== '-') setFormNomor(p.nomorSurat);
          if (p.tanggalSurat) setFormTglSurat(p.tanggalSurat);
          if (p.tanggalDiterima) setFormTglDiterima(p.tanggalDiterima);
          if (p.pengirim && p.pengirim !== '-') setFormPengirim(p.pengirim);
          if (p.tujuan && p.tujuan !== '-') setFormTujuan(p.tujuan);
          if (p.perihal) setFormPerihal(p.perihal);
          if (p.kategori) setFormKategori(p.kategori);
          if (p.sifat) setFormSifat(p.sifat);
          if (p.ringkasan && p.ringkasan !== '-') setFormRingkasan(p.ringkasan);

          setAiDetectedMsg('AI berhasil membaca rincian surat & tersimpan di Google Drive!');
        } else {
          setAiDetectedMsg('Berkas berhasil disimpan ke Google Drive. Silakan lengkapi formulir.');
        }
      } else {
        throw new Error(json.error || 'Gagal memproses berkas surat.');
      }
    } catch (err: any) {
      console.error(err);
      setUploadError(err?.message || 'Gagal menganalisis dokumen dengan AI.');
    } finally {
      setUploadingFile(false);
    }
  };

  const handleRemoveFile = () => {
    setFilePreview(null);
    setUploadFileName(null);
    setFormBerkas('');
    setUploadError(null);
    setAiDetectedMsg(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleAddSurat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formPerihal.trim()) {
      alert('Perihal surat wajib diisi!');
      return;
    }

    if (uploadingFile) {
      alert('Dokumen sedang dianalisis & diunggah ke Google Drive. Mohon tunggu...');
      return;
    }

    setIsSubmitting(true);
    setAddSuccessMsg(null);

    try {
      const res = await fetch('/api/surat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jenis: formJenis,
          nomorSurat: formNomor || '-',
          tanggalSurat: formTglSurat || new Date().toISOString().slice(0, 10),
          tanggalDiterima: formTglDiterima || new Date().toISOString().slice(0, 10),
          pengirim: formPengirim || (formJenis === 'Surat Keluar' ? 'DKC Cilacap' : '-'),
          tujuan: formTujuan || (formJenis === 'Surat Masuk' ? 'DKC Cilacap' : '-'),
          perihal: formPerihal,
          kategori: formKategori,
          sifat: formSifat,
          ringkasan: formRingkasan || '-',
          berkas: formBerkas,
          pic: formPic || 'Staff DKC',
        }),
      });

      const json = await res.json();
      if (json.success && json.item) {
        setAddSuccessMsg(`Surat berhasil dicatat dengan kode arsip: ${json.item.kodeArsip}`);
        resetForm();
        await fetchData(true);
        setTimeout(() => {
          setShowAddModal(false);
          setAddSuccessMsg(null);
        }, 1800);
      } else {
        throw new Error(json.error || 'Gagal menyimpan surat');
      }
    } catch (err: any) {
      alert(`Gagal: ${err?.message || err}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const exportCsv = () => {
    if (filteredItems.length === 0) {
      alert('Tidak ada data surat yang dapat diekspor.');
      return;
    }

    const headers = [
      'No',
      'Kode Arsip',
      'Jenis',
      'Nomor Surat',
      'Tanggal Surat',
      'Tanggal Diterima',
      'Pengirim / Asal',
      'Tujuan / Penerima',
      'Perihal',
      'Kategori',
      'Sifat',
      'Ringkasan',
      'Tautan Berkas',
      'Waktu Input',
      'PIC',
    ];

    const rows = filteredItems.map((it, idx) => [
      idx + 1,
      `"${it.kodeArsip}"`,
      `"${it.jenis}"`,
      `"${it.nomorSurat.replace(/"/g, '""')}"`,
      `"${it.tanggalSurat}"`,
      `"${it.tanggalDiterima}"`,
      `"${it.pengirim.replace(/"/g, '""')}"`,
      `"${it.tujuan.replace(/"/g, '""')}"`,
      `"${it.perihal.replace(/"/g, '""')}"`,
      `"${it.kategori}"`,
      `"${it.sifat}"`,
      `"${it.ringkasan.replace(/"/g, '""')}"`,
      `"${it.berkas}"`,
      `"${it.waktuInput}"`,
      `"${it.pic}"`,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `arsip_surat_dkc_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="word-theme-wrapper">
      {/* Top Ribbon Bar (Microsoft Word Style) */}
      <header className="word-ribbon">
        <div className="word-ribbon-container">
          <div className="word-brand-group">
            <div className="word-app-icon">
              <span className="word-app-letter">DKC</span>
            </div>
            <div className="word-title-group">
              <span className="word-doc-tag">ARSIP PERSURATAN RESMI</span>
              <h1 className="word-doc-title">Buku Agenda Surat Masuk & Keluar — DKC Cilacap</h1>
              <span className="word-app-subtitle">Kwartir Cabang Gerakan Pramuka Cilacap</span>
            </div>
          </div>

          <nav className="word-nav-tabs">
            <Link href="/" className="word-nav-link">
              <span className="nav-text">Buku Kas</span>
            </Link>
            <Link href="/inventaris" className="word-nav-link">
              <span className="nav-text">Inventaris</span>
            </Link>
            <Link href="/surat" className="word-nav-link active">
              <span className="nav-text">Persuratan</span>
            </Link>
            <a
              href="https://t.me/duit_pwd_bot"
              target="_blank"
              rel="noopener noreferrer"
              className="word-nav-bot"
              title="Buka Bot Telegram"
            >
              <span className="nav-text">Bot Telegram</span>
            </a>
          </nav>
        </div>
      </header>

      {/* Main Container */}
      <main className="word-document-container">
        {/* Document Header Section */}
        <section className="word-doc-header">
          <div className="word-header-meta">
            <div>
              <div className="word-paper-meta-label">LEMBAR AGENDA PERSURATAN RESMI</div>
              <h2 className="word-section-title">Daftar Arsip Surat Masuk & Surat Keluar</h2>
              <p className="word-section-desc">
                Pendataan arsip persuratan digital Dewan Kerja Pramuka Penegak dan Pandega Kwartir Cabang Cilacap.
              </p>
            </div>

            <div className="word-header-actions">
              <button
                onClick={() => fetchData(true)}
                disabled={isRefreshing}
                className="word-btn word-btn-secondary"
                title="Segarkan data terbaru"
              >
                <span>{isRefreshing ? 'Menyinkronkan...' : 'Segarkan Data'}</span>
              </button>
              <button onClick={() => setShowAddModal(true)} className="word-btn word-btn-primary">
                <span>Catat / Unggah Surat</span>
              </button>
            </div>
          </div>

          {/* Metric Stat Ribbon Cards */}
          <div className="word-stats-ribbon">
            <div className="word-stat-card">
              <div className="word-stat-label">Total Arsip Surat</div>
              <div className="word-stat-val text-blue">{loading ? '...' : stats.total} Berkas</div>
              <div className="word-stat-sub">Persuratan DKC Cilacap</div>
            </div>

            <div className="word-stat-card">
              <div className="word-stat-label">Surat Masuk</div>
              <div className="word-stat-val text-indigo">{loading ? '...' : stats.masuk} Surat</div>
              <div className="word-stat-sub">Kode: SM-0001+</div>
            </div>

            <div className="word-stat-card">
              <div className="word-stat-label">Surat Keluar</div>
              <div className="word-stat-val text-emerald">{loading ? '...' : stats.keluar} Surat</div>
              <div className="word-stat-sub">Kode: SK-0001+</div>
            </div>

            <div className="word-stat-card">
              <div className="word-stat-label">Sifat Penting / Segera</div>
              <div className="word-stat-val text-amber">{loading ? '...' : stats.penting} Surat</div>
              <div className="word-stat-sub">Perlu tindak lanjut / atensi</div>
            </div>
          </div>
        </section>

        {/* Toolbar & Filters (Word Table Tools Style) */}
        <section className="word-toolbar-box">
          {/* Segment Jenis Tabs */}
          <div className="word-unit-tabs">
            <button
              onClick={() => setSelectedJenis('Semua')}
              className={`word-tab-btn ${selectedJenis === 'Semua' ? 'active' : ''}`}
            >
              <span>Semua Surat</span>
              <span className="tab-count">{items.length}</span>
            </button>
            <button
              onClick={() => setSelectedJenis('Surat Masuk')}
              className={`word-tab-btn ${selectedJenis === 'Surat Masuk' ? 'active' : ''}`}
            >
              <span className="unit-prefix-pill">SM</span>
              <span>Surat Masuk</span>
              <span className="tab-count">{stats.masuk}</span>
            </button>
            <button
              onClick={() => setSelectedJenis('Surat Keluar')}
              className={`word-tab-btn ${selectedJenis === 'Surat Keluar' ? 'active' : ''}`}
            >
              <span className="unit-prefix-pill">SK</span>
              <span>Surat Keluar</span>
              <span className="tab-count">{stats.keluar}</span>
            </button>
          </div>

          {/* Filter Controls Row */}
          <div className="word-filter-controls">
            <div className="word-search-wrapper">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari nomor surat, perihal, pengirim, atau tujuan..."
                className="word-search-input"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="word-search-clear">
                  &times;
                </button>
              )}
            </div>

            <div className="word-select-group">
              {/* Filter Sifat */}
              <select
                value={selectedSifat}
                onChange={(e) => setSelectedSifat(e.target.value)}
                className="word-select-filter"
              >
                <option value="Semua">Semua Sifat</option>
                {DAFTAR_SIFAT.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>

              {/* Filter Kategori */}
              <select
                value={selectedKategori}
                onChange={(e) => setSelectedKategori(e.target.value)}
                className="word-select-filter"
              >
                <option value="Semua">Semua Kategori</option>
                {DAFTAR_KATEGORI.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>

              {/* Filter Tahun */}
              {availableYears.length > 0 && (
                <select
                  value={selectedTahun}
                  onChange={(e) => setSelectedTahun(e.target.value)}
                  className="word-select-filter"
                >
                  <option value="Semua">Semua Tahun</option>
                  {availableYears.map((y) => (
                    <option key={y} value={y}>
                      Tahun {y}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="word-export-group">
              <button onClick={exportCsv} className="word-btn word-btn-secondary" title="Unduh CSV">
                <span>Unduh CSV</span>
              </button>
            </div>
          </div>
        </section>

        {/* View Toggle Bar (Mobile Only) */}
        <div className="word-view-toggle-bar">
          <div className="view-toggle-label">
            <span>Daftar Arsip Surat</span>
            <span className="item-count-badge">{filteredItems.length} arsip</span>
          </div>
          <div className="view-toggle-buttons">
            <button
              onClick={() => setMobileView('card')}
              className={`toggle-btn ${mobileView === 'card' ? 'active' : ''}`}
            >
              <span>Kartu</span>
            </button>
            <button
              onClick={() => setMobileView('table')}
              className={`toggle-btn ${mobileView === 'table' ? 'active' : ''}`}
            >
              <span>Tabel</span>
            </button>
          </div>
        </div>

        {/* Error Notification */}
        {error && (
          <div className="word-error-box">
            <span>{error}</span>
            <button onClick={() => fetchData(true)} className="word-retry-btn">
              Coba Lagi
            </button>
          </div>
        )}

        {/* Table Content Card */}
        <section className={`word-table-card ${mobileView === 'card' ? 'mobile-card-mode' : 'mobile-table-mode'}`}>
          <div className="word-table-scroll-hint">
            <span>Geser ke kanan untuk melihat rincian arsip lainnya</span>
          </div>

          <div className="word-table-responsive-wrapper">
            <table className="word-table">
              <thead>
                <tr>
                  <th style={{ width: '45px', textAlign: 'center' }}>No</th>
                  <th style={{ width: '70px', textAlign: 'center' }}>Berkas</th>
                  <th style={{ width: '110px' }}>Kode Arsip</th>
                  <th style={{ width: '120px' }}>Jenis</th>
                  <th style={{ minWidth: '160px' }}>Nomor Surat</th>
                  <th style={{ minWidth: '110px' }}>Tanggal</th>
                  <th style={{ minWidth: '220px' }}>Perihal & Ringkasan</th>
                  <th style={{ minWidth: '160px' }}>Pengirim / Asal</th>
                  <th style={{ minWidth: '160px' }}>Tujuan / Penerima</th>
                  <th style={{ minWidth: '110px' }}>Sifat & Kategori</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={10} className="text-center py-8 text-slate-500 font-medium">
                      Memuat arsip persuratan DKC...
                    </td>
                  </tr>
                ) : filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="text-center py-8 text-slate-500">
                      Belum ada arsip surat yang sesuai dengan filter pencarian.
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((item, idx) => {
                    const isMasuk = item.jenis === 'Surat Masuk';
                    return (
                      <tr key={item.kodeArsip + idx} className="word-table-row">
                        <td style={{ textAlign: 'center', color: '#64748b', fontSize: '0.85rem' }}>
                          {idx + 1}
                        </td>

                        {/* Berkas Drive */}
                        <td style={{ textAlign: 'center' }}>
                          {item.berkas ? (
                            <a
                              href={item.berkas}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="word-drive-link"
                              title="Buka Berkas Asli di Google Drive"
                            >
                              Buka
                            </a>
                          ) : (
                            <span className="text-slate-400 text-xs">-</span>
                          )}
                        </td>

                        {/* Kode Arsip */}
                        <td>
                          <span className="word-code-pill font-mono">{item.kodeArsip}</span>
                        </td>

                        {/* Jenis Surat */}
                        <td>
                          <span className={`jenis-badge ${isMasuk ? 'masuk' : 'keluar'}`}>
                            {item.jenis}
                          </span>
                        </td>

                        {/* Nomor Surat */}
                        <td>
                          <div className="font-semibold text-slate-800 text-xs font-mono">
                            {item.nomorSurat}
                          </div>
                        </td>

                        {/* Tanggal */}
                        <td>
                          <div className="text-xs text-slate-700 font-medium">
                            {item.tanggalSurat || '-'}
                          </div>
                          {item.tanggalDiterima && item.tanggalDiterima !== item.tanggalSurat && (
                            <div className="text-[11px] text-slate-500">
                              Arsip: {item.tanggalDiterima}
                            </div>
                          )}
                        </td>

                        {/* Perihal & Ringkasan */}
                        <td>
                          <div className="font-bold text-slate-900 text-sm">{item.perihal}</div>
                          {item.ringkasan && item.ringkasan !== '-' && (
                            <div className="text-xs text-slate-500 mt-1 italic leading-relaxed">
                              {item.ringkasan}
                            </div>
                          )}
                        </td>

                        {/* Pengirim */}
                        <td>
                          <div className="text-xs text-slate-800 font-medium">{item.pengirim}</div>
                        </td>

                        {/* Tujuan */}
                        <td>
                          <div className="text-xs text-slate-800 font-medium">{item.tujuan}</div>
                        </td>

                        {/* Sifat & Kategori */}
                        <td>
                          <div className="flex flex-col gap-1 items-start">
                            <span className={`sifat-badge ${item.sifat.toLowerCase().replace(/\s+/g, '-')}`}>
                              {item.sifat}
                            </span>
                            <span className="kategori-badge">{item.kategori}</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile Card List View */}
          <div className="word-mobile-card-list">
            {loading ? (
              <div className="py-8 text-center text-slate-500">Memuat arsip persuratan...</div>
            ) : filteredItems.length === 0 ? (
              <div className="py-8 text-center text-slate-500">Belum ada arsip surat.</div>
            ) : (
              filteredItems.map((item, idx) => {
                const isMasuk = item.jenis === 'Surat Masuk';
                return (
                  <article key={item.kodeArsip + idx} className="word-item-card">
                    <header className="card-top-row">
                      <div className="card-badge-row">
                        <span className="card-code-badge font-mono">{item.kodeArsip}</span>
                        <span className={`jenis-badge ${isMasuk ? 'masuk' : 'keluar'}`}>
                          {item.jenis}
                        </span>
                      </div>
                      <span className={`sifat-badge ${item.sifat.toLowerCase().replace(/\s+/g, '-')}`}>
                        {item.sifat}
                      </span>
                    </header>

                    <div className="card-main-body">
                      <h3 className="card-item-heading">{item.perihal}</h3>
                      <div className="card-meta-row">
                        <span className="card-meta-pill">No: {item.nomorSurat}</span>
                        <span className="card-meta-pill">Tgl: {item.tanggalSurat}</span>
                        <span className="card-meta-pill">{item.kategori}</span>
                      </div>

                      <div className="card-detail-block">
                        <div className="card-detail-line">
                          <span className="dt-label">Pengirim:</span>
                          <span className="dt-val">{item.pengirim}</span>
                        </div>
                        <div className="card-detail-line">
                          <span className="dt-label">Tujuan:</span>
                          <span className="dt-val">{item.tujuan}</span>
                        </div>
                        {item.ringkasan && item.ringkasan !== '-' && (
                          <div className="card-detail-line">
                            <span className="dt-label">Ringkasan:</span>
                            <span className="dt-val italic">{item.ringkasan}</span>
                          </div>
                        )}
                      </div>

                      {item.berkas && (
                        <div className="card-bottom-actions">
                          <a
                            href={item.berkas}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="card-drive-btn"
                          >
                            Buka Dokumen di Google Drive
                          </a>
                        </div>
                      )}
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </section>
      </main>

      {/* Modal Tambah / Unggah Surat Baru */}
      {showAddModal && (
        <div
          className="word-modal-backdrop"
          onClick={() => !isSubmitting && !uploadingFile && (resetForm(), setShowAddModal(false))}
        >
          <div className="word-modal-card form-card" onClick={(e) => e.stopPropagation()}>
            <div className="word-modal-header">
              <div>
                <div className="word-doc-tag" style={{ marginBottom: 4 }}>FORMULIR PERSURATAN</div>
                <h3 className="word-modal-title">Catat / Unggah Surat Resmi DKC</h3>
              </div>
              <button
                disabled={isSubmitting || uploadingFile}
                onClick={() => {
                  resetForm();
                  setShowAddModal(false);
                }}
                className="word-modal-close-btn"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleAddSurat}>
              <div className="word-modal-body">
                {addSuccessMsg && (
                  <div className="word-success-alert">
                    <span>{addSuccessMsg}</span>
                  </div>
                )}

                <div className="word-form-grid">
                  {/* Bagian Unggah Berkas & AI Scan */}
                  <div className="word-form-group full-col">
                    <label>Unggah Berkas Surat (Foto / PDF / Word .docx)</label>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*,.pdf,.doc,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      style={{ display: 'none' }}
                      onChange={handleFileSelect}
                    />

                    {!uploadFileName && !formBerkas ? (
                      <div
                        className="word-upload-dropzone"
                        onClick={() => !uploadingFile && fileInputRef.current?.click()}
                      >
                        <div className="upload-icon-box">
                          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                            <polyline points="14 2 14 8 20 8"></polyline>
                            <line x1="12" y1="18" x2="12" y2="12"></line>
                            <line x1="9" y1="15" x2="15" y2="15"></line>
                          </svg>
                        </div>
                        <div className="upload-text-main">Pilih Berkas atau Jepret Foto Surat</div>
                        <div className="upload-text-sub">
                          Mendukung Foto Kamera, Dokumen PDF, atau Word (.docx). AI otomatis membaca nomor surat, tanggal, pengirim, dan perihal!
                        </div>
                        <div className="upload-badge-drive">Otomatis dianalisis AI & disimpan ke Google Drive</div>
                      </div>
                    ) : (
                      <div className="word-upload-preview-box">
                        <div className="preview-thumb-wrapper">
                          {filePreview ? (
                            <img src={filePreview} alt="Preview" className="preview-img" />
                          ) : (
                            <div className="doc-icon-placeholder">DOC</div>
                          )}
                        </div>

                        <div className="preview-info-col">
                          {uploadingFile ? (
                            <div className="upload-status-uploading">
                              <span className="spinner-inline"></span>
                              <span>AI sedang membaca isi dokumen & mengunggah ke Google Drive...</span>
                            </div>
                          ) : formBerkas ? (
                            <div className="upload-status-success">
                              <span className="check-badge">Tersimpan di Google Drive</span>
                              {uploadFileName && <span className="filename-text">{uploadFileName}</span>}
                              {aiDetectedMsg && <span className="ai-detected-text">{aiDetectedMsg}</span>}
                              <a
                                href={formBerkas}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="drive-link-btn"
                              >
                                Buka Dokumen di Google Drive
                              </a>
                            </div>
                          ) : null}

                          {uploadError && (
                            <div className="upload-status-error">
                              <span>Gagal: {uploadError}</span>
                            </div>
                          )}

                          <div className="preview-action-row">
                            <button
                              type="button"
                              disabled={uploadingFile}
                              onClick={() => fileInputRef.current?.click()}
                              className="btn-change-photo"
                            >
                              Ganti Berkas
                            </button>
                            <button
                              type="button"
                              disabled={uploadingFile}
                              onClick={handleRemoveFile}
                              className="btn-remove-photo"
                            >
                              Hapus
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Jenis Surat */}
                  <div className="word-form-group">
                    <label>
                      Jenis Surat <span className="req">*</span>
                    </label>
                    <select
                      value={formJenis}
                      onChange={(e) => {
                        const j = e.target.value as 'Surat Masuk' | 'Surat Keluar';
                        setFormJenis(j);
                        if (j === 'Surat Masuk') {
                          setFormTujuan('DKC Cilacap');
                          if (formPengirim === 'DKC Cilacap') setFormPengirim('');
                        } else {
                          setFormPengirim('DKC Cilacap');
                          if (formTujuan === 'DKC Cilacap') setFormTujuan('');
                        }
                      }}
                      className="word-form-control"
                      required
                    >
                      <option value="Surat Masuk">Surat Masuk (Diterima oleh DKC)</option>
                      <option value="Surat Keluar">Surat Keluar (Diterbitkan oleh DKC)</option>
                    </select>
                  </div>

                  {/* Sifat Surat */}
                  <div className="word-form-group">
                    <label>Sifat Surat</label>
                    <select
                      value={formSifat}
                      onChange={(e) => setFormSifat(e.target.value)}
                      className="word-form-control"
                    >
                      {DAFTAR_SIFAT.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Nomor Surat */}
                  <div className="word-form-group">
                    <label>Nomor Surat Resmi</label>
                    <input
                      type="text"
                      value={formNomor}
                      onChange={(e) => setFormNomor(e.target.value)}
                      placeholder="Contoh: 045/11.01-C/2026"
                      className="word-form-control font-mono"
                    />
                  </div>

                  {/* Kategori Surat */}
                  <div className="word-form-group">
                    <label>Kategori Surat</label>
                    <select
                      value={formKategori}
                      onChange={(e) => setFormKategori(e.target.value)}
                      className="word-form-control"
                    >
                      {DAFTAR_KATEGORI.map((k) => (
                        <option key={k} value={k}>
                          {k}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Tanggal Surat */}
                  <div className="word-form-group">
                    <label>Tanggal Surat Tertulis</label>
                    <input
                      type="date"
                      value={formTglSurat}
                      onChange={(e) => setFormTglSurat(e.target.value)}
                      className="word-form-control"
                    />
                  </div>

                  {/* Tanggal Masuk/Keluar */}
                  <div className="word-form-group">
                    <label>Tanggal Diterima / Keluar</label>
                    <input
                      type="date"
                      value={formTglDiterima}
                      onChange={(e) => setFormTglDiterima(e.target.value)}
                      className="word-form-control"
                    />
                  </div>

                  {/* Pengirim / Asal Surat */}
                  <div className="word-form-group">
                    <label>
                      Pengirim / Asal Surat <span className="req">*</span>
                    </label>
                    <input
                      type="text"
                      value={formPengirim}
                      onChange={(e) => setFormPengirim(e.target.value)}
                      placeholder="Contoh: Kwarda Jawa Tengah / Kwarran Kroya"
                      className="word-form-control"
                      required
                    />
                  </div>

                  {/* Tujuan / Penerima Surat */}
                  <div className="word-form-group">
                    <label>
                      Tujuan / Penerima <span className="req">*</span>
                    </label>
                    <input
                      type="text"
                      value={formTujuan}
                      onChange={(e) => setFormTujuan(e.target.value)}
                      placeholder="Contoh: DKC Cilacap / Ketua Kwarcab"
                      className="word-form-control"
                      required
                    />
                  </div>

                  {/* Perihal Surat */}
                  <div className="word-form-group full-col">
                    <label>
                      Perihal / Hal Surat <span className="req">*</span>
                    </label>
                    <input
                      type="text"
                      value={formPerihal}
                      onChange={(e) => setFormPerihal(e.target.value)}
                      placeholder="Contoh: Undangan Rapat Kerja Cabang Tahun 2026 / Permohonan Bantuan Tenda"
                      className="word-form-control font-semibold"
                      required
                    />
                  </div>

                  {/* Ringkasan Isi Surat */}
                  <div className="word-form-group full-col">
                    <label>Ringkasan Isi / Catatan Disposisi</label>
                    <textarea
                      rows={2}
                      value={formRingkasan}
                      onChange={(e) => setFormRingkasan(e.target.value)}
                      placeholder="Tulis ringkasan singkat isi surat atau catatan disposisi pimpinan..."
                      className="word-form-control"
                    />
                  </div>

                  {/* Manual Drive Link Option */}
                  <div className="word-form-group full-col">
                    <button
                      type="button"
                      onClick={() => setShowManualUrl(!showManualUrl)}
                      className="toggle-link-btn"
                    >
                      {showManualUrl
                        ? 'Sembunyikan input link Google Drive manual'
                        : 'Atau tempel tautan Google Drive secara manual'}
                    </button>
                    {showManualUrl && (
                      <input
                        type="url"
                        value={formBerkas}
                        onChange={(e) => setFormBerkas(e.target.value)}
                        placeholder="https://drive.google.com/file/d/.../view"
                        className="word-form-control mt-2"
                      />
                    )}
                  </div>
                </div>
              </div>

              <div className="word-modal-footer">
                <button
                  type="button"
                  disabled={isSubmitting || uploadingFile}
                  onClick={() => {
                    resetForm();
                    setShowAddModal(false);
                  }}
                  className="word-btn word-btn-secondary"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || uploadingFile}
                  className="word-btn word-btn-primary"
                >
                  {isSubmitting
                    ? 'Menyimpan...'
                    : uploadingFile
                    ? 'Menganalisis Dokumen...'
                    : 'Simpan Arsip Surat'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Embedded Styles Microsoft Word Clean Blue-White Theme */}
      <style jsx>{`
        .word-theme-wrapper {
          min-height: 100vh;
          background-color: #f8fafc;
          color: #1e293b;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          -webkit-tap-highlight-color: transparent;
        }

        /* Top Ribbon */
        .word-ribbon {
          background-color: #185abd;
          color: #ffffff;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
          position: sticky;
          top: 0;
          z-index: 40;
        }
        .word-ribbon-container {
          max-width: 1200px;
          margin: 0 auto;
          padding: 0.65rem 1.25rem;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 1rem;
        }
        .word-brand-group {
          display: flex;
          align-items: center;
          gap: 0.85rem;
        }
        .word-app-icon {
          width: 36px;
          height: 36px;
          background-color: #ffffff;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 900;
          color: #185abd;
          font-size: 0.85rem;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.15);
        }
        .word-title-group {
          display: flex;
          flex-direction: column;
        }
        .word-doc-tag {
          font-size: 0.65rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          color: #bfdbfe;
        }
        .word-doc-title {
          font-size: 1.05rem;
          font-weight: 700;
          color: #ffffff;
          line-height: 1.2;
        }
        .word-app-subtitle {
          font-size: 0.72rem;
          color: #e0edff;
        }

        /* Navigation Tabs */
        .word-nav-tabs {
          display: flex;
          align-items: center;
          gap: 0.4rem;
        }
        .word-nav-link {
          padding: 0.45rem 0.75rem;
          border-radius: 4px;
          font-size: 0.8rem;
          font-weight: 600;
          color: #dbeafe;
          text-decoration: none;
          transition: all 0.15s ease;
        }
        .word-nav-link:hover {
          background-color: rgba(255, 255, 255, 0.15);
          color: #ffffff;
        }
        .word-nav-link.active {
          background-color: #ffffff;
          color: #185abd;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
        }
        .word-nav-bot {
          padding: 0.45rem 0.75rem;
          border-radius: 4px;
          font-size: 0.8rem;
          font-weight: 600;
          color: #ffffff;
          background-color: #0284c7;
          text-decoration: none;
          transition: background-color 0.15s ease;
        }
        .word-nav-bot:hover {
          background-color: #0369a1;
        }

        /* Main Document Sheet */
        .word-document-container {
          max-width: 1200px;
          margin: 1.5rem auto 3rem auto;
          padding: 0 1.25rem;
        }

        .word-doc-header {
          background-color: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 8px 8px 0 0;
          padding: 1.25rem 1.5rem 1.5rem 1.5rem;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
        }
        .word-header-meta {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 1.5rem;
          margin-bottom: 1.25rem;
        }
        .word-paper-meta-label {
          font-size: 0.7rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          color: #185abd;
          margin-bottom: 0.25rem;
        }
        .word-section-title {
          font-size: 1.35rem;
          font-weight: 800;
          color: #0f172a;
          line-height: 1.2;
        }
        .word-section-desc {
          font-size: 0.82rem;
          color: #64748b;
          margin-top: 0.35rem;
          max-width: 600px;
        }

        .word-header-actions {
          display: flex;
          gap: 0.5rem;
          flex-shrink: 0;
        }

        /* Buttons */
        .word-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 0.35rem;
          padding: 0.5rem 0.95rem;
          font-size: 0.8rem;
          font-weight: 600;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.15s ease;
          border: 1px solid transparent;
        }
        .word-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .word-btn-primary {
          background-color: #185abd;
          color: #ffffff;
        }
        .word-btn-primary:hover:not(:disabled) {
          background-color: #104590;
        }
        .word-btn-secondary {
          background-color: #ffffff;
          border-color: #cbd5e1;
          color: #334155;
        }
        .word-btn-secondary:hover:not(:disabled) {
          background-color: #f1f5f9;
        }

        /* Stats Ribbon */
        .word-stats-ribbon {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 0.85rem;
          padding-top: 1rem;
          border-top: 1px solid #f1f5f9;
        }
        .word-stat-card {
          background-color: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 6px;
          padding: 0.85rem;
        }
        .word-stat-label {
          font-size: 0.72rem;
          font-weight: 700;
          color: #475569;
          margin-bottom: 0.25rem;
        }
        .word-stat-val {
          font-size: 1.25rem;
          font-weight: 800;
          line-height: 1.2;
        }
        .word-stat-sub {
          font-size: 0.7rem;
          color: #64748b;
          margin-top: 0.15rem;
        }
        .text-blue { color: #185abd; }
        .text-indigo { color: #4f46e5; }
        .text-emerald { color: #059669; }
        .text-amber { color: #d97706; }

        /* Toolbar Box */
        .word-toolbar-box {
          background-color: #ffffff;
          border-left: 1px solid #e2e8f0;
          border-right: 1px solid #e2e8f0;
          padding: 0.85rem 1.25rem;
          border-bottom: 1px solid #e2e8f0;
        }
        .word-unit-tabs {
          display: flex;
          flex-wrap: wrap;
          gap: 0.4rem;
          margin-bottom: 0.85rem;
        }
        .word-tab-btn {
          display: inline-flex;
          align-items: center;
          gap: 0.45rem;
          padding: 0.45rem 0.8rem;
          font-size: 0.78rem;
          font-weight: 600;
          border-radius: 6px;
          background-color: #f1f5f9;
          color: #475569;
          border: 1px solid #e2e8f0;
          cursor: pointer;
        }
        .word-tab-btn:hover {
          background-color: #e2e8f0;
        }
        .word-tab-btn.active {
          background-color: #185abd;
          color: #ffffff;
          border-color: #185abd;
        }
        .unit-prefix-pill {
          background-color: rgba(255, 255, 255, 0.3);
          padding: 0.1rem 0.35rem;
          border-radius: 3px;
          font-size: 0.68rem;
          font-family: monospace;
        }
        .tab-count {
          background-color: rgba(0, 0, 0, 0.12);
          padding: 0.1rem 0.4rem;
          border-radius: 10px;
          font-size: 0.68rem;
        }
        .word-tab-btn.active .tab-count {
          background-color: rgba(255, 255, 255, 0.25);
        }

        .word-filter-controls {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          flex-wrap: wrap;
        }
        .word-search-wrapper {
          position: relative;
          flex: 1;
          min-width: 240px;
        }
        .word-search-input {
          width: 100%;
          padding: 0.45rem 0.75rem;
          border: 1px solid #cbd5e1;
          border-radius: 6px;
          font-size: 0.8rem;
          color: #0f172a;
          background-color: #ffffff;
          outline: none;
        }
        .word-search-input:focus {
          border-color: #185abd;
          box-shadow: 0 0 0 2px rgba(24, 90, 189, 0.15);
        }
        .word-search-clear {
          position: absolute;
          right: 8px;
          top: 50%;
          transform: translateY(-50%);
          background: none;
          border: none;
          font-size: 1.1rem;
          color: #94a3b8;
          cursor: pointer;
        }
        .word-select-group {
          display: flex;
          gap: 0.5rem;
        }
        .word-select-filter {
          padding: 0.45rem 0.65rem;
          border: 1px solid #cbd5e1;
          border-radius: 6px;
          font-size: 0.8rem;
          color: #334155;
          background-color: #ffffff;
          outline: none;
        }
        .word-select-filter:focus {
          border-color: #185abd;
        }

        /* View Toggle Bar */
        .word-view-toggle-bar {
          background-color: #ffffff;
          border-left: 1px solid #e2e8f0;
          border-right: 1px solid #e2e8f0;
          padding: 0.5rem 1.25rem;
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1px solid #f1f5f9;
        }
        .view-toggle-label {
          font-size: 0.8rem;
          font-weight: 700;
          color: #334155;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .item-count-badge {
          background-color: #e2e8f0;
          padding: 0.15rem 0.5rem;
          border-radius: 12px;
          font-size: 0.7rem;
          color: #475569;
        }
        .view-toggle-buttons {
          display: flex;
          gap: 0.25rem;
        }
        .toggle-btn {
          padding: 0.35rem 0.75rem;
          font-size: 0.75rem;
          font-weight: 600;
          border-radius: 4px;
          border: 1px solid #cbd5e1;
          background-color: #ffffff;
          color: #475569;
          cursor: pointer;
        }
        .toggle-btn.active {
          background-color: #185abd;
          color: #ffffff;
          border-color: #185abd;
        }

        /* Table Card */
        .word-table-card {
          background-color: #ffffff;
          border: 1px solid #e2e8f0;
          border-top: none;
          border-radius: 0 0 8px 8px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
          overflow: hidden;
        }
        .word-table-scroll-hint {
          display: none;
          background-color: #eff6ff;
          color: #1d4ed8;
          font-size: 0.72rem;
          padding: 0.35rem 1rem;
          font-weight: 600;
          border-bottom: 1px solid #dbeafe;
        }
        .word-table-responsive-wrapper {
          overflow-x: auto;
          width: 100%;
        }
        .word-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.825rem;
          text-align: left;
        }
        .word-table th {
          background-color: #185abd;
          color: #ffffff;
          padding: 0.65rem 0.85rem;
          font-weight: 700;
          font-size: 0.78rem;
          border: 1px solid #104590;
          white-space: nowrap;
        }
        .word-table td {
          padding: 0.65rem 0.85rem;
          border: 1px solid #e2e8f0;
          vertical-align: middle;
        }
        .word-table-row:nth-child(even) {
          background-color: #f8fafc;
        }
        .word-table-row:hover {
          background-color: #f0f7ff;
        }

        /* Badges */
        .word-code-pill {
          display: inline-block;
          background-color: #e0edff;
          border: 1px solid #bfdbfe;
          color: #185abd;
          padding: 0.15rem 0.45rem;
          border-radius: 4px;
          font-size: 0.72rem;
          font-weight: 700;
        }
        .jenis-badge {
          display: inline-block;
          padding: 0.2rem 0.55rem;
          border-radius: 4px;
          font-size: 0.72rem;
          font-weight: 700;
          white-space: nowrap;
        }
        .jenis-badge.masuk {
          background-color: #e0f2fe;
          color: #0369a1;
          border: 1px solid #bae6fd;
        }
        .jenis-badge.keluar {
          background-color: #dcfce7;
          color: #15803d;
          border: 1px solid #86efac;
        }

        .sifat-badge {
          display: inline-block;
          padding: 0.15rem 0.45rem;
          border-radius: 4px;
          font-size: 0.68rem;
          font-weight: 700;
        }
        .sifat-badge.biasa { background-color: #f1f5f9; color: #475569; }
        .sifat-badge.penting { background-color: #fef3c7; color: #b45309; }
        .sifat-badge.segera { background-color: #fed7aa; color: #c2410c; }
        .sifat-badge.sangat-segera { background-color: #fee2e2; color: #b91c1c; }
        .sifat-badge.rahasia { background-color: #f3e8ff; color: #7e22ce; }

        .kategori-badge {
          display: inline-block;
          font-size: 0.68rem;
          color: #64748b;
          background-color: #f8fafc;
          border: 1px solid #e2e8f0;
          padding: 0.1rem 0.35rem;
          border-radius: 3px;
        }

        .word-drive-link {
          color: #185abd;
          font-weight: 700;
          font-size: 0.75rem;
          text-decoration: underline;
        }

        /* Mobile Card Styles */
        .word-mobile-card-list {
          display: none;
          padding: 0.85rem;
          gap: 0.85rem;
        }
        .word-item-card {
          background-color: #ffffff;
          border: 1px solid #cbd5e1;
          border-radius: 8px;
          padding: 0.95rem;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
        }
        .card-top-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.65rem;
        }
        .card-badge-row {
          display: flex;
          gap: 0.4rem;
          align-items: center;
        }
        .card-code-badge {
          background-color: #e0edff;
          border: 1px solid #bfdbfe;
          color: #185abd;
          padding: 0.15rem 0.45rem;
          border-radius: 4px;
          font-size: 0.75rem;
          font-weight: 700;
        }
        .card-item-heading {
          font-size: 0.95rem;
          font-weight: 700;
          color: #0f172a;
          margin-bottom: 0.4rem;
          line-height: 1.3;
        }
        .card-meta-row {
          display: flex;
          flex-wrap: wrap;
          gap: 0.35rem;
          margin-bottom: 0.65rem;
        }
        .card-meta-pill {
          background-color: #f1f5f9;
          color: #475569;
          font-size: 0.72rem;
          padding: 0.15rem 0.45rem;
          border-radius: 4px;
        }
        .card-detail-block {
          background-color: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 6px;
          padding: 0.65rem;
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
        }
        .card-detail-line {
          font-size: 0.78rem;
          display: flex;
          gap: 0.4rem;
        }
        .dt-label {
          color: #64748b;
          font-weight: 600;
          min-width: 65px;
        }
        .dt-val {
          color: #0f172a;
        }
        .card-bottom-actions {
          margin-top: 0.65rem;
        }
        .card-drive-btn {
          display: block;
          text-align: center;
          background-color: #f0f7ff;
          border: 1px solid #bfdbfe;
          color: #185abd;
          padding: 0.45rem;
          border-radius: 6px;
          font-size: 0.75rem;
          font-weight: 700;
          text-decoration: none;
        }

        /* Modal Styles */
        .word-modal-backdrop {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: rgba(15, 23, 42, 0.65);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 50;
          padding: 1rem;
        }
        .word-modal-card {
          background-color: #ffffff;
          border-radius: 8px;
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.25);
          width: 100%;
          max-width: 680px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          max-height: 92vh;
        }
        .word-modal-header {
          padding: 0.85rem 1.15rem;
          background-color: #f8fafc;
          border-bottom: 1px solid #e2e8f0;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .word-modal-title {
          font-size: 1rem;
          font-weight: 700;
          color: #0f172a;
        }
        .word-modal-close-btn {
          background: none;
          border: none;
          font-size: 1.25rem;
          color: #64748b;
          cursor: pointer;
        }
        .word-modal-body {
          padding: 1.15rem;
          overflow-y: auto;
          flex: 1;
        }
        .word-modal-footer {
          padding: 0.75rem 1.15rem;
          background-color: #f8fafc;
          border-top: 1px solid #e2e8f0;
          display: flex;
          justify-content: flex-end;
          gap: 0.5rem;
        }

        /* Form Grid */
        .word-form-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0.85rem;
        }
        .word-form-group.full-col {
          grid-column: span 2;
        }
        .word-form-group label {
          display: block;
          font-size: 0.78rem;
          font-weight: 700;
          color: #334155;
          margin-bottom: 0.3rem;
        }
        .req { color: #be123c; }
        .word-form-control {
          width: 100%;
          padding: 0.5rem 0.7rem;
          border: 1px solid #cbd5e1;
          border-radius: 6px;
          font-size: 0.85rem;
          color: #0f172a;
          background-color: #ffffff;
          outline: none;
        }
        .word-form-control:focus {
          border-color: #185abd;
          box-shadow: 0 0 0 2px rgba(24, 90, 189, 0.15);
        }
        .word-success-alert {
          background-color: #dcfce7;
          border: 1px solid #86efac;
          color: #15803d;
          padding: 0.65rem;
          border-radius: 6px;
          margin-bottom: 0.85rem;
          font-weight: 600;
          font-size: 0.825rem;
        }
        .word-error-box {
          background-color: #fee2e2;
          border: 1px solid #fecaca;
          color: #b91c1c;
          padding: 0.75rem 1rem;
          border-radius: 6px;
          margin-bottom: 1rem;
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 0.825rem;
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

        /* Upload Dropzone & Preview */
        .word-upload-dropzone {
          border: 2px dashed #93c5fd;
          background-color: #f8fafc;
          border-radius: 8px;
          padding: 1.25rem 1rem;
          text-align: center;
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 0.35rem;
        }
        .word-upload-dropzone:hover {
          border-color: #185abd;
          background-color: #f0f7ff;
        }
        .upload-icon-box {
          color: #185abd;
          margin-bottom: 0.25rem;
        }
        .upload-text-main {
          font-weight: 700;
          color: #185abd;
          font-size: 0.9rem;
        }
        .upload-text-sub {
          font-size: 0.75rem;
          color: #64748b;
          max-width: 440px;
        }
        .upload-badge-drive {
          display: inline-block;
          margin-top: 0.4rem;
          font-size: 0.7rem;
          font-weight: 600;
          color: #0369a1;
          background-color: #e0f2fe;
          border: 1px solid #bae6fd;
          padding: 0.2rem 0.55rem;
          border-radius: 4px;
        }
        .word-upload-preview-box {
          display: flex;
          align-items: center;
          gap: 1rem;
          background-color: #f8fafc;
          border: 1px solid #cbd5e1;
          border-radius: 8px;
          padding: 0.75rem;
        }
        .preview-thumb-wrapper {
          width: 75px;
          height: 75px;
          flex-shrink: 0;
          border-radius: 6px;
          overflow: hidden;
          background-color: #e2e8f0;
          border: 1px solid #cbd5e1;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .preview-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .doc-icon-placeholder {
          font-size: 0.85rem;
          font-weight: 800;
          color: #185abd;
          background-color: #e0edff;
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .preview-info-col {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
          min-width: 0;
        }
        .upload-status-uploading {
          display: flex;
          align-items: center;
          gap: 0.45rem;
          font-size: 0.8rem;
          font-weight: 600;
          color: #185abd;
        }
        .spinner-inline {
          width: 14px;
          height: 14px;
          border: 2px solid #bfdbfe;
          border-top-color: #185abd;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .upload-status-success {
          display: flex;
          flex-direction: column;
          gap: 0.2rem;
        }
        .check-badge {
          display: inline-block;
          font-size: 0.72rem;
          font-weight: 700;
          color: #15803d;
          background-color: #dcfce7;
          border: 1px solid #86efac;
          padding: 0.15rem 0.45rem;
          border-radius: 4px;
          width: fit-content;
        }
        .filename-text {
          font-size: 0.75rem;
          color: #475569;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .ai-detected-text {
          font-size: 0.72rem;
          color: #0369a1;
          font-weight: 600;
        }
        .drive-link-btn {
          font-size: 0.75rem;
          color: #185abd;
          text-decoration: underline;
          width: fit-content;
        }
        .upload-status-error {
          font-size: 0.75rem;
          color: #b91c1c;
          font-weight: 600;
        }
        .preview-action-row {
          display: flex;
          gap: 0.5rem;
          margin-top: 0.2rem;
        }
        .btn-change-photo {
          background-color: #ffffff;
          border: 1px solid #cbd5e1;
          color: #334155;
          padding: 0.25rem 0.6rem;
          border-radius: 4px;
          font-size: 0.75rem;
          font-weight: 600;
          cursor: pointer;
        }
        .btn-remove-photo {
          background-color: #ffffff;
          border: 1px solid #fecaca;
          color: #b91c1c;
          padding: 0.25rem 0.6rem;
          border-radius: 4px;
          font-size: 0.75rem;
          font-weight: 600;
          cursor: pointer;
        }
        .toggle-link-btn {
          background: none;
          border: none;
          color: #64748b;
          font-size: 0.73rem;
          text-decoration: underline;
          cursor: pointer;
          padding: 0;
        }

        /* Responsive Breakpoints */
        @media (max-width: 768px) {
          .word-stats-ribbon {
            grid-template-columns: 1fr 1fr;
          }
          .word-header-meta {
            flex-direction: column;
          }
          .word-header-actions {
            width: 100%;
          }
          .word-header-actions .word-btn {
            flex: 1;
          }
          .word-form-grid {
            grid-template-columns: 1fr;
          }
          .word-form-group.full-col {
            grid-column: span 1;
          }
          .word-form-control {
            font-size: 16px !important;
          }

          .word-table-card.mobile-card-mode .word-table-responsive-wrapper {
            display: none;
          }
          .word-table-card.mobile-card-mode .word-mobile-card-list {
            display: flex;
            flex-direction: column;
          }
          .word-table-card.mobile-table-mode .word-table-scroll-hint {
            display: flex;
          }
        }

        @media (max-width: 480px) {
          .nav-text {
            display: none;
          }
          .word-nav-link,
          .word-nav-bot {
            padding: 0.35rem 0.5rem;
            font-size: 0.85rem;
          }
          .word-app-subtitle {
            display: none;
          }
        }
      `}</style>
    </div>
  );
}
