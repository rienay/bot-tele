async function run() {
  const url = 'https://script.google.com/macros/s/AKfycbxjWNRI8DY-TxAXcqB9qTqxABwQKTRdE_3_RZr4DcxNf_heCjMuHpWxqP2yQxkrDQK7wQ/exec';
  const folderId = '10j-beutj6pgjFFrrvWM3PgQ7LR0wVLl-';
  console.log('Testing GAS upload to folder:', folderId);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folderId,
        fileName: 'test-from-bot.txt',
        mimeType: 'text/plain',
        base64: Buffer.from('Testing upload from bot to Drive').toString('base64'),
      }),
      redirect: 'follow',
    });
    console.log('HTTP Status:', res.status, res.statusText);
    const text = await res.text();
    console.log('Response body:', text);
  } catch (err: any) {
    console.error('Fetch error:', err);
  }
}

run();
