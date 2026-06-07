import { Router } from 'express';
import { processReceipt } from '../receiptProcessor.js';
import { sendMessage, downloadMedia } from '../services/metaWhatsApp.js';
import { formatReceipt, formatSummary, formatReceiptList, formatHelp, formatExpensePrompt, formatManualReceipt, CATEGORIES, PAYMENT_METHODS } from '../utils/formatter.js';
import { getSession, setSession, clearSession } from '../services/conversationState.js';
import { getOrCreateUser } from '../services/userService.js';
import prisma from '../db.js';

const router = Router();

// ── Webhook verification (GET) ─────────────────────────────────────────────

router.get('/', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

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

  console.log('[WhatsApp] Webhook POST received. Body:', JSON.stringify(req.body, null, 2));

  try {
    const entry   = req.body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value   = changes?.value;

    // Ignore status updates
    if (value?.statuses) {
      console.log('[WhatsApp] Ignoring status update');
      return;
    }

    const message = value?.messages?.[0];
    if (!message) {
      console.log('[WhatsApp] No message in payload — value:', JSON.stringify(value));
      return;
    }

    const from = message.from;
    console.log(`[WhatsApp] Message from=${from} type=${message.type}`);

    const user = await getOrCreateUser(from);

    if (message.type === 'image') {
      console.log(`[WhatsApp] Image mediaId=${message.image.id}`);
      await handleReceiptImage(from, message.image.id, user);
    } else if (message.type === 'text') {
      console.log(`[WhatsApp] Text body="${message.text.body}"`);
      await handleTextCommand(from, message.text.body || '', user);
    } else {
      console.log(`[WhatsApp] Unhandled message type: ${message.type}`);
    }
  } catch (err) {
    console.error('[WhatsApp] Webhook handler error:', err);
  }
});

// ── Handlers ───────────────────────────────────────────────────────────────

async function handleReceiptImage(from, mediaId, user) {
  try {
    console.log(`[WhatsApp] handleReceiptImage: sending ack to ${from}`);
    await sendMessage(from, '📸 Got your receipt! Processing...');

    console.log(`[WhatsApp] Downloading media ${mediaId}...`);
    const { buffer, mimeType } = await downloadMedia(mediaId);
    console.log(`[WhatsApp] Downloaded media: ${buffer.length} bytes, mimeType=${mimeType}`);

    const base64 = buffer.toString('base64');

    console.log('[WhatsApp] Starting receipt processing...');
    const receipt = await processReceipt({ base64, mimeType, userId: user.id });
    console.log(`[WhatsApp] Receipt processed: id=${receipt.id} merchant="${receipt.merchant}" total=${receipt.total}`);

    await sendMessage(from, formatReceipt(receipt, user.dashboardToken));
    console.log('[WhatsApp] Receipt reply sent successfully');
  } catch (err) {
    console.error('[WhatsApp] Receipt processing error:', err.message, err.stack);
    let msg;
    switch (err.code) {
      case 'NOT_A_RECEIPT':
        msg = "❌ That doesn't look like a receipt. Please send a clear photo of a receipt.";
        break;
      case 'NO_TOTAL':
        msg = "❌ I couldn't read the total amount on that receipt. Please send a clearer, well-lit photo showing the full receipt.";
        break;
      default:
        msg = '❌ Could not process that receipt. Please try again with a clearer photo.';
    }
    await sendMessage(from, msg).catch(e => console.error('[WhatsApp] Failed to send error reply:', e.message));
  }
}

