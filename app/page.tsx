'use client';

import { useState, useEffect, useCallback } from 'react';
import { WebRoleConfig, WebRoleKey, getRoleConfig } from '@/lib/webAuth';
import { WebFinanceData } from '@/lib/types';
import FinancePanel from './components/FinancePanel';
import KasPanel from './components/KasPanel';
import InventarisPanel from './components/InventarisPanel';
import SuratPanel from './components/SuratPanel';
import ChatBotPanel from './components/ChatBotPanel';

type MenuTab = 'keuangan' | 'kas' | 'inventaris' | 'surat' | 'chatbot';

interface StoredSession {
  role: WebRoleKey;
  userName: string;
}

const STORAGE_KEY = 'dkc_web_session_v1';

export default function HomePage() {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<StoredSession | null>(null);
  const [activeTab, setActiveTab] = useState<MenuTab>('keuangan');

  // Login form state
  const [codeInput, setCodeInput] = useState('');
  const [showCode, setShowCode] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState('');

  // Finance state (for Bendahara)
  const [financeData, setFinanceData] = useState<WebFinanceData | null>(null);
  const [financeLoading, setFinanceLoading] = useState(false);
  const [selectedBook, setSelectedBook] = useState('Semua');

  // Refresh counters for child panels when chatbot mutates data
  const [kasRefresh, setKasRefresh] = useState(0);
  const [invRefresh, setInvRefresh] = useState(0);
  const [suratRefresh, setSuratRefresh] = useState(0);

  // PWA Install Prompt
  const [installPrompt, setInstallPrompt] = useState<any>(null);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall);
  }, []);

  const triggerInstall = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    try {
      await installPrompt.userChoice;
    } catch {
      // ignore
    }
    setInstallPrompt(null);
  };

  const roleConfig: WebRoleConfig | null = session ? getRoleConfig(session.role) : null;

  const getDefaultTab = (cfg: WebRoleConfig): MenuTab => {
    if (cfg.permissions.finance) return 'keuangan';
    return 'inventaris';
  };

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const aksesParam = params.get('akses');
      if (aksesParam) {
        setCodeInput(aksesParam);
      }

      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as StoredSession;
        const cfg = getRoleConfig(parsed?.role);
        if (cfg) {
          setSession({ role: cfg.key, userName: parsed.userName || cfg.shortLabel });
          setActiveTab(getDefaultTab(cfg));
        }
      }
    } catch {
      // ignore invalid storage
    } finally {
      setReady(true);
    }
  }, []);

  const loadFinance = useCallback(async (book: string) => {
    setFinanceLoading(true);
    try {
      const res = await fetch(`/api/finances?book=${encodeURIComponent(book)}`);
      const json = await res.json();
      if (json.success && json.data) {
        setFinanceData(json.data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setFinanceLoading(false);
    }
  }, []);

  useEffect(() => {
    if (roleConfig?.permissions.finance) {
      loadFinance(selectedBook);
    }
  }, [roleConfig?.key, roleConfig?.permissions.finance, selectedBook, loadFinance]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!codeInput.trim() || loginBusy) return;
    setLoginBusy(true);
    setLoginError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: codeInput.trim(), name: nameInput.trim() }),
      });
      const json = await res.json();
      if (!json.success || !json.session) {
        throw new Error(json.error || 'Kode akses tidak valid');
      }

      const nextSession: StoredSession = {
        role: json.session.role,
        userName: json.session.userName,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSession));
      setSession(nextSession);
      const cfg = getRoleConfig(nextSession.role);
      if (cfg) setActiveTab(getDefaultTab(cfg));
    } catch (err: any) {
      setLoginError(err?.message || 'Gagal masuk');
    } finally {
      setLoginBusy(false);
    }
  };

  const handleLogout = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    setSession(null);
    setFinanceData(null);
    setCodeInput('');
    setLoginError('');
  };

  const handleChatAction = (action: string) => {
    if (action === 'refresh_finance') loadFinance(selectedBook);
    if (action === 'refresh_kas') setKasRefresh((n) => n + 1);
    if (action === 'refresh_inventaris') setInvRefresh((n) => n + 1);
    if (action === 'refresh_surat') setSuratRefresh((n) => n + 1);
  };

  if (!ready) {
    return (
      <div className="login-shell">
        <div className="login-card" style={{ textAlign: 'center', color: '#64748B' }}>
          Memuat portal...
        </div>
      </div>
    );
  }

  // LOGIN SCREEN
  if (!session || !roleConfig) {
    return (
      <div className="login-shell">
        <section className="login-card">
          <div style={{ textAlign: 'center', marginBottom: 22 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/icon-192.png"
              alt="Logo Ini Sanggar"
              style={{
                display: 'block',
                width: 92,
                height: 92,
                borderRadius: 22,
                margin: '0 auto 14px',
                objectFit: 'cover',
                boxShadow: '0 6px 18px rgba(15, 23, 42, 0.1)',
                border: '1px solid rgba(15, 23, 42, 0.06)',
              }}
            />
            <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 4px', color: '#0F172A' }}>
              Ini Sanggar
            </h1>
            <p style={{ fontSize: 13, color: '#64748B', margin: 0 }}>
              Masukkan kode akses bagian untuk masuk
            </p>
          </div>

          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4, color: '#334155' }}>
                Nama Kamu (Opsional)
              </label>
              <input
                className="p-input"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="Contoh: Budi"
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4, color: '#334155' }}>
                Kode Akses
              </label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  className="p-input"
                  type={showCode ? 'text' : 'password'}
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value)}
                  placeholder="Masukkan kode akses"
                  required
                  autoFocus
                />
                <button
                  type="button"
                  className="p-btn p-btn-outline"
                  style={{ padding: '0 12px', fontSize: 12, flexShrink: 0 }}
                  onClick={() => setShowCode((v) => !v)}
                >
                  {showCode ? 'Tutup' : 'Lihat'}
                </button>
              </div>
            </div>

            {loginError && (
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  background: '#FEF2F2',
                  border: '1px solid #FECACA',
                  color: '#B91C1C',
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                {loginError}
              </div>
            )}

            <button
              type="submit"
              className="p-btn p-btn-primary"
              style={{ width: '100%', padding: '12px 16px', fontSize: 15 }}
              disabled={loginBusy}
            >
              {loginBusy ? 'Memeriksa Akses...' : 'Masuk'}
            </button>

            {installPrompt && (
              <button
                type="button"
                className="p-btn p-btn-outline"
                style={{ width: '100%', padding: '10px 16px', fontSize: 14 }}
                onClick={triggerInstall}
              >
                📲 Install Aplikasi ke HP / Desktop
              </button>
            )}
          </form>

          <p style={{ textAlign: 'center', fontSize: 12, color: '#64748B', margin: '16px 0 0' }}>
            Kode akses hanya dapat dilihat melalui bot Telegram (<code style={{ fontWeight: 600 }}>/kodeakses</code>)
          </p>
        </section>
      </div>
    );
  }

  // DYNAMIC THEME PER ROLE
  const themeVars = {
    '--accent': roleConfig.theme.primary,
    '--accent-dark': roleConfig.theme.primaryDark,
    '--accent-soft': roleConfig.theme.primarySoft,
    '--accent-border': roleConfig.theme.border,
    '--bg-page': roleConfig.theme.bgPage,
    '--text-headline': roleConfig.theme.textHeadline,
    '--badge-bg': roleConfig.theme.badgeBg,
    '--badge-text': roleConfig.theme.badgeText,
  } as React.CSSProperties;

  // BUILD SIMPLE MENU ITEMS BASED ON ROLE PERMISSIONS
  const menuItems: { id: MenuTab; label: string; icon: string }[] = [];
  if (roleConfig.permissions.finance) {
    menuItems.push({ id: 'keuangan', label: 'Keuangan', icon: '💰' });
  }
  if (roleConfig.permissions.kas) {
    menuItems.push({ id: 'kas', label: 'Kas Anggota', icon: '🪙' });
  }
  if (roleConfig.permissions.inventaris) {
    menuItems.push({
      id: 'inventaris',
      label: roleConfig.permissions.unitOnly
        ? `Inventaris ${roleConfig.shortLabel}`
        : 'Inventaris',
      icon: '📦',
    });
  }
  if (roleConfig.permissions.surat) {
    menuItems.push({ id: 'surat', label: 'Persuratan', icon: '✉️' });
  }
  menuItems.push({ id: 'chatbot', label: 'Chat Bot', icon: '💬' });

  return (
    <div className="portal-root" style={themeVars}>
      {/* Top Bar */}
      <header className="portal-topbar">
        <div className="portal-topbar-inner">
          <div className="portal-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/icon-192.png"
              alt="Logo Ini Sanggar"
              style={{
                width: 40,
                height: 40,
                borderRadius: 11,
                objectFit: 'cover',
                flexShrink: 0,
                border: '1px solid rgba(15, 23, 42, 0.08)',
              }}
            />
            <div className="portal-brand-text">
              <h1>{roleConfig.label}</h1>
              <p>
                {session.userName} • {roleConfig.subtitle}
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {installPrompt && (
              <button
                type="button"
                className="p-btn p-btn-primary"
                style={{ padding: '8px 12px', fontSize: 13 }}
                onClick={triggerInstall}
              >
                📲 Install
              </button>
            )}
            <button
              type="button"
              className="p-btn p-btn-outline"
              style={{ padding: '8px 14px', fontSize: 13 }}
              onClick={handleLogout}
            >
              Keluar / Ganti Akses
            </button>
          </div>
        </div>
      </header>

      {/* Simple Menu Navigation */}
      <nav className="portal-menu-bar" aria-label="Menu Utama">
        <div className="portal-menu-inner">
          {menuItems.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`portal-menu-btn ${activeTab === m.id ? 'active' : ''}`}
              onClick={() => setActiveTab(m.id)}
            >
              <span>{m.icon}</span>
              <span>{m.label}</span>
            </button>
          ))}
        </div>
      </nav>

      {/* Main Content */}
      <main className="portal-main">
        {activeTab === 'keuangan' && roleConfig.permissions.finance && (
          <FinancePanel
            data={financeData}
            loading={financeLoading}
            selectedBook={selectedBook}
            onSelectBook={setSelectedBook}
            onRefresh={() => loadFinance(selectedBook)}
          />
        )}

        {activeTab === 'kas' && roleConfig.permissions.kas && (
          <KasPanel refreshTrigger={kasRefresh} />
        )}

        {activeTab === 'inventaris' && roleConfig.permissions.inventaris && (
          <InventarisPanel
            unitOnly={roleConfig.permissions.unitOnly}
            refreshTrigger={invRefresh}
          />
        )}

        {activeTab === 'surat' && roleConfig.permissions.surat && (
          <SuratPanel userName={session.userName} refreshTrigger={suratRefresh} />
        )}

        {activeTab === 'chatbot' && (
          <ChatBotPanel
            roleConfig={roleConfig}
            userName={session.userName}
            activeBook={selectedBook}
            onActionTaken={handleChatAction}
          />
        )}
      </main>

      {/* Mobile Bottom Navigation */}
      <nav className="portal-bottom-nav" aria-label="Navigasi Bawah HP">
        {menuItems.map((m) => (
          <button
            key={m.id}
            type="button"
            className={`portal-bottom-btn ${activeTab === m.id ? 'active' : ''}`}
            onClick={() => {
              setActiveTab(m.id);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          >
            <span>{m.icon}</span>
            <span>{m.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
