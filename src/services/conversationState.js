// Durable session tracking for multi-step WhatsApp conversations.
// Backed by the Session table so in-progress flows survive restarts and the
// free-tier instance sleeping. Same interface as before, but now async.

import prisma from '../db.js';

const SESSION_TIMEOUT = 5 * 60 * 1000; // 5 minutes

export async function getSession(phone) {
  const row = await prisma.session.findUnique({ where: { phone } });
  if (!row) return null;

  // Expire stale sessions (mirrors the old 5-minute timeout).
  if (Date.now() - new Date(row.updatedAt).getTime() > SESSION_TIMEOUT) {
    await prisma.session.delete({ where: { phone } }).catch(() => {});
    return null;
  }

  return { step: row.step, data: row.data };
}

export async function setSession(phone, { step, data }) {
  await prisma.session.upsert({
    where:  { phone },
    update: { step, data },
    create: { phone, step, data },
  });
}

export async function clearSession(phone) {
  await prisma.session.delete({ where: { phone } }).catch(() => {});
}
