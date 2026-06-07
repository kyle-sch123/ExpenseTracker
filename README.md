# Receipt Tracker

A WhatsApp receipt-tracking bot with OCR and a personal spending dashboard. Snap a photo of a receipt, send it to the bot, and it extracts the merchant, line items, totals, and category automatically — then makes everything browsable on a per-user web dashboard.

Built entirely on free, cloud-hosted services.

---

## Features

- 📸 **Photo → structured data** — send a receipt image and Google Gemini extracts merchant, address, date, line items, subtotal/tax/tip, total, payment method, and a spending category.
- 💬 **WhatsApp commands** — query your spending without leaving the chat (`summary`, `recent`, `search`, etc.).
- 💸 **Manual expenses** — add expenses with no receipt via a guided WhatsApp flow or directly on the dashboard.
- 📊 **Web dashboard** — monthly stats, a category donut chart, a 6-month trend chart, and a full searchable/filterable/editable receipt list.
- 👥 **Multi-user, admin-gated** — an admin approves/invites numbers; each approved user gets a one-time onboarding message and their own private dashboard, accessed by a unique token.

---

## Architecture

A single Express app serves three things: the WhatsApp webhook, the REST API, and the static dashboard.

```
WhatsApp user
     │  (image or text)
     ▼
Meta WhatsApp Cloud API ──webhook──► Express (src/server.js)
                                         │
              ┌──────────────────────────┼───────────────────────────┐
              ▼                          ▼                            ▼
   /webhook (whatsapp.js)        /api/* (api.js)            static dashboard/
   - verify + receive            - token-authenticated      - index.html (stats/charts)
   - image → pipeline            - summary / receipts CRUD   - receipts.html (list/edit)
   - text → commands             - categories
              │
              ▼
   receiptProcessor.js  ──► Gemini (extract)  +  Supabase Storage (image upload)
              │
              ▼
   Prisma ──► Supabase Postgres (User → Receipt → ReceiptItem)
```

### Receipt pipeline (`src/receiptProcessor.js`)

1. Image upload to Supabase Storage and Gemini extraction are started together.
2. Gemini returns JSON; required fields are validated (a missing/invalid total aborts with a descriptive error).
3. Missing optional fields fall back to sensible defaults (merchant → `Unknown Merchant`, category → `other`, date → today).
4. The receipt and its line items are written to Postgres in a single nested create.

### Tech stack (all free tier)

| Concern          | Service / library                                              |
|------------------|---------------------------------------------------------------|
| Messaging        | Meta WhatsApp Cloud API (webhook-based)                       |
| OCR / extraction | Google Gemini 2.5 Flash (`@google/generative-ai`)            |
| Database         | Supabase PostgreSQL via Prisma                                |
| Image storage    | Supabase Storage (public `receipts` bucket)                  |
| Backend hosting  | Render.com (kept awake by an UptimeRobot ping to `/health`)  |
| Dashboard        | Static HTML/CSS/JS + Chart.js, served by the same Express app |

---

## Project structure

```
src/
  index.js                 Entry point — boots Express, wires graceful shutdown
  server.js                Express app: webhook + API routes + static dashboard
  db.js                    Prisma client singleton
  receiptProcessor.js      Pipeline: base64 → Gemini → Supabase → DB
  middleware/
    auth.js                requireAuth — resolves ?token= or Bearer to a user
  routes/
    whatsapp.js            Webhook (GET verify, POST receive) + command handlers
    api.js                 REST API for the dashboard (all routes token-gated)
  services/
    gemini.js              Gemini extraction with retry + rate-limit handling
    metaWhatsApp.js        Meta API: sendMessage(), downloadMedia()
    storage.js             Supabase Storage: saveImage(), deleteImage()
    supabase.js            Supabase client singleton
    userService.js         getOrCreateUser(), getUserByToken()
    conversationState.js   In-memory sessions for the guided expense flow
  utils/
    formatter.js           WhatsApp reply formatting (ZAR currency)
dashboard/
  index.html               Stats, charts, recent receipts
  receipts.html            Full list with filters, edit, delete, add-expense
  js/auth.js               Token capture (sessionStorage) + authFetch wrapper
  js/app.js                Dashboard page logic
  js/receipts.js           Receipts page logic
  js/charts.js             Chart.js wrappers (donut + trend)
  css/style.css            Dark theme
prisma/schema.prisma       User, Receipt, ReceiptItem models
render.yaml                Render deployment config
```

---

## Data model (`prisma/schema.prisma`)

- **User** — `phone` (unique), optional `name`, and a unique `dashboardToken` (uuid) used for dashboard access.
- **Receipt** — merchant, address, date/time, subtotal/tax/tip/total, payment method, currency (default `ZAR`), category, optional `imageUrl`, raw extraction JSON. Belongs to a User.
- **ReceiptItem** — name, quantity, unit price, total. Belongs to a Receipt (cascade delete).