async function handleTextCommand(from, body, user) {
  const text = body.trim().toLowerCase();

  // Cancel active session
  if (text === 'cancel') {
    if (getSession(from)) {
      clearSession(from);
      await sendMessage(from, '❌ Expense entry cancelled.');
      return;
    }
  }

  // Check for active expense session first
  const session = getSession(from);
  if (session) {
    await handleExpenseStep(from, body.trim(), session, user);
    return;
  }

  // Start expense flow
  if (text === 'expense' || text === 'add' || text === '/expense' || text === '/add') {
    setSession(from, { step: 'amount', data: {} });
    await sendMessage(from, formatExpensePrompt('start'));
  } else if (text === 'summary' || text === '/summary') {
    await handleSummary(from, user);
  } else if (text.startsWith('search ') || text.startsWith('/search ')) {
    const term = text.replace(/^\/?search\s+/, '').trim();
    await handleSearch(from, term, user);
  } else if (text === 'recent' || text === '/recent') {
    await handleRecent(from, user);
  } else if (text === 'dashboard' || text === '/dashboard') {
    const url = process.env.APP_URL || 'https://your-app.onrender.com';
    await sendMessage(from, `🌐 Your dashboard:\n${url}?token=${user.dashboardToken}`);
  } else if (text === 'help' || text === '/help') {
    await sendMessage(from, formatHelp());
  } else {
    await sendMessage(from, formatHelp());
  }
}

// ── Guided expense flow ──────────────────────────────────────────────────

async function handleExpenseStep(from, input, session, user) {
  const { step, data } = session;

  switch (step) {
    case 'amount': {
      const amount = parseFloat(input.replace(/[^0-9.]/g, ''));
      if (isNaN(amount) || amount <= 0) {
        await sendMessage(from, '⚠️ Please enter a valid amount (e.g. 150.50)');
        return;
      }
      data.amount = amount;
      setSession(from, { step: 'category', data });
      await sendMessage(from, formatExpensePrompt('category'));
      break;
    }

    case 'category': {
      let category = null;
      const num = parseInt(input);
      if (num >= 1 && num <= CATEGORIES.length) {
        category = CATEGORIES[num - 1];
      } else {
        const lower = input.toLowerCase();
        category = CATEGORIES.find(c => c === lower);
      }
      if (!category) {
        await sendMessage(from, `⚠️ Please pick a number (1-${CATEGORIES.length}) or type the category name.`);
        return;
      }
      data.category = category;
      setSession(from, { step: 'payment', data });
      await sendMessage(from, formatExpensePrompt('payment'));
      break;
    }

    case 'payment': {
      let payment = null;
      const num = parseInt(input);
      if (num >= 1 && num <= PAYMENT_METHODS.length) {
        payment = PAYMENT_METHODS[num - 1];
      } else {
        const lower = input.toLowerCase();
        payment = PAYMENT_METHODS.find(m => m.toLowerCase() === lower);
      }
      if (!payment) {
        await sendMessage(from, `⚠️ Please pick a number (1-${PAYMENT_METHODS.length}) or type the method.`);
        return;
      }
      data.paymentMethod = payment;
      setSession(from, { step: 'merchant', data });
      await sendMessage(from, formatExpensePrompt('merchant'));
      break;
    }

    case 'merchant': {
      const merchant = input.toLowerCase() === 'skip' ? 'Manual expense' : input;
      data.merchant = merchant;

      // Save to database
      try {
        const receipt = await prisma.receipt.create({
          data: {
            merchant: data.merchant,
            total: data.amount,
            category: data.category,
            paymentMethod: data.paymentMethod,
            currency: 'ZAR',
            date: new Date(),
            userId: user.id,
          },
        });
        clearSession(from);
        await sendMessage(from, formatManualReceipt(receipt));
      } catch (err) {
        console.error('[WhatsApp] Manual expense save error:', err);
        clearSession(from);
        await sendMessage(from, '❌ Failed to save expense. Please try again.');
      }
      break;
    }
  }
}

async function handleSummary(from, user) {
  const now          = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  const receipts = await prisma.receipt.findMany({
    where: { userId: user.id, date: { gte: startOfMonth, lte: endOfMonth } },
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

async function handleSearch(from, term, user) {
  if (!term || term.length < 2) {
    await sendMessage(from, 'Please provide at least 2 characters. Example: search woolworths');
    return;
  }

  const receipts = await prisma.receipt.findMany({
    where: {
      userId: user.id,
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

async function handleRecent(from, user) {
  const receipts = await prisma.receipt.findMany({
    where: { userId: user.id },
    orderBy: { date: 'desc' },
    take: 5,
  });
  await sendMessage(from, formatReceiptList(receipts, '🕐 *Recent Receipts*'));
}

export default router;
