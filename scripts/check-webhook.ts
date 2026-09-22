import { bot } from '../lib/telegramBot';

async function checkWebhook() {
  const info = await bot.api.getWebhookInfo();
  console.log('📡 Status Webhook Telegram saat ini:');
  console.log('URL:', info.url || '(Belum ada webhook - masih mode polling)');
  console.log('Pending updates count:', info.pending_update_count);
  console.log('Last error message:', info.last_error_message || 'Tidak ada error');
}

checkWebhook();