---

## WhatsApp commands

Message the bot number with any of:

| Command           | Action                                          |
|-------------------|-------------------------------------------------|
| *(send a photo)*  | Extract and save a receipt                       |
| `summary`         | This month's spending, broken down by category   |
| `recent`          | Your last 5 receipts                             |
| `search <term>`   | Find receipts by merchant or item name           |
| `expense` / `add` | Start the guided manual-expense flow             |
| `dashboard`       | Get your personal dashboard link                 |
| `help`            | Show the command list                            |
| `cancel`          | Abort an in-progress expense entry               |

The guided expense flow asks for amount → category → payment method → merchant (or `skip`), then saves the expense. Sessions are persisted in the database (so an in-progress entry survives a server restart) and expire after 5 minutes of inactivity.

---

## Access control & registration

The bot is **private and admin-gated** — not anyone who messages it can use it.

- The **admin** is the number in the `ADMIN_PHONE` env var, seeded automatically on startup.
- When an **unknown number** messages the bot, it is recorded as `pending`, the sender is told to wait for approval, and the **admin is notified** with a one-tap `approve` command.
- Only users with status `active` can track receipts or use any command.

### Admin commands

Send these from the admin's WhatsApp number:

| Command                    | Action                                            |
|----------------------------|---------------------------------------------------|
| `approve <number> [name]`  | Approve a pending user (optionally set their name) |
| `invite <number> [name]`   | Pre-approve a number before they ever message      |
| `block <number>`           | Block a user                                       |
| `remove <number>`          | Delete a user and all their data                   |
| `users`                    | List all users and their status                    |
| `adminhelp`                | Show the admin command list                        |

Numbers can be typed in any format (e.g. `+27 82 123 4567`). The admin also has every normal user command.

### Onboarding

The first time an approved user messages the bot, they receive a **one-time welcome** explaining how it works (send a photo → automatic extraction; the command list; their private dashboard link) **and the current limitations** — one clear photo at a time (no PDFs/albums), blurry/handwritten receipts may misread, amounts default to ZAR, a daily receipt limit applies, the dashboard link is personal, and it's a tracking aid rather than an accounting/tax tool.

> ⚠️ **Meta delivery limit:** While your Meta app is in development/test mode, the WhatsApp Cloud API only delivers messages to **up to 5 manually-added recipient numbers**. To onboard more people you must **publish the app with business verification and an approved display name** (still free). This is a Meta dashboard step, not something the bot can do for you.

---

## Dashboard access & authentication

The dashboard is private per user. Send `dashboard` to the bot to receive a link of the form:

```
https://your-app.onrender.com?token=<your-dashboardToken>
```

