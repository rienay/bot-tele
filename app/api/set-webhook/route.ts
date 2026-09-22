import { bot } from '@/lib/telegramBot';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    // Tentukan public URL dari host request atau environment variable
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || url.host;
    const protocol = req.headers.get('x-forwarded-proto') || (url.protocol.replace(':', '') || 'https');
    const webhookUrl = `${protocol}://${host}/api/webhook`;

    await bot.api.setWebhook(webhookUrl);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Webhook Telegram berhasil diset!',
        webhookUrl,
      }),
      {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error?.message || 'Gagal mengatur webhook',
      }),
      {
        headers: { 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
}
