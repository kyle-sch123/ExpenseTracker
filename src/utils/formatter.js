function currencySymbol(currency) {
  if (!currency) return 'R ';
  const map = { ZAR: 'R ', USD: '$', EUR: '€', GBP: '£', AUD: 'A$' };
  return map[currency.toUpperCase()] || currency + ' ';
}

/**
 * Format a saved receipt into a WhatsApp reply message.
 */
export function formatReceipt(receipt, dashboardToken) {
  const date = new Date(receipt.date).toLocaleDateString('en-ZA', {
    month: 'short', day: 'numeric', year: 'numeric',
  });

  const sym   = currencySymbol(receipt.currency);
  const total = sym + Number(receipt.total).toFixed(2);
  const category = receipt.category
    ? receipt.category.charAt(0).toUpperCase() + receipt.category.slice(1)
    : 'Other';

  const itemCount = receipt.items?.length || 0;

  return `✅ *Receipt saved!*

🏪 *${receipt.merchant}*
💰 Total: ${total}
📅 Date: ${date}
🏷️ Category: ${category}
📦 Items: ${itemCount} detected

View dashboard: ${process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`}${dashboardToken ? `?token=${dashboardToken}` : ''}`;
}

/**
 * Format a monthly spending summary.
 */
export function formatSummary(data) {
  const { totalSpent, receiptCount, byCategory, month, year } = data;

  const monthName = new Date(year, month - 1).toLocaleString('en-US', { month: 'long' });

  const categoryLines = Object.entries(byCategory)
    .sort(([, a], [, b]) => b - a)
    .map(([cat, amount]) => {
      const label = cat.charAt(0).toUpperCase() + cat.slice(1);
      return `  ${getCategoryEmoji(cat)} ${label}: R ${Number(amount).toFixed(2)}`;
    })
    .join('\n');

  return `📊 *${monthName} ${year} Summary*

💵 Total spent: R ${Number(totalSpent).toFixed(2)}
🧾 Receipts: ${receiptCount}
📈 Average: R ${receiptCount > 0 ? (totalSpent / receiptCount).toFixed(2) : '0.00'}

*By category:*
${categoryLines || '  No data yet'}

View details: ${process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`}`;
}

/**
 * Format a list of receipts for search/recent results.
 */
