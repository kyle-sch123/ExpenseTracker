import 'dotenv/config';
import { createServer } from './server.js';
import { ensureAdmin } from './services/userService.js';
import prisma from './db.js';

async function main() {
  const app  = createServer();
  const port = parseInt(process.env.PORT) || 3000;

  // Seed the admin account from ADMIN_PHONE (non-fatal if it fails)
  await ensureAdmin().catch(err => console.error('[System] ensureAdmin failed:', err.message));

  const server = app.listen(port, () => {
    console.log(`[Server] Running on port ${port}`);
    console.log(`[Server] Dashboard: ${process.env.APP_URL || `http://localhost:${port}`}`);
    console.log(`[Server] Webhook:   ${process.env.APP_URL || `http://localhost:${port}`}/webhook`);
  });

  async function shutdown(signal) {
    console.log(`\n[System] ${signal} — shutting down...`);
    await prisma.$disconnect();
    server.close(() => process.exit(0));
  }

  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('uncaughtException',   err    => console.error('[System] Uncaught exception:', err));
  process.on('unhandledRejection',  reason => console.error('[System] Unhandled rejection:', reason));
}

main().catch(err => {
  console.error('[System] Fatal startup error:', err);
  process.exit(1);
});
