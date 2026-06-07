import prisma from '../db.js';

/**
 * Normalize a phone number to digits only (Meta sends international format
 * without a leading "+"; admins may type "+", spaces, or dashes).
 */
export function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

/** Look up a user by phone. Does NOT create — registration is admin-gated. */
export async function getUser(phone) {
  return prisma.user.findUnique({ where: { phone: normalizePhone(phone) } });
}

export async function getUserByToken(token) {
  if (!token) return null;
  return prisma.user.findUnique({ where: { dashboardToken: token } });
}

/**
 * Create a pending registration request for an unknown number, capturing the
 * WhatsApp profile name if available. Idempotent — returns the existing user
 * if the number is already known.
 */
export async function registerPending(phone, profileName) {
  const normalized = normalizePhone(phone);
  const existing = await prisma.user.findUnique({ where: { phone: normalized } });
  if (existing) return existing;

  const user = await prisma.user.create({
    data: { phone: normalized, name: profileName || null, status: 'pending' },
  });
  console.log(`[User] New pending request: phone=${normalized} name="${profileName || ''}"`);
  return user;
}

/** Set a user's status, creating the user if it doesn't exist yet. */
export async function setStatus(phone, status, name) {
  const normalized = normalizePhone(phone);
  const data = { status };
  if (name) data.name = name;
  return prisma.user.upsert({
    where:  { phone: normalized },
    update: data,
    create: { phone: normalized, status, name: name || null },
  });
}

export async function setName(phone, name) {
  return prisma.user.update({
    where: { phone: normalizePhone(phone) },
    data:  { name },
  });
}

export async function markWelcomed(phone) {
  return prisma.user.update({
    where: { phone: normalizePhone(phone) },
    data:  { welcomed: true },
  });
}

export async function deleteUser(phone) {
  const normalized = normalizePhone(phone);
  const user = await prisma.user.findUnique({ where: { phone: normalized } });
  if (!user) return null;
  // Receipts reference the user; remove them (and their items cascade) first.
  await prisma.receipt.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { phone: normalized } });
  return user;
}

export async function listUsers() {
  return prisma.user.findMany({ orderBy: [{ status: 'asc' }, { createdAt: 'asc' }] });
}

export function isAdmin(user) {
  return user?.role === 'admin';
}

/**
 * Ensure the ADMIN_PHONE number exists as an active admin. Run at startup.
 */
export async function ensureAdmin() {
  const adminPhone = normalizePhone(process.env.ADMIN_PHONE);
  if (!adminPhone) {
    console.warn('[User] ADMIN_PHONE not set — no admin configured. Set it to manage registrations.');
    return null;
  }
  const admin = await prisma.user.upsert({
    where:  { phone: adminPhone },
    update: { role: 'admin', status: 'active' },
    create: { phone: adminPhone, role: 'admin', status: 'active', name: 'Admin' },
  });
  console.log(`[User] Admin ensured: phone=${adminPhone} id=${admin.id}`);
  return admin;
}

/**
 * Increment today's receipt-processing count for a phone and report whether the
 * daily cap (MAX_RECEIPTS_PER_DAY, default 30) has been exceeded.
 * @returns {{ allowed: boolean, count: number, limit: number }}
 */
export async function checkAndBumpDailyUsage(phone) {
  const normalized = normalizePhone(phone);
  const limit = parseInt(process.env.MAX_RECEIPTS_PER_DAY) || 30;
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)

  const usage = await prisma.usageDaily.upsert({
    where:  { phone_date: { phone: normalized, date } },
    update: { count: { increment: 1 } },
    create: { phone: normalized, date, count: 1 },
  });

  return { allowed: usage.count <= limit, count: usage.count, limit };
}
