import { bot } from '../lib/telegramBot';
import { webhookCallback } from 'grammy';

async function test() {
  const handler = webhookCallback(bot, 'std/http');

  const payload = {
    update_id: 12345678,
    message: {
      message_id: 99,
      from: {
        id: 1009092211,
        is_bot: false,
        first_name: 'User',
      },
      chat: {
        id: 1009092211,
        type: 'private',
      },
      date: Math.floor(Date.now() / 1000),
      text: 'ngambil uang 2jt dari staff',
    },
  };

  const req = new Request('http://localhost:3000/api/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  try {
    console.log('Mengirim update ke webhookCallback lokal...');
    const res = await handler(req);
    console.log('Hasil response status:', res.status);
    console.log('Hasil response body:', await res.text());
  } catch (err: any) {
    console.error('CRASH DI WEBHOOK:', err);
    console.error('STACK:', err.stack);
  }
}

test();
