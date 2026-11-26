'use client';

import { useState, useRef, useEffect } from 'react';
import { WebRoleConfig } from '@/lib/webAuth';

interface ChatMessage {
  id: string;
  sender: 'bot' | 'user';
  text: string;
  time: string;
  imageName?: string;
}

interface ChatBotPanelProps {
  roleConfig: WebRoleConfig;
  userName: string;
  activeBook?: string;
  onActionTaken?: (action: string) => void;
}

export default function ChatBotPanel({
  roleConfig,
  userName,
  activeBook = 'Kas',
  onActionTaken,
}: ChatBotPanelProps) {
  const getWelcome = () => {
    const { permissions } = roleConfig;
    if (permissions.finance) {
      return `Halo ${userName}! Saya Asisten Keuangan (${roleConfig.label}).\nKetik transaksi langsung seperti "keluar 25rb beli kertas", kirim foto nota, atau klik tombol cepat di bawah.`;
    }
    if (permissions.surat) {
      return `Halo ${userName}! Saya Asisten DKC (${roleConfig.label}).\nTanyakan data inventaris atau arsip surat, atau kirim foto surat untuk dipindai otomatis oleh AI.`;
    }
    return `Halo ${userName}! Saya Asisten ${roleConfig.label}.\nKamu bisa cek barang unit ${permissions.unitOnly}, cari barang, atau catat barang baru lewat chat ini.`;
  };

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      sender: 'bot',
      text: getWelcome(),
      time: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [input, setInput] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const quickChips = (() => {
    const { permissions } = roleConfig;
    if (permissions.finance) {
      return [
        { label: 'Rekap Saldo', cmd: 'rekap' },
        { label: 'Cek Kas Bulan Ini', cmd: 'cekkas' },
        { label: 'Daftar Pos', cmd: 'buku' },
        { label: 'Bantuan', cmd: 'help' },
      ];
    }
    if (permissions.surat) {
      return [
        { label: 'Cek Inventaris', cmd: 'inventaris' },
        { label: 'Ringkasan Surat', cmd: 'surat' },
        { label: 'Bantuan', cmd: 'help' },
      ];
    }
    return [
      { label: `Barang ${permissions.unitOnly}`, cmd: 'inventaris' },
      { label: 'Format Tambah Barang', cmd: 'tambah barang ' },
      { label: 'Bantuan', cmd: 'help' },
    ];
  })();

  const sendMessage = async (textOverride?: string) => {
    const msgText = (textOverride ?? input).trim();
    if (!msgText && !file) return;
    if (sending) return;

    const nowTime = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      sender: 'user',
      text: msgText || '(Mengirim berkas/foto)',
      time: nowTime,
      imageName: file?.name,
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!textOverride) setInput('');
    const currentFile = file;
    setFile(null);
    if (fileRef.current) fileRef.current.value = '';
    setSending(true);

    try {
      let res: Response;
      if (currentFile) {
        const fd = new FormData();
        fd.append('message', msgText);
        fd.append('role', roleConfig.key);
        fd.append('book', activeBook === 'Semua' ? 'Kas' : activeBook);
        fd.append('userName', userName);
        fd.append('file', currentFile);
        res = await fetch('/api/chat', { method: 'POST', body: fd });
      } else {
        res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: msgText,
            role: roleConfig.key,
            book: activeBook === 'Semua' ? 'Kas' : activeBook,
            userName,
          }),
        });
      }

      const json = await res.json();
      const botMsg: ChatMessage = {
        id: `b-${Date.now()}`,
        sender: 'bot',
        text: json.reply || 'Maaf, tidak ada respons.',
        time: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, botMsg]);

      if (json.actionTaken && onActionTaken) {
        onActionTaken(json.actionTaken);
      }
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          sender: 'bot',
          text: `Gagal terhubung: ${err?.message || 'Coba lagi nanti.'}`,
          time: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="chat-container">
      <div className="chat-header">
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Chat Bot — {roleConfig.label}</div>
          <div style={{ fontSize: 12, opacity: 0.88 }}>
            Akses langsung tanpa perlu aplikasi Telegram
          </div>
        </div>
        <span className="p-badge" style={{ background: 'rgba(255,255,255,0.2)', color: '#fff' }}>
          Online
        </span>
      </div>

      <div className="chat-messages">
        {messages.map((m) => (
          <div key={m.id} className={`chat-bubble ${m.sender}`}>
            {m.imageName && (
              <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 4, fontWeight: 600 }}>
                📎 {m.imageName}
              </div>
            )}
            <div>{m.text}</div>
            <div
              style={{
                fontSize: 11,
                opacity: 0.65,
                marginTop: 4,
                textAlign: m.sender === 'user' ? 'right' : 'left',
              }}
            >
              {m.time}
            </div>
          </div>
        ))}
        {sending && (
          <div className="chat-bubble bot" style={{ opacity: 0.75 }}>
            Sedang memproses...
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="chat-chips">
        {quickChips.map((chip) => (
          <button
            key={chip.label}
            type="button"
            className="chat-chip"
            onClick={() => {
              if (chip.cmd.endsWith(' ')) {
                setInput(chip.cmd);
              } else {
                sendMessage(chip.cmd);
              }
            }}
          >
            {chip.label}
          </button>
        ))}
      </div>

      {file && (
        <div
          style={{
            padding: '6px 14px',
            background: '#F1F5F9',
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>📎 Lampiran: <strong>{file.name}</strong></span>
          <button
            type="button"
            onClick={() => {
              setFile(null);
              if (fileRef.current) fileRef.current.value = '';
            }}
            style={{ background: 'none', border: 'none', color: '#DC2626', cursor: 'pointer', fontWeight: 600 }}
          >
            Hapus
          </button>
        </div>
      )}

      <form
        className="chat-input-bar"
        onSubmit={(e) => {
          e.preventDefault();
          sendMessage();
        }}
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/*,.pdf"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) setFile(f);
          }}
        />
        <button
          type="button"
          className="p-btn p-btn-outline"
          style={{ padding: '10px 12px', flexShrink: 0 }}
          onClick={() => fileRef.current?.click()}
          title="Lampirkan foto nota / surat / barang"
        >
          📎
        </button>
        <input
          className="p-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            roleConfig.permissions.finance
              ? 'Ketik transaksi (cth: keluar 25rb beli snack) atau perintah...'
              : 'Ketik perintah (cth: inventaris, cari ..., help)...'
          }
          disabled={sending}
        />
        <button
          type="submit"
          className="p-btn p-btn-primary"
          style={{ flexShrink: 0 }}
          disabled={sending || (!input.trim() && !file)}
        >
          Kirim
        </button>
      </form>
    </div>
  );
}
