import { Router } from 'express';
import { processReceipt } from '../receiptProcessor.js';
import { sendMessage, downloadMedia } from '../services/metaWhatsApp.js';
import { formatReceipt, formatSummary, formatReceiptList, formatHelp } from '../utils/formatter.js';
import prisma from '../db.js';

const router = Router();

// ── Webhook verification (GET) ─────────────────────────────────────────────

router.get('/', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log(`[WhatsApp] Verify check — received: "${token}" | expected: "${process.env.VERIFY_TOKEN}"`);

  if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
    console.log('[WhatsApp] Webhook verified');
    return res.status(200).send(challenge);
  }

  console.warn('[WhatsApp] Webhook verification failed');
  res.sendStatus(403);
});

// ── Receive messages (POST) ────────────────────────────────────────────────

router.post('/', async (req, res) => {
  // Acknowledge immediately — Meta requires a 200 within 20s
  res.sendStatus(200);

  try {
    const entry   = req.body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value   = changes?.value;

    // Ignore status updates
    if (value?.statuses) return;

    const message = value?.messages?.[0];
    if (!message) return;

    const from = message.from; // sender's phone number

    if (message.type === 'image') {
      await handleReceiptImage(from, message.image.id);
    } else if (message.type === 'text') {
      await handleTextCommand(from, message.text.body || '');
    }
  } catch (err) {
    console.error('[WhatsApp] Webhook handler error:', err);
  }
});

// ── Handlers ───────────────────────────────────────────────────────────────

async function handleReceiptImage(from, mediaId) {
  try {
    await sendMessage(from, '📸 Got your receipt! Processing...');

    const { buffer, mimeType } = await downloadMedia(mediaId);
    const base64 = buffer.toString('base64');

    const receipt = await processReceipt({ base64, mimeType });

    await sendMessage(from, formatReceipt(receipt));
  } catch (err) {
    console.error('[WhatsApp] Receipt processing error:', err);
    const msg = err.message?.includes('not a receipt')
      ? "❌ That doesn't look like a receipt. Please send a clear photo of a receipt."
      : '❌ Could not process that receipt. Please try again with a clearer photo.';
    await sendMessage(from, msg).catch(() => {});
  }
}

async function handleTextCommand(from, body) {
  const text = body.trim().toLowerCase();

  if (text === 'summary' || text === '/summary') {
    await handleSummary(from);
  } else if (text.startsWith('search ') || text.startsWith('/search ')) {
    const term = text.replace(/^\/?search\s+/, '').trim();
    await handleSearch(from, term);
  } else if (text === 'recent' || text === '/recent') {
    await handleRecent(from);
  } else if (text === 'dashboard' || text === '/dashboard') {
    const url = process.env.APP_URL || 'https://your-app.onrender.com';
    await sendMessage(from, `🌐 Your dashboard:\n${url}`);
  } else {
    await sendMessage(from, formatHelp());
  }
}

async function handleSummary(from) {
  const now          = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  const receipts = await prisma.receipt.findMany({
    where: { date: { gte: startOfMonth, lte: endOfMonth } },
  });

  const totalSpent  = receipts.reduce((s, r) => s + r.total, 0);
  const byCategory  = receipts.reduce((acc, r) => {
    acc[r.category] = (acc[r.category] || 0) + r.total;
    return acc;
  }, {});

  await sendMessage(from, formatSummary({
    totalSpent,
    receiptCount: receipts.length,
    byCategory,
    month: now.getMonth() + 1,
    year:  now.getFullYear(),
  }));
}

async function handleSearch(from, term) {
  if (!term || term.length < 2) {
    await sendMessage(from, 'Please provide at least 2 characters. Example: search woolworths');
    return;
  }

  const receipts = await prisma.receipt.findMany({
    where: {
      OR: [
        { merchant: { contains: term, mode: 'insensitive' } },
        { items: { some: { name: { contains: term, mode: 'insensitive' } } } },
      ],
    },
    orderBy: { date: 'desc' },
    take: 5,
  });

  await sendMessage(from, formatReceiptList(receipts, `🔍 Results for "${term}"`));
}

async function handleRecent(from) {
  const receipts = await prisma.receipt.findMany({
    orderBy: { date: 'desc' },
    take: 5,
  });
  await sendMessage(from, formatReceiptList(receipts, '🕐 *Recent Receipts*'));
}

export default router;
