import { webhookCallback } from 'grammy';
import { bot } from '@/lib/telegramBot';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Izinkan hingga 60 detik di serverless Vercel agar proses OCR dan Drive upload tidak terputus

export async function POST(req: Request) {
  try {
    return await webhookCallback(bot, 'std/http', {
      timeoutMilliseconds: 55_000,
      onTimeout: 'return',
    })(req);
  } catch (error) {
    console.error('Webhook error:', error);
    return new Response('Error processing webhook', { status: 500 });
  }
}

export async function GET() {
  return new Response('Telegram Bot Webhook is running active.', { status: 200 });
}

