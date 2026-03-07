import { getUserByToken } from '../services/userService.js';

export async function requireAuth(req, res, next) {
  const token = req.query.token
    || (req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.slice(7)
        : null);

  if (!token) {
    return res.status(401).json({ error: 'Authentication required. Use ?token= or Authorization header.' });
  }

  const user = await getUserByToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Invalid token.' });
  }

  req.user = user;
  next();
}
