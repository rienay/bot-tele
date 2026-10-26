'use client';

import { useState, useEffect, useMemo } from 'react';
import { WebFinanceData, WebTransactionItem } from '@/lib/types';

function formatRupiah(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount);
}

function parseDateParts(dateStr: string): { year?: string; month?: string } {
  if (!dateStr) return {};
  const cleaned = String(dateStr).trim().replace(/^'/, '');
  // Format YYYY-MM-DD or YYYY/MM/DD
  const ymdMatch = cleaned.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (ymdMatch) {
    return {
      year: ymdMatch[1],
      month: ymdMatch[2].padStart(2, '0'),
    };
  }
  // Format DD-MM-YYYY or DD/MM/YYYY
  const dmyMatch = cleaned.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (dmyMatch) {
    return {
      year: dmyMatch[3],
      month: dmyMatch[2].padStart(2, '0'),
    };
  }
  return {};
}

const MONTH_OPTIONS = [
  { value: '01', label: 'Januari' },
  { value: '02', label: 'Februari' },
  { value: '03', label: 'Maret' },
  { value: '04', label: 'April' },
  { value: '05', label: 'Mei' },
  { value: '06', label: 'Juni' },
  { value: '07', label: 'Juli' },
  { value: '08', label: 'Agustus' },
  { value: '09', label: 'September' },
  { value: '10', label: 'Oktober' },
  { value: '11', label: 'November' },
  { value: '12', label: 'Desember' },
];

export default function FinanceDashboardPage() {
  const [data, setData] = useState<WebFinanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedBook, setSelectedBook] = useState<string>('Semua');
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'Pemasukan' | 'Pengeluaran' | 'with_receipt'>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedMonth, setSelectedMonth] = useState<string>('all');
  const [selectedYear, setSelectedYear] = useState<string>('all');
  const [visibleCount, setVisibleCount] = useState(25);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchData = async (book: string = 'Semua', showRefreshSpinner = false) => {
    if (showRefreshSpinner) setIsRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/finances?book=${encodeURIComponent(book)}`);
      const json = await res.json();
      if (json.success && json.data) {
        setData(json.data);
      } else {
        throw new Error(json.error || 'Gagal memuat data keuangan');
      }
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Terjadi gangguan saat memuat data.');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData(selectedBook);
    setVisibleCount(25);
  }, [selectedBook]);

  // Daftar tahun unik dari data
  const availableYears = useMemo(() => {
    if (!data?.transactions) return [];
    const years = new Set<string>();
    data.transactions.forEach((tx) => {
      const { year } = parseDateParts(tx.date);
      if (year) years.add(year);
    });
    return Array.from(years).sort((a, b) => b.localeCompare(a));
  }, [data?.transactions]);

  // Daftar kategori unik dari data
  const availableCategories = useMemo(() => {
    if (!data?.transactions) return [];
    const cats = new Set<string>();
    data.transactions.forEach((tx) => {
      if (tx.category && tx.category.trim()) cats.add(tx.category.trim());
    });
    return Array.from(cats).sort((a, b) => a.localeCompare(b));
  }, [data?.transactions]);

  // Filter transaksi berdasarkan search, jenis, kategori, bulan, dan tahun
  const filteredTransactions = useMemo(() => {
    if (!data?.transactions) return [];

    return data.transactions.filter((tx) => {
      // Filter Jenis
      if (typeFilter === 'Pemasukan' && tx.type !== 'Pemasukan') return false;
      if (typeFilter === 'Pengeluaran' && tx.type !== 'Pengeluaran') return false;
      if (typeFilter === 'with_receipt' && !tx.noteLink) return false;

      // Filter Kategori
      if (selectedCategory !== 'all' && tx.category !== selectedCategory) return false;

      // Filter Bulan & Tahun
      if (selectedYear !== 'all' || selectedMonth !== 'all') {
        const { year, month } = parseDateParts(tx.date);
        if (selectedYear !== 'all' && year !== selectedYear) return false;
        if (selectedMonth !== 'all' && month !== selectedMonth) return false;
      }

      // Filter Search (keterangan, kategori, PIC, tanggal, buku)
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchDesc = tx.description.toLowerCase().includes(q);
        const matchCat = tx.category.toLowerCase().includes(q);
        const matchPic = tx.pic ? tx.pic.toLowerCase().includes(q) : false;
        const matchBook = tx.book.toLowerCase().includes(q);
        const matchDate = tx.date.toLowerCase().includes(q);
        const matchAmount = String(tx.amount).includes(q);

        return matchDesc || matchCat || matchPic || matchBook || matchDate || matchAmount;
      }

      return true;
    });
  }, [data?.transactions, typeFilter, selectedCategory, selectedMonth, selectedYear, searchQuery]);

  // Ringkasan metrik dari transaksi yang sedang difilter
  const filteredSummary = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const tx of filteredTransactions) {
      if (tx.type === 'Pemasukan') income += tx.amount;
      else expense += tx.amount;
    }
    return {
      income,
      expense,
      balance: income - expense,
      count: filteredTransactions.length,
    };
  }, [filteredTransactions]);

  const isAnyFilterActive =
    typeFilter !== 'all' ||
    selectedCategory !== 'all' ||
    selectedMonth !== 'all' ||
    selectedYear !== 'all' ||
    searchQuery.trim() !== '';

  const handleResetFilters = () => {
    setTypeFilter('all');
    setSelectedCategory('all');
    setSelectedMonth('all');
    setSelectedYear('all');
    setSearchQuery('');
  };

  // Hitung kategori unik untuk chip breakdown
  const categoryStats = useMemo(() => {
    if (!data?.stats?.categoryExpenses) return [];
    return Object.entries(data.stats.categoryExpenses)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8); // Top 8 kategori
  }, [data?.stats?.categoryExpenses]);

  return (
    <div>
      {/* Top Glass Navbar */}
      <nav className="navbar">
        <div className="nav-container">
          <a href="#" className="brand">
            <div className="brand-icon">🌸</div>
            <div>
              <div className="brand-title">Catatan Keuangan</div>
              <div className="brand-subtitle">Dewan Kerja Cabang (DKC)</div>
            </div>
          </a>

          <a
            href="https://t.me/duit_pwd_bot"
            target="_blank"
            rel="noopener noreferrer"
            className="bot-badge"
            title="Catat pengeluaran lewat Telegram"
          >
            <span>🤖</span>
            <span>@duit_pwd_bot</span>
          </a>
        </div>
      </nav>

      <main className="main-wrapper">
        {/* Hero Section */}
        <header className="hero-banner">
          <div className="hero-tag">✨ Portal Keuangan Transparan</div>
          <h1 className="hero-title">Akses Keuangan Lebih Asik & Terbuka</h1>
          <p className="hero-desc">
            Pantau seluruh saldo kas, pengeluaran kegiatan, dan bukti struk nota secara transparan & mudah dipahami.
          </p>
        </header>

        {/* Tab Pilihan Buku Kegiatan */}
        <div className="book-tabs-container">
          <div className="book-tabs">
            {data?.books && data.books.length > 0 ? (
              data.books.map((b) => (
                <button
                  key={b}
                  className={`book-tab-btn ${selectedBook === b ? 'active' : ''}`}
                  onClick={() => setSelectedBook(b)}
                >
                  <span>{b === 'Semua' ? '🌟' : b.toLowerCase() === 'kas' ? '📌' : '📖'}</span>
                  <span>{b === 'Semua' ? 'Semua Buku' : b}</span>
                </button>
              ))
            ) : (
              <button className="book-tab-btn active">Memuat Buku...</button>
            )}
          </div>
        </div>

        {/* Status Error atau Loading */}
        {error && (
          <div style={{ background: '#FFF1F2', border: '1px solid #FECDD3', padding: '1rem', borderRadius: '12px', color: '#BE123C', marginBottom: '1.5rem', fontWeight: 600 }}>
            ⚠️ {error}
            <button onClick={() => fetchData(selectedBook)} style={{ marginLeft: '1rem', textDecoration: 'underline', background: 'none', border: 'none', color: '#BE123C', cursor: 'pointer', fontWeight: 700 }}>
              Coba lagi
            </button>
          </div>
        )}

        {/* Stat Cards Grid */}
        <section className="stats-grid">
          {/* Card Saldo */}
          <div className="stat-card hero-stat">
            <div className="stat-header">
              <span className="stat-label">Sisa Saldo Bersih</span>
              <div className="stat-icon" style={{ background: '#FCE7F3', color: '#BE123C' }}>💰</div>
            </div>
            <div className="stat-value" style={{ color: (data?.stats.saldo || 0) >= 0 ? '#047857' : '#BE123C' }}>
              {loading && !data ? '...' : formatRupiah(data?.stats.saldo || 0)}
            </div>
            <div className="stat-subtext">
              {(data?.stats.saldo || 0) >= 0 ? '🟢 Kas aman & surplus' : '🔻 Terjadi defisit kas'}
            </div>
          </div>

          {/* Card Pemasukan */}
          <div className="stat-card">
            <div className="stat-header">
              <span className="stat-label">Total Pemasukan</span>
              <div className="stat-icon" style={{ background: '#ECFDF5', color: '#047857' }}>📥</div>
            </div>
            <div className="stat-value" style={{ color: '#047857' }}>
              {loading && !data ? '...' : formatRupiah(data?.stats.totalPemasukan || 0)}
            </div>
            <div className="stat-subtext">Akumulasi dana masuk</div>
          </div>

          {/* Card Pengeluaran */}
          <div className="stat-card">
            <div className="stat-header">
              <span className="stat-label">Total Pengeluaran</span>
              <div className="stat-icon" style={{ background: '#FFF1F2', color: '#BE123C' }}>📤</div>
            </div>
            <div className="stat-value" style={{ color: '#BE123C' }}>
              {loading && !data ? '...' : formatRupiah(data?.stats.totalPengeluaran || 0)}
            </div>
            <div className="stat-subtext">Total realisasi belanja</div>
          </div>

          {/* Card Jumlah Transaksi */}
          <div className="stat-card">
            <div className="stat-header">
              <span className="stat-label">Total Transaksi</span>
              <div className="stat-icon" style={{ background: '#FAF5FF', color: '#7E22CE' }}>🧾</div>
            </div>
            <div className="stat-value">
              {loading && !data ? '...' : `${data?.stats.count || 0} Kali`}
            </div>
            <div className="stat-subtext">Data tercatat lengkap</div>
          </div>
        </section>

        {/* Category Breakdown (Top Kategori Belanja) */}
        {categoryStats.length > 0 && (
          <section className="category-summary-box">
            <div className="category-summary-title">
              <span>🎯 Top Kategori Belanja ({selectedBook}):</span>
              {selectedCategory !== 'all' && (
                <button
                  onClick={() => setSelectedCategory('all')}
                  style={{ background: 'none', border: 'none', color: '#BE123C', fontSize: '0.8rem', cursor: 'pointer', fontWeight: 700 }}
                >
                  ✕ Reset Filter Kategori
                </button>
              )}
            </div>
            <div className="category-chips">
              {categoryStats.map(([cat, amount]) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(selectedCategory === cat ? 'all' : cat)}
                  className="category-chip"
                  style={{
                    cursor: 'pointer',
                    background: selectedCategory === cat ? '#F43F5E' : undefined,
                    color: selectedCategory === cat ? '#FFFFFF' : undefined,
                  }}
                >
                  <span>{cat}</span>
                  <span className="chip-amount" style={{ color: selectedCategory === cat ? '#FFFFFF' : undefined }}>
                    {formatRupiah(amount)}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Filter & Search Bar */}
        <section className="controls-bar">
          <div className="controls-row-top">
            <div className="search-box">
              <span className="search-icon">🔍</span>
              <input
                type="text"
                placeholder="Cari transaksi, item, kategori, tanggal, atau PIC..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="search-input"
              />
            </div>

            <div className="filter-pills">
              <button
                className={`filter-pill ${typeFilter === 'all' ? 'active' : ''}`}
                onClick={() => setTypeFilter('all')}
              >
                Semua ({data?.transactions.length || 0})
              </button>
              <button
                className={`filter-pill ${typeFilter === 'Pengeluaran' ? 'active' : ''}`}
                onClick={() => setTypeFilter('Pengeluaran')}
              >
                🔴 Pengeluaran
              </button>
              <button
                className={`filter-pill ${typeFilter === 'Pemasukan' ? 'active' : ''}`}
                onClick={() => setTypeFilter('Pemasukan')}
              >
                🟢 Pemasukan
              </button>
              <button
                className={`filter-pill ${typeFilter === 'with_receipt' ? 'active' : ''}`}
                onClick={() => setTypeFilter('with_receipt')}
              >
                📎 Ada Nota Struk
              </button>
            </div>
          </div>

          <div className="controls-row-filters">
            {/* Filter Kategori Dropdown */}
            <div className="filter-select-wrapper">
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className={`filter-select ${selectedCategory !== 'all' ? 'active' : ''}`}
                title="Filter berdasarkan Kategori"
              >
                <option value="all">📂 Semua Kategori</option>
                {availableCategories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            {/* Filter Bulan Dropdown */}
            <div className="filter-select-wrapper">
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className={`filter-select ${selectedMonth !== 'all' ? 'active' : ''}`}
                title="Filter berdasarkan Bulan"
              >
                <option value="all">📅 Semua Bulan</option>
                {MONTH_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.value} - {m.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Filter Tahun Dropdown */}
            <div className="filter-select-wrapper">
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
                className={`filter-select ${selectedYear !== 'all' ? 'active' : ''}`}
                title="Filter berdasarkan Tahun"
              >
                <option value="all">🗓️ Semua Tahun</option>
                {availableYears.map((yr) => (
                  <option key={yr} value={yr}>
                    Tahun {yr}
                  </option>
                ))}
              </select>
            </div>

            {/* Tombol Reset Filter */}
            {isAnyFilterActive && (
              <button
                onClick={handleResetFilters}
                className="btn-reset-filters"
                title="Kembalikan semua filter ke awal"
              >
                <span>✕</span>
                <span>Reset Filter</span>
              </button>
            )}
          </div>

          {/* Banner Ringkasan Hasil Filter */}
          {isAnyFilterActive && (
            <div className="filtered-summary-banner">
              <div className="filtered-summary-metrics">
                <span className="filtered-summary-item">
                  <span>📊 Terfilter:</span>
                  <span className="filtered-summary-val">{filteredSummary.count} Transaksi</span>
                </span>
                <span className="filtered-summary-item">
                  <span>📥 Pemasukan:</span>
                  <span className="filtered-summary-val" style={{ color: '#047857' }}>
                    +{formatRupiah(filteredSummary.income)}
                  </span>
                </span>
                <span className="filtered-summary-item">
                  <span>📤 Pengeluaran:</span>
                  <span className="filtered-summary-val" style={{ color: '#BE123C' }}>
                    -{formatRupiah(filteredSummary.expense)}
                  </span>
                </span>
                <span className="filtered-summary-item">
                  <span>💰 Saldo Periode:</span>
                  <span
                    className="filtered-summary-val"
                    style={{ color: filteredSummary.balance >= 0 ? '#047857' : '#BE123C' }}
                  >
                    {formatRupiah(filteredSummary.balance)}
                  </span>
                </span>
              </div>
            </div>
          )}
        </section>

        {/* Transactions Feed */}
        <section>
          <div className="transactions-header">
            <div>
              <h2 className="transactions-title">Daftar Transaksi ({selectedBook})</h2>
              <div className="transactions-count">
                Menampilkan {Math.min(visibleCount, filteredTransactions.length)} dari {filteredTransactions.length} transaksi
              </div>
            </div>

            <button
              onClick={() => fetchData(selectedBook, true)}
              disabled={isRefreshing}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.45rem 0.85rem',
                borderRadius: '9999px',
                background: '#FFFFFF',
                border: '1px solid rgba(244, 63, 94, 0.2)',
                color: '#BE123C',
                fontSize: '0.8rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              <span>{isRefreshing ? '⏳' : '🔄'}</span>
              <span>{isRefreshing ? 'Memperbarui...' : 'Refresh'}</span>
            </button>
          </div>

          {loading && !data ? (
            <div className="empty-state">
              <div className="empty-icon">⏳</div>
              <div className="empty-title">Memuat data keuangan...</div>
              <div className="empty-desc">Mengambil catatan terbaru dari spreadsheet secara langsung.</div>
            </div>
          ) : filteredTransactions.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">🌸</div>
              <div className="empty-title">Tidak ada transaksi ditemukan</div>
              <div className="empty-desc">
                {searchQuery
                  ? `Tidak ada hasil yang cocok dengan kata kunci "${searchQuery}".`
                  : 'Belum ada transaksi pada filter ini.'}
              </div>
            </div>
          ) : (
            <>
              <div className="table-scroll-hint">
                <span>↔️ Geser tabel ke samping untuk melihat nominal & nota</span>
              </div>
              <div className="table-card">
                <div className="table-responsive">
                  <table className="finance-table">
                    <thead>
                      <tr>
                        <th className="col-num desktop-only">#</th>
                        <th className="col-date desktop-only">Tanggal</th>
                        <th>Keterangan</th>
                        <th className="desktop-only">Buku Kas</th>
                        <th className="desktop-only">Kategori</th>
                        <th className="desktop-only">Jenis</th>
                        <th style={{ textAlign: 'right' }}>Nominal</th>
                        <th className="desktop-only" style={{ textAlign: 'center' }}>Bukti Nota</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTransactions.slice(0, visibleCount).map((tx, idx) => {
                        const isIncome = tx.type === 'Pemasukan';
                        return (
                          <tr key={tx.id || idx}>
                            <td className="col-num desktop-only">{idx + 1}</td>
                            <td className="col-date desktop-only">
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                                <span>📅</span>
                                <span>{tx.date}</span>
                              </span>
                            </td>
                            <td className="col-desc">
                              <span className="tx-table-desc">{tx.description || tx.category}</span>
                              {/* Mobile-only metadata */}
                              <div className="mobile-only-meta">
                                <span>📅 {tx.date}</span>
                                <span>•</span>
                                <span className="book-badge">📖 {tx.book}</span>
                                <span>•</span>
                                <span className="cat-badge">{tx.category}</span>
                                {tx.pic && (
                                  <span className="tx-table-pic">
                                    <span>👤</span>
                                    <span>{tx.pic}</span>
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="desktop-only">
                              <span className="book-badge">
                                <span>📖</span>
                                <span>{tx.book}</span>
                              </span>
                            </td>
                            <td className="desktop-only">
                              <span className="cat-badge">{tx.category}</span>
                            </td>
                            <td className="desktop-only">
                              <span className={`type-badge ${isIncome ? 'pemasukan' : 'pengeluaran'}`}>
                                <span>{isIncome ? '📥 Masuk' : '📤 Keluar'}</span>
                              </span>
                            </td>
                            <td className={`col-amount ${isIncome ? 'pemasukan' : 'pengeluaran'}`}>
                              <div>
                                {isIncome ? '+' : '-'} {formatRupiah(tx.amount)}
                              </div>
                              {/* Mobile-only nota link */}
                              <div className="mobile-only-nota">
                                {tx.noteLink ? (
                                  <a
                                    href={tx.noteLink}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="btn-nota-sm"
                                    title="Buka bukti foto struk"
                                  >
                                    <span>📎</span>
                                    <span>Lihat Nota</span>
                                  </a>
                                ) : (
                                  <span style={{ fontSize: '0.72rem', color: '#9CA3AF' }}>Tanpa Struk</span>
                                )}
                              </div>
                            </td>
                            <td className="col-nota desktop-only">
                              {tx.noteLink ? (
                                <a
                                  href={tx.noteLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="btn-nota"
                                  title="Buka bukti foto struk di Google Drive"
                                >
                                  <span>📎</span>
                                  <span>Lihat Nota</span>
                                </a>
                              ) : (
                                <span style={{ fontSize: '0.75rem', color: '#9CA3AF' }}>—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

              {visibleCount < filteredTransactions.length && (
                <div style={{ textAlign: 'center', padding: '1.25rem', borderTop: '1px solid rgba(244, 63, 94, 0.1)', background: '#FFFDFE' }}>
                  <button
                    onClick={() => setVisibleCount((prev) => prev + 50)}
                    style={{
                      padding: '0.65rem 1.75rem',
                      borderRadius: '9999px',
                      background: 'linear-gradient(135deg, #F43F5E, #FB7185)',
                      color: '#FFFFFF',
                      border: 'none',
                      fontSize: '0.85rem',
                      fontWeight: 800,
                      cursor: 'pointer',
                      boxShadow: '0 4px 14px rgba(244, 63, 94, 0.25)',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    Muat 50 Transaksi Lagi (Sisa {filteredTransactions.length - visibleCount}) ⤵
                  </button>
                </div>
              )}
              </div>
            </>
          )}
        </section>

        {/* Info Banner Bot */}
        <section style={{ marginTop: '3rem', background: '#FFFFFF', border: '1px solid rgba(244, 63, 94, 0.2)', borderRadius: '16px', padding: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', boxShadow: 'var(--shadow-sm)' }}>
          <div>
            <h3 style={{ fontFamily: 'Outfit, sans-serif', fontSize: '1.1rem', fontWeight: 800, color: '#4C0519', marginBottom: '0.25rem' }}>
              💬 Ingin mencatat pemasukan atau pengeluaran baru?
            </h3>
            <p style={{ fontSize: '0.85rem', color: '#881337' }}>
              Gunakan bot Telegram kami. Cukup ketik chat biasa (contoh: <i>Beli konsumsi 35rb</i>) atau kirim foto nota struk belanja!
            </p>
          </div>
          <a
            href="https://t.me/duit_pwd_bot"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: '0.65rem 1.25rem',
              borderRadius: '9999px',
              background: '#F43F5E',
              color: '#FFFFFF',
              fontWeight: 800,
              fontSize: '0.88rem',
              textDecoration: 'none',
              boxShadow: '0 4px 12px rgba(244, 63, 94, 0.3)',
              whiteSpace: 'nowrap',
            }}
          >
            Buka Bot Telegram ➔
          </a>
        </section>
      </main>

      {/* Footer */}
      <footer className="footer">
        <p>🌸 Dashboard Keuangan DKC • Terhubung Otomatis ke Google Sheets & Drive</p>
        <p style={{ marginTop: '0.35rem', fontSize: '0.78rem' }}>
          Terakhir sinkronisasi: {data?.lastUpdated || 'Baru saja'}
        </p>
      </footer>
    </div>
  );
}
