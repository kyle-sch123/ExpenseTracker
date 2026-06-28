import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import apiRouter from './routes/api.js';
import whatsappRouter from './routes/whatsapp.js';
import prisma from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createServer() {
  const app = express();

  // Parse JSON for API + Meta webhook. Capture the raw body so the webhook
  // route can verify Meta's X-Hub-Signature-256 HMAC.
  app.use(express.json({
    verify: (req, _res, buf) => { req.rawBody = buf; },
  }));

  // Health check — pinged by UptimeRobot to prevent Render from sleeping.
  // Also writes a sentinel row to the DB on each ping so the (free-tier
  // Supabase) database stays active and isn't paused for inactivity.
  app.get('/health', async (_req, res) => {
    const ts = Date.now();
    let db = 'ok';
    try {
      await prisma.session.upsert({
        where: { phone: '__healthcheck__' },
        update: { step: 'healthcheck', data: { ts } },
        create: { phone: '__healthcheck__', step: 'healthcheck', data: { ts } },
      });
    } catch (err) {
      db = 'error';
      console.error('[health] DB keepalive write failed:', err.message);
    }
    res.json({ status: 'ok', db, ts });
  });

  // Meta WhatsApp Cloud API webhook
  app.use('/webhook', whatsappRouter);

  // REST API for dashboard
  app.use('/api', apiRouter);

  // Serve dashboard static files
  const dashboardDir = path.resolve(__dirname, '../dashboard');
  app.use(express.static(dashboardDir));

  // SPA fallback
  app.get('*', (_req, res) => {
    res.sendFile(path.join(dashboardDir, 'index.html'));
  });

  return app;
}
