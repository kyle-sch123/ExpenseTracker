import { GoogleGenerativeAI } from '@google/generative-ai';

let genAI;

function getClient() {
  if (!genAI) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is not set in .env');
    }
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }
  return genAI;
}

const EXTRACTION_PROMPT = `You are a receipt data extraction assistant. Analyze this receipt image and extract all data.

Return ONLY valid JSON with this exact structure (no markdown, no code fences, just raw JSON):
{
  "merchant": "store or restaurant name",
  "merchant_address": "address if visible, or null",
  "date": "YYYY-MM-DD format, or null if not found",
  "time": "HH:MM format, or null",
  "items": [
    { "name": "item description", "quantity": 1, "unit_price": 0.00, "total": 0.00 }
  ],
  "subtotal": 0.00,
  "tax": 0.00,
  "tip": 0.00,
  "total": 0.00,
  "payment_method": "cash/credit/debit/etc or null",
  "currency": "USD",
  "category": "one of: groceries|dining|shopping|gas|pharmacy|entertainment|utilities|other"
}

Rules:
- All monetary values must be numbers (not strings)
- If a field is not visible on the receipt, use null
- For items, include every line item you can read
- Choose the most appropriate category based on the merchant type
- If this is not a receipt, return {"error": "not_a_receipt"}`;

/**
 * Extract structured receipt data from an image using Gemini 2.5 Flash.
 * @param {string} base64Image - base64-encoded image data
 * @param {string} mimeType - e.g. 'image/jpeg'
 * @returns {Object} parsed receipt data
 */
export async function extractReceiptData(base64Image, mimeType) {
  const client = getClient();
  const model = client.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const imagePart = {
    inlineData: {
      data: base64Image,
      mimeType: mimeType || 'image/jpeg',
    },
  };

  let lastError;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      console.log(`[Gemini] Attempt ${attempt}: calling generateContent, imageSize=${base64Image.length} chars`);
      const result = await model.generateContent([EXTRACTION_PROMPT, imagePart]);
      const text = result.response.text().trim();
      console.log(`[Gemini] Raw response (first 300 chars): ${text.slice(0, 300)}`);

      // Strip markdown code fences if present
      const cleaned = text
        .replace(/^```(?:json)?\n?/i, '')
        .replace(/\n?```$/i, '')
        .trim();

      const parsed = JSON.parse(cleaned);
      console.log(`[Gemini] Parsed OK: merchant="${parsed.merchant}" total=${parsed.total} category=${parsed.category}`);

      if (parsed.error === 'not_a_receipt') {
        throw new Error('Image does not appear to be a receipt');
      }

      return parsed;
    } catch (err) {
      lastError = err;

      // Don't retry on "not a receipt" or parse errors from attempt 2
      if (err.message.includes('not a receipt')) throw err;

      // Rate limit — wait briefly before retry
      if (err.status === 429 || err.message?.includes('429')) {
        console.warn('[Gemini] Rate limited, waiting 5s before retry...');
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }

      // Only retry once on other errors
      if (attempt === 2) break;

      console.warn(`[Gemini] Attempt ${attempt} failed: ${err.message}. Retrying...`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  throw lastError;
}