export function formatReceiptList(receipts, title) {
  if (receipts.length === 0) {
    return `${title}\n\nNo receipts found.`;
  }

  const lines = receipts.map((r, i) => {
    const date = new Date(r.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${i + 1}. *${r.merchant}* — R ${Number(r.total).toFixed(2)} (${date})`;
  });

  return `${title}\n\n${lines.join('\n')}`;
}

/**
 * Help text for the bot.
 */
export function formatHelp() {
  return `📋 *Receipt Tracker Commands*

📸 *Send a photo* — Track a receipt
📊 *summary* — This month's spending
🕐 *recent* — Last 5 receipts
🔍 *search [store]* — Find receipts by store
💸 *expense* — Manually add an expense
🌐 *dashboard* — Get the dashboard link
❓ *help* — Show this message`;
}

const CATEGORIES = [
  'groceries', 'dining', 'shopping', 'gas',
  'pharmacy', 'entertainment', 'utilities', 'other',
];

const PAYMENT_METHODS = ['Cash', 'Card', 'Online', 'EFT'];

/**
 * Prompt messages for the guided expense flow.
 */
export function formatExpensePrompt(step) {
  switch (step) {
    case 'start':
      return `💸 *Add Manual Expense*\n\n💰 What's the amount? (e.g. 150.50)`;
    case 'category':
      return `🏷️ What category?\n${CATEGORIES.map((c, i) => `${i + 1}. ${c.charAt(0).toUpperCase() + c.slice(1)}`).join('\n')}`;
    case 'payment':
      return `💳 Payment method?\n${PAYMENT_METHODS.map((m, i) => `${i + 1}. ${m}`).join('\n')}`;
    case 'merchant':
      return `🏪 Merchant or description? (or "skip")`;
    default:
      return '';
  }
}

/**
 * Format a manually saved expense into a WhatsApp confirmation.
 */
export function formatManualReceipt(receipt) {
  const date = new Date(receipt.date).toLocaleDateString('en-ZA', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
  const total = 'R ' + Number(receipt.total).toFixed(2);
  const category = receipt.category
    ? receipt.category.charAt(0).toUpperCase() + receipt.category.slice(1)
    : 'Other';
  const payment = receipt.paymentMethod || '—';

  return `✅ *Expense saved!*

🏪 *${receipt.merchant}*
💰 Total: ${total}
📅 Date: ${date}
🏷️ Category: ${category}
💳 Payment: ${payment}`;
}

function dashboardUrl(token) {
  const base = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
  return token ? `${base}?token=${token}` : base;
}

/**
 * One-time onboarding message: explains how the bot works AND its hard limits.
 */
export function formatWelcome(user) {
  const name = user?.name ? ` ${user.name}` : '';
  const dailyLimit = parseInt(process.env.MAX_RECEIPTS_PER_DAY) || 30;

  return `👋 *Welcome${name}! You're all set.*

I'm your personal receipt & expense tracker.

*How it works*
📸 Send a *photo of a receipt* and I'll automatically read the merchant, items, and total, then save it for you.
💸 No receipt? Type *expense* to add one manually.

*Commands*
📊 *summary* — this month's spending
🕐 *recent* — your last 5 receipts
🔍 *search [store]* — find receipts
🌐 *dashboard* — your private web dashboard
❓ *help* — show commands
✋ *cancel* — stop adding an expense

🌐 *Your private dashboard:*
${dashboardUrl(user?.dashboardToken)}

*Please note (current limits)*
• One *clear photo* at a time — no PDFs, multi-page docs, or photo albums.
• Works best on clear, well-lit, single-currency receipts. Blurry or handwritten ones may fail or be misread — always double-check and edit on the dashboard.
• Amounts default to *ZAR (R)*; other currencies only if printed on the receipt.
• Up to *${dailyLimit} receipts per day* (shared free quota).
• Your data is *private to your number* — your dashboard link is personal, don't share it.
• This is a tracking aid, *not* an accounting or tax tool — verify before relying on totals.

Send a receipt photo to get started! 📸`;
}

/**
 * Message for numbers that aren't approved yet.
 */
export function formatNotAuthorized() {
  return `⏳ *You're not registered yet.*

This is a private receipt tracker. Please ask the admin to approve your number, then message me again.`;
}

/**
 * Admin command reference.
 */
export function formatAdminHelp() {
  return `🛠️ *Admin Commands*

✅ *approve <number> [name]* — approve a pending user
✉️ *invite <number> [name]* — pre-approve a number
🚫 *block <number>* — block a user
🗑️ *remove <number>* — delete a user and their data
👥 *users* — list all users
❓ *adminhelp* — show this message

_Numbers can be in any format, e.g. +27 82 123 4567._
You also have all normal user commands.`;
}

/**
 * Format the user list for the admin.
 */
export function formatUserList(users) {
  if (!users.length) return '👥 No users yet.';

  const icon = { active: '✅', pending: '⏳', blocked: '🚫' };
  const lines = users.map(u => {
    const tag  = u.role === 'admin' ? ' (admin)' : '';
    const name = u.name ? ` ${u.name}` : '';
    return `${icon[u.status] || '•'} +${u.phone}${name}${tag}`;
  });

  return `👥 *Users (${users.length})*\n\n${lines.join('\n')}`;
}

export { CATEGORIES, PAYMENT_METHODS };

function getCategoryEmoji(category) {
  const emojis = {
    groceries: '🛒',
    dining: '🍽️',
    shopping: '🛍️',
    gas: '⛽',
    pharmacy: '💊',
    entertainment: '🎬',
    utilities: '💡',
    other: '📦',
  };
  return emojis[category] || '📦';
}
