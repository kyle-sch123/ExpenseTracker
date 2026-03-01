import { extractReceiptData } from './services/gemini.js';
import { saveImage } from './services/storage.js';
import prisma from './db.js';

/**
 * Full receipt processing pipeline.
 *
 * @param {Object} params
 * @param {string} params.base64   - base64 image data
 * @param {string} params.mimeType - image MIME type (e.g. 'image/jpeg')
 * @returns {Object} the created Receipt record (with items)
 */
export async function processReceipt({ base64, mimeType }) {
  const imageMime = mimeType || 'image/jpeg';

  // Upload image to Supabase Storage (async, non-blocking for processing)
  const imageUploadPromise = saveImage(base64, imageMime).catch(err => {
    console.warn('[Processor] Image upload failed (non-fatal):', err.message);
    return null;
  });

  // Extract receipt data via Gemini (runs in parallel with upload)
  const extracted = await extractReceiptData(base64, imageMime);

  // Validate required fields
  if (!extracted.merchant) extracted.merchant = 'Unknown Merchant';
  if (!extracted.total || isNaN(Number(extracted.total))) {
    throw new Error('Could not extract a valid total from this receipt');
  }
  if (!extracted.category) extracted.category = 'other';

  // Parse date — fall back to today
  let receiptDate;
  try {
    receiptDate = extracted.date ? new Date(extracted.date) : new Date();
    if (isNaN(receiptDate.getTime())) receiptDate = new Date();
  } catch {
    receiptDate = new Date();
  }

  // Wait for image upload to complete
  const imageUrl = await imageUploadPromise;

  // Save to database
  const receipt = await prisma.receipt.create({
    data: {
      merchant:        extracted.merchant,
      merchantAddress: extracted.merchant_address || null,
      date:            receiptDate,
      time:            extracted.time || null,
      subtotal:        extracted.subtotal  != null ? Number(extracted.subtotal)  : null,
      tax:             extracted.tax       != null ? Number(extracted.tax)       : null,
      tip:             extracted.tip       != null ? Number(extracted.tip)       : null,
      total:           Number(extracted.total),
      paymentMethod:   extracted.payment_method || null,
      currency:        extracted.currency || 'ZAR',
      category:        extracted.category,
      imageUrl:        imageUrl || null,
      rawJson:         JSON.stringify(extracted),
      items: {
        create: (extracted.items || []).map(item => ({
          name:      item.name       || 'Unknown item',
          quantity:  Number(item.quantity)   || 1,
          unitPrice: Number(item.unit_price) || 0,
          total:     Number(item.total)      || 0,
        })),
      },
    },
    include: { items: true },
  });

  return receipt;
}
