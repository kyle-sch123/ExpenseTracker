import { Router } from 'express';
import { processReceipt } from '../receiptProcessor.js';
import { sendMessage, downloadMedia } from '../services/metaWhatsApp.js';
import {
  formatReceipt, formatSummary, formatReceiptList, formatHelp,
  formatExpensePrompt, formatManualReceipt, formatWelcome,
  formatNotAuthorized, formatAdminHelp, formatUserList,
  CATEGORIES, PAYMENT_METHODS,
} from '../utils/formatter.js';
import { getSession, setSession, clearSession } from '../services/conversationState.js';
import {
  getUser, registerPending, setStatus, deleteUser, listUsers,
  markWelcomed, isAdmin, normalizePhone, checkAndBumpDailyUsage,
} from '../services/userService.js';
import { verifyWhatsappSignature } from '../middleware/whatsappSignature.js';
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

router.post('/', verifyWhatsappSignature, async (req, res) => {
  // Acknowledge immediately — Meta requires a 200 within 20s
  res.sendStatus(200);

  try {
    const entry   = req.body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value   = changes?.value;

    // Ignore status updates
    if (value?.statuses) return;

    const message = value?.messages?.[0];
    if (!message) {
      console.log('[WhatsApp] No message in payload — value:', JSON.stringify(value));
      return;
    }

    // ── Deduplication: Meta retries deliveries; process each message once ──
    if (message.id) {
      try {
        await prisma.processedMessage.create({ data: { id: message.id } });
      } catch (err) {
        if (err.code === 'P2002') {
          console.log(`[WhatsApp] Duplicate delivery ${message.id} — skipping`);
          return;
        }
        console.warn('[WhatsApp] Dedup check failed (continuing):', err.message);
      }
    }

    const from        = message.from;
    const profileName = value?.contacts?.[0]?.profile?.name;
    console.log(`[WhatsApp] Message from=${from} type=${message.type}`);

    const user = await getUser(from);

    // ── Registration gate ──────────────────────────────────────────────────
    if (!user || user.status !== 'active') {
      if (!user) {
        await registerPending(from, profileName);
        await notifyAdmin(from, profileName);
      }
      await sendMessage(from, formatNotAuthorized());
      return;
    }

    // ── One-time onboarding message ────────────────────────────────────────
    if (!user.welcomed) {
      await sendMessage(from, formatWelcome(user));
      await markWelcomed(from);
    }

    // ── Admin commands ─────────────────────────────────────────────────────
    if (isAdmin(user) && message.type === 'text') {
      const handled = await handleAdminCommand(from, message.text.body || '');
      if (handled) return;
    }

    // ── Normal handling ────────────────────────────────────────────────────
    if (message.type === 'image') {
      await handleReceiptImage(from, message.image.id);
    } else if (message.type === 'text') {
      await handleTextCommand(from, message.text.body || '', user);
    } else {
      console.log(`[WhatsApp] Unhandled message type: ${message.type}`);
    }
  } catch (err) {
    console.error('[WhatsApp] Webhook handler error:', err);
  }
});

// ── Admin ──────────────────────────────────────────────────────────────────

async function notifyAdmin(from, profileName) {
  const adminPhone = normalizePhone(process.env.ADMIN_PHONE);
  if (!adminPhone || adminPhone === normalizePhone(from)) return;
  const name = profileName ? `${profileName} ` : '';
  await sendMessage(
    adminPhone,
    `👤 *New access request*\n${name}+${from}\n\nReply *approve ${from}* to grant access.`
  ).catch(e => console.error('[WhatsApp] Failed to notify admin:', e.message));
}

/**
 * Handle an admin command. Returns true if the text was an admin command
 * (and was handled), false if it should fall through to normal commands.
 */
async function handleAdminCommand(from, body) {
  const parts = body.trim().split(/\s+/);
  const verb  = parts[0]?.toLowerCase();
  const arg   = parts[1];
  const name  = parts.slice(2).join(' ') || undefined;

  switch (verb) {
    case 'approve': {
      if (!arg) { await sendMessage(from, 'Usage: approve <number> [name]'); return true; }
      const target = normalizePhone(arg);
      await setStatus(target, 'active', name);
      await sendMessage(from, `✅ Approved +${target}. They'll be welcomed when they next message.`);
      // Best-effort heads-up (only works inside the 24h window)
      await sendMessage(target, '✅ You have been approved! Message me to get started.').catch(() => {});
      return true;
    }
    case 'invite': {
      if (!arg) { await sendMessage(from, 'Usage: invite <number> [name]'); return true; }
      const target = normalizePhone(arg);
      await setStatus(target, 'active', name);
      await sendMessage(from, `✉️ Invited +${target}. They'll be welcomed when they first message me.`);
      return true;
    }
    case 'block': {
      if (!arg) { await sendMessage(from, 'Usage: block <number>'); return true; }
      const target = normalizePhone(arg);
      await setStatus(target, 'blocked');
      await sendMessage(from, `🚫 Blocked +${target}.`);
      return true;
    }
    case 'remove': {
      if (!arg) { await sendMessage(from, 'Usage: remove <number>'); return true; }
      const target  = normalizePhone(arg);
      const deleted = await deleteUser(target);
      await sendMessage(from, deleted ? `🗑️ Removed +${target} and their data.` : `No user found for +${target}.`);
      return true;
    }
    case 'users': {
      const users = await listUsers();
      await sendMessage(from, formatUserList(users));
      return true;
    }
    case 'adminhelp': {
      await sendMessage(from, formatAdminHelp());
      return true;
    }
    default:
      return false;
  }
}

// ── Handlers ───────────────────────────────────────────────────────────────

async function handleReceiptImage(from, mediaId) {
  try {
    // Per-user daily cap — protects the shared Gemini free quota
    const usage = await checkAndBumpDailyUsage(from);
    if (!usage.allowed) {
      await sendMessage(from, `📷 You've hit today's limit of ${usage.limit} receipts. Please try again tomorrow.`);
      return;
    }

    await sendMessage(from, '📸 Got your receipt! Processing...');

    const { buffer, mimeType } = await downloadMedia(mediaId);
    const base64 = buffer.toString('base64');

    const user    = await getUser(from);
    const receipt = await processReceipt({ base64, mimeType, userId: user.id });
    console.log(`[WhatsApp] Receipt processed: id=${receipt.id} merchant="${receipt.merchant}" total=${receipt.total}`);

    await sendMessage(from, formatReceipt(receipt, user.dashboardToken));
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
      case 'QUOTA_EXCEEDED':
        msg = "⏳ I'm a bit busy right now (daily processing quota reached). Please try again later.";
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
    if (await getSession(from)) {
      await clearSession(from);
      await sendMessage(from, '❌ Expense entry cancelled.');
      return;
    }
  }

  // Check for active expense session first
  const session = await getSession(from);
  if (session) {
    await handleExpenseStep(from, body.trim(), session, user);
    return;
  }

  // Start expense flow
  if (text === 'expense' || text === 'add' || text === '/expense' || text === '/add') {
    await setSession(from, { step: 'amount', data: {} });
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
      await setSession(from, { step: 'category', data });
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
      await setSession(from, { step: 'payment', data });
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
      await setSession(from, { step: 'merchant', data });
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
        await clearSession(from);
        await sendMessage(from, formatManualReceipt(receipt));
      } catch (err) {
        console.error('[WhatsApp] Manual expense save error:', err);
        await clearSession(from);
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
