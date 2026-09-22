import { google } from 'googleapis';

function formatPrivateKey(rawKey: string): string {
  if (!rawKey) return '';
  let cleaned = rawKey.replace(/^["']|["']$/g, '').trim();
  cleaned = cleaned.replace(/\\n/g, '\n').replace(/\r/g, '');

  const match = cleaned.match(/-----BEGIN [A-Z\s]+-----([^-]+)-----END [A-Z\s]+-----/);
  if (match) {
    const base64Only = match[1].replace(/\s+/g, '');
    const chunked = base64Only.match(/.{1,64}/g)?.join('\n') || base64Only;
    return `-----BEGIN PRIVATE KEY-----\n${chunked}\n-----END PRIVATE KEY-----\n`;
  }
  return cleaned;
}

// Test with corrupted newlines, spaces, multiple slashes
const corrupted = `  "-----BEGIN PRIVATE KEY-----\\n   MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDQCHPbc93ifLst\\nZi+tCReeSHTYRnUSivh4X5Rc0j3tTZ0ZYcHGZXiLNJhd9ifKtb+vlyku47AfrdoT\\nnxSmYN0G2etoPoJUQjcL2ZrbiZkBdDjzizjDZL3DX1iytaamyN0nM27pnsFI3itH\\nIJoKprwqo1ALfav5yeRrw14Ikj1e/xDXmu794pZWEJpzaUPQ01NVr27+HEgNfI6J\\n6ezVYGhDPsyzZLG0oHtf4P1+ynI8KtYmKRjL+BDKHMs6gMKTbgGYZJ81nAsst8jw\\nxvKpUpLEdGG3rulsH4Uur5VHdpV5bVCv49m3EK/miy5iZTvYljKE4g0DfLz6sU18\\n63a6w0JXAgMBAAECggEAWsBNNl9B3NM33lK1GqGcRYbrPgvid3/ba7uaX7GxpStW\\nDKQKIc/TObrsexTuf+4wXFuvcg6Onws61pNvsTMRSLNZD+Uw+qvWEpvPg9TvQ+Sd\\nEZVa4lY4uBmIepFmzVxTqY205UJFpFGTBJjSyjG5ZUpQGWst0i6CMIaOJ2QQVLdb\\ngPp2cHYrj68/Zf9+XbtzeUmYamCufQ6LswdpMRripd3hHjz70dlb0CY+Rqgt2WRO\\n5FN8of/Rff6wDQ4AcCFcUjHgXlMz+UEpGJf7Np/EuylLHlqXGVmHFo8mtRysOaeQ\\nhER6AT8cj+OfV2LmewIw6F9kQTsBgR4cPxsDyLsjqQKBgQD5WQqAsy5kwnaBHVH6\\nhp9OOt9E9poz6kZpYTN4clARZdKmRK0P4bj4Kcq85qz5gTF7VTOvxpouPDJKKc4k\\n3NHmG3V2INHgaYRgr5WwL57YFVu325QoZ+slOXHEXF6Av/GcYFLDv2GHGvbOULOm\\no/YQL9q57E5yfRSMwSOCSNRZXwKBgQDVlT7t37ZGfHqlaCKJ446Kvdk992X9d66S\\n/yniDPMEHZtd0Ygv4smpbIB94OoORYlYzgb05ZMmYXJ61dckECDLDPw/JbnoY4yk\\nnRJ59J0qZPjdOZqT2e4WnLrtnDLPpLThduzzTH6B94xXVqvW/m/TgtKok5XnazXK\\n6sn76AKiCQKBgQDmURfBb0CgM3twoZuSc/z8LqcCtWIUKAan2e/IBpbsqwfbKr5M\\nWCwZlci9mbkWsf35tOaMKz9JC7NMC7dtF0cObDigR4p05iIviKAUYLgxUfEpL7p3\\nZB2wgZITVVq5RBKxZcutIb69I+vrAGIgv3xO0VUQvTRszhpINTJOamUyswKBgHVg\\n1TnDlZf9NyYKKdkf7yl+lpKAkVOQX6e3hZwOw8uCPe18htzSRUPQNnl3jwoS2x2r\\n9JTISmtwaIrrVJYkKvGMjGBj6ly1wQiCrjHJ5knzPfXOf4472aYhsnV9P0twWFwE\\nkMpRQsFIe59QKZY5NNnH7t/oZBzPhbuj9ydy5WeJAoGAZfWHVuwp9YggXcmfSz/7\\nA849EBsrfUbH/QQ8oK2OlkpH/Ri64JzJslWbHIyQJ4XOhu+EQXRKej+pIMbV7TCG\\nkkzKiKh1pbnLPAGCnBIS8CawdKRdfr1jDT11CP8dghszu3HIAOukEE7XySvuV5hq\\nSG4OJqRgwNImnPS57Uu3bIM= \\n-----END PRIVATE KEY-----\\n" `;

const formatted = formatPrivateKey(corrupted);
console.log('Formatted Key:');
console.log(formatted.substring(0, 50));
console.log(formatted.substring(formatted.length - 50));

try {
  const auth = new google.auth.JWT({
    email: 'bot-uang-dkc@catat-keuangan-509403.iam.gserviceaccount.com',
    key: formatted,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  console.log('✅ Success initializing JWT with formatted key!');
} catch (e: any) {
  console.error('❌ Failed:', e.message);
}
