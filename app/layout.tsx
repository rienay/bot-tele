import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Catat Keuangan Telegram Bot Dashboard',
  description: 'Asisten pencatatan keuangan otomatis via Telegram, Google Sheets, Drive, dan Gemini AI',
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
