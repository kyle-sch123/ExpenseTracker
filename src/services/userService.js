import prisma from '../db.js';

export async function getOrCreateUser(phone) {
  let user = await prisma.user.findUnique({ where: { phone } });
  if (!user) {
    user = await prisma.user.create({ data: { phone } });
    console.log(`[User] Auto-registered new user: phone=${phone} id=${user.id}`);
  }
  return user;
}

export async function getUserByToken(token) {
  if (!token) return null;
  return prisma.user.findUnique({ where: { dashboardToken: token } });
}
