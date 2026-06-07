import crypto from 'crypto';

/**
 * Verify Meta's X-Hub-Signature-256 header on incoming webhook POSTs.
 *
 * Meta signs the raw request body with the app secret:
 *   X-Hub-Signature-256: sha256=<HMAC_SHA256(appSecret, rawBody)>
 *
 * Requires req.rawBody (captured via express.json's verify option in server.js).
 * If META_APP_SECRET is not configured, verification is skipped with a warning
 * so local development stays frictionless.
 */
export function verifyWhatsappSignature(req, res, next) {
  const secret = process.env.META_APP_SECRET;
  if (!secret) {
    console.warn('[WhatsApp] META_APP_SECRET not set — skipping signature verification');
    return next();
  }

  const signature = req.get('x-hub-signature-256');
  if (!signature || !req.rawBody) {
    console.warn('[WhatsApp] Missing signature or raw body — rejecting');
    return res.sendStatus(403);
  }

  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(req.rawBody)
    .digest('hex');

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    console.warn('[WhatsApp] Invalid webhook signature — rejecting');
    return res.sendStatus(403);
  }

  next();
}
