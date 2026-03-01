import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import apiRouter from './routes/api.js';
import whatsappRouter from './routes/whatsapp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createServer() {
  const app = express();

  // Parse JSON for API + Meta webhook
  app.use(express.json());

  // Health check — pinged by UptimeRobot to prevent Render from sleeping
  app.get('/health', (_req, res) => res.json({ status: 'ok', ts: Date.now() }));

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
