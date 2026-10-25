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

export default function FinanceDashboardPage() {
  const [data, setData] = useState<WebFinanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedBook, setSelectedBook] = useState<string>('Semua');
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'Pemasukan' | 'Pengeluaran' | 'with_receipt'>('all');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
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

  // Filter transaksi berdasarkan search, jenis, dan kategori
  const filteredTransactions = useMemo(() => {
    if (!data?.transactions) return [];

    return data.transactions.filter((tx) => {
      // Filter Jenis
      if (typeFilter === 'Pemasukan' && tx.type !== 'Pemasukan') return false;
      if (typeFilter === 'Pengeluaran' && tx.type !== 'Pengeluaran') return false;
      if (typeFilter === 'with_receipt' && !tx.noteLink) return false;

      // Filter Kategori
      if (selectedCategory && tx.category !== selectedCategory) return false;

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
  }, [data?.transactions, typeFilter, selectedCategory, searchQuery]);

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
              {selectedCategory && (
                <button
                  onClick={() => setSelectedCategory(null)}
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
                  onClick={() => setSelectedCategory(selectedCategory === cat ? null : cat)}
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
          <div className="search-box">
            <span className="search-icon">🔍</span>
            <input
              type="text"
              placeholder="Cari transaksi, item, kategori, atau PIC..."
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
            <div className="transaction-list">
              {filteredTransactions.slice(0, visibleCount).map((tx) => {
                const isIncome = tx.type === 'Pemasukan';
                return (
                  <article key={tx.id} className="tx-card">
                    <div className="tx-left">
                      <div className={`tx-icon-badge ${isIncome ? 'pemasukan' : 'pengeluaran'}`}>
                        {isIncome ? '📥' : '📤'}
                      </div>

                      <div className="tx-info">
                        <div className="tx-desc-row">
                          <span className="tx-desc">{tx.description || tx.category}</span>
                          {tx.pic && (
                            <span className="tx-pic-badge">
                              <span>👤</span>
                              <span>PIC: {tx.pic}</span>
                            </span>
                          )}
                        </div>

                        <div className="tx-meta-row">
                          <span>📅 {tx.date}</span>
                          <span>•</span>
                          <span className="tx-pill">{tx.category}</span>
                          <span>•</span>
                          <span style={{ fontWeight: 600, color: '#9F1239' }}>📖 {tx.book}</span>
                        </div>
                      </div>
                    </div>

                    <div className="tx-right">
                      <div className={`tx-amount ${isIncome ? 'pemasukan' : 'pengeluaran'}`}>
                        {isIncome ? '+' : '-'} {formatRupiah(tx.amount)}
                      </div>

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
                        <span style={{ fontSize: '0.72rem', color: '#9CA3AF' }}>Tanpa Struk</span>
                      )}
                    </div>
                  </article>
                );
              })}

              {visibleCount < filteredTransactions.length && (
                <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
                  <button
                    onClick={() => setVisibleCount((prev) => prev + 25)}
                    style={{
                      padding: '0.75rem 2rem',
                      borderRadius: '9999px',
                      background: 'linear-gradient(135deg, #F43F5E, #FB7185)',
                      color: '#FFFFFF',
                      border: 'none',
                      fontSize: '0.9rem',
                      fontWeight: 800,
                      cursor: 'pointer',
                      boxShadow: '0 4px 14px rgba(244, 63, 94, 0.35)',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    Muat 25 Transaksi Lagi ⤵
                  </button>
                </div>
              )}
            </div>
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