On first load, `dashboard/js/auth.js` saves the token to `sessionStorage`, strips it from the URL bar (so it isn't shared accidentally), and attaches it as a `Bearer` token on every API request. All `/api/*` routes require a valid token and only ever return that user's data.

---

## Local development

### Prerequisites

- Node.js 18+ (uses the global `fetch`)
- A Supabase project, a Google Gemini API key, and a Meta WhatsApp app

### Setup

```bash
npm install
```

Create a `.env` file from the template (see [Environment variables](#environment-variables)):

```bash
cp .env.example .env   # then fill in your values
npm run db:init        # first time only — create and apply Prisma migrations
npm start              # start the server on PORT (default 3000)
```

> Set `ADMIN_PHONE` before first start so your number is seeded as the admin.

To expose your local server to Meta's webhook during development, tunnel it (e.g. with `ngrok http 3000`) and point the Meta webhook at the tunnel URL.

### Scripts

| Script              | Purpose                                              |
|---------------------|------------------------------------------------------|
| `npm start`         | Start the Express server                             |
| `npm run db:init`   | Create the initial Prisma migration (first time)     |
| `npm run db:deploy` | Apply pending migrations (used in the Render build)   |
| `npm run db:reset`  | Drop and recreate the database (destructive)          |
| `npm run db:studio` | Browse the database in Prisma Studio                  |
| `npm run build`     | `prisma generate` + `prisma migrate deploy`           |

---

## Environment variables

| Variable               | Description                                                                       |
|------------------------|----------------------------------------------------------------------------------|
| `APP_URL`              | Public base URL (e.g. `https://receipt-tracker-xyz.onrender.com`)                |
| `PORT`                 | Port to listen on (default `3000`)                                               |
| `GEMINI_API_KEY`       | Google Gemini API key (aistudio.google.com)                                      |
| `SUPABASE_URL`         | Supabase project URL                                                             |
| `SUPABASE_SERVICE_KEY` | Supabase service-role key                                                        |
| `DATABASE_URL`         | PostgreSQL connection string — prefer the Supabase **pooled** URL (port 6543, `?pgbouncer=true`) |
| `WHATSAPP_TOKEN`       | Meta app permanent access token                                                  |
| `WHATSAPP_PHONE_ID`    | Meta WhatsApp phone number ID                                                    |
| `VERIFY_TOKEN`         | Arbitrary string used to verify the webhook with Meta                            |
| `META_APP_SECRET`      | Meta app secret — used to verify webhook `X-Hub-Signature-256` (optional locally) |
| `ADMIN_PHONE`          | Admin's WhatsApp number — seeded as the active admin on startup                  |
| `MAX_RECEIPTS_PER_DAY` | Per-user daily receipt-processing cap (default `30`)                             |

---

## Deployment (Render + Supabase + Meta)

1. **Supabase** — create a project, create a **public** storage bucket named `receipts`, then copy the connection string (prefer the **pooled** URL, port 6543) and the service-role key.
2. **Meta** — create an app, add the WhatsApp product, and obtain a permanent access token, the phone number ID, and the **app secret** (`META_APP_SECRET`, App → Settings → Basic).
3. **Render** — deploy from GitHub using `render.yaml`. Set all environment variables in the dashboard (Settings → Environment), including `ADMIN_PHONE` and `META_APP_SECRET`. The build runs `npm install && npm run build`, applying migrations.
4. **Webhook** — in the Meta dashboard, set the callback URL to `https://your-app.onrender.com/webhook` and the verify token to your `VERIFY_TOKEN`, then subscribe to message events.
5. **Keep-alive** — Render's free tier sleeps after inactivity. Add an UptimeRobot monitor that pings `https://your-app.onrender.com/health` every ~5 minutes.
6. **Go live (to onboard >5 people)** — complete Meta business verification and get a display name approved so the app can message arbitrary numbers (see the note in [Access control & registration](#access-control--registration)).

---

## API reference

All endpoints require authentication via `?token=<dashboardToken>` or an `Authorization: Bearer <token>` header, and are scoped to the authenticated user.

| Method   | Endpoint              | Description                                                        |
|----------|-----------------------|-------------------------------------------------------------------|
| `GET`    | `/health`             | Liveness check (no auth) — used by UptimeRobot                     |
| `GET`    | `/webhook`            | Meta webhook verification (no auth)                               |
| `POST`   | `/webhook`            | Receive WhatsApp messages (verified via `X-Hub-Signature-256` HMAC) |
| `GET`    | `/api/summary`        | Totals, category breakdown, 6-month trend, recent receipts        |
| `GET`    | `/api/receipts`       | Paginated list (`page`, `limit`, `category`, `search`, `sort`)     |
| `POST`   | `/api/receipts`       | Create a manual expense (`merchant`, `total`, `category`, …)       |
| `GET`    | `/api/receipts/:id`   | Single receipt with items                                          |
| `PUT`    | `/api/receipts/:id`   | Update a receipt                                                   |
| `DELETE` | `/api/receipts/:id`   | Delete a receipt (also removes its stored image)                  |
| `GET`    | `/api/categories`     | Per-category counts and totals                                    |

---

## Notes

- **Currency:** defaults to ZAR (South African Rand), displayed as `R`, with `en-ZA` date formatting.
- **Image storage:** `Receipt.imageUrl` holds a Supabase public URL; image upload failures are non-fatal (the receipt is still saved).
- **Lightweight:** no headless browser or `whatsapp-web.js` — just the Meta Cloud API over HTTP.
- **Robustness:** incoming webhooks are deduplicated (Meta retries won't create duplicate receipts), conversation state lives in the DB (survives restarts), and the webhook signature is verified.

---

## Scaling beyond free

This project is built to run comfortably for a small group (≈ <20 users) entirely on free tiers. The known free-tier ceilings and how to lift them when you outgrow them:

| Bottleneck                                   | Free-tier limit                  | Upgrade path                                                                 |
|----------------------------------------------|----------------------------------|------------------------------------------------------------------------------|
| Gemini extraction quota                      | 250 requests/day (shared key)    | Move to a paid Gemini key, or rotate multiple keys. `MAX_RECEIPTS_PER_DAY` throttles per user in the meantime. |
| Render instance sleeps / single instance     | Sleeps after ~15 min idle        | Upgrade to a paid Render instance (no sleep, more RAM); UptimeRobot only masks sleep. |
| Supabase connections                         | Limited direct connections       | Point `DATABASE_URL` at the Supabase **connection pooler** (port 6543, `?pgbouncer=true`). |
| Burst load on the webhook                     | Processed inline in-process      | Introduce a job queue/worker (e.g. BullMQ + Redis) so extraction runs async. |

The current architecture keeps all of these as **configuration/add-on changes**, not rewrites.
