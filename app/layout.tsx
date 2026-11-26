import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Ini Sanggar',
  description: 'Aplikasi web terpadu keuangan, inventaris, persuratan, dan asisten chat bot sesuai akses bagian.',
  icons: { apple: '/apple-touch-icon.png' },
  appleWebApp: {
    capable: true,
    title: 'Ini Sanggar',
    statusBarStyle: 'default',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
  themeColor: '#1D4ED8',
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
