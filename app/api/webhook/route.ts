import { webhookCallback } from 'grammy';
import { bot } from '@/lib/telegramBot';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    return await webhookCallback(bot, 'std/http')(req);
  } catch (error) {
    console.error('Webhook error:', error);
    return new Response('Error processing webhook', { status: 500 });
  }
}

export async function GET() {
  return new Response('Telegram Bot Webhook is running active.', { status: 200 });
}
