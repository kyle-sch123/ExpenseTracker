function currencySymbol(currency) {
  if (!currency) return 'R ';
  const map = { ZAR: 'R ', USD: '$', EUR: '€', GBP: '£', AUD: 'A$' };
  return map[currency.toUpperCase()] || currency + ' ';
}

/**
 * Format a saved receipt into a WhatsApp reply message.
 */
export function formatReceipt(receipt) {
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

View dashboard: http://localhost:${process.env.PORT || 3000}`;
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

View details: http://localhost:${process.env.PORT || 3000}`;
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
🌐 *dashboard* — Get the dashboard link
❓ *help* — Show this message`;
}

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
