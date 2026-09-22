import { GoogleGenerativeAI } from '@google/generative-ai';

async function checkModels() {
  const apiKey = process.env.GEMINI_API_KEY!;
  const genAI = new GoogleGenerativeAI(apiKey);
  const models = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-2.0-flash-exp', 'gemini-3.6-flash'];

  for (const m of models) {
    try {
      const model = genAI.getGenerativeModel({ model: m });
      const res = await model.generateContent('ping');
      console.log(`✅ ${m}: OK`);
    } catch (err: any) {
      console.log(`❌ ${m}: ${err.message}`);
    }
  }
}

checkModels();
