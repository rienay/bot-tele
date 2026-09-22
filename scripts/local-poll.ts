import { bot } from '../lib/telegramBot';

console.log('🚀 Menjalankan bot Telegram dalam mode Local Polling...');
console.log('Tekan Ctrl+C untuk menghentikan.');

bot.start({
  onStart: (botInfo) => {
    console.log(`✅ Bot aktif sebagai @${botInfo.username} (${botInfo.first_name})`);
    console.log('Silakan buka Telegram dan kirim pesan atau foto nota ke bot Anda!');
  },
});
