import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '🌸 Dashboard Keuangan DKC - Transparan & Realtime',
  description: 'Portal akses catatan keuangan terbuka: pantau saldo kas, pemasukan, pengeluaran, dan bukti struk nota kegiatan DKC.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
