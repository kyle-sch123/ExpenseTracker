# WhatsApp Receipt Bot — Full Architecture Guide

## Overview

A WhatsApp bot that receives receipt images, extracts data using OCR/AI, stores structured records in a database, and displays everything in a beautiful web dashboard.

---

## System Architecture

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────┐
│   WhatsApp   │────▶│  Backend Server   │────▶│   Database   │
│   (User)     │◀────│  (Node/Python)    │◀────│  (PostgreSQL)│
└──────────────┘     └────────┬─────────┘     └──────────────┘
                              │
                     ┌────────┴─────────┐
                     │  OCR / AI Engine  │
                     │ (Claude Vision /  │
                     │  Google Vision)   │
                     └──────────────────┘
                              │
                     ┌────────┴─────────┐
                     │   Web Dashboard   │
                     │  (React / Next.js)│
                     └──────────────────┘
```

---

## Tech Stack (Recommended)

| Layer              | Technology                          |
|--------------------|-------------------------------------|
| WhatsApp API       | Twilio WhatsApp API or Meta Cloud API |
| Backend            | Node.js (Express/Fastify) or Python (FastAPI) |
| OCR / AI           | Claude Vision API (recommended) or Google Cloud Vision |
| Database           | PostgreSQL + Prisma ORM (or Supabase) |
| File Storage       | AWS S3 / Cloudflare R2 / Supabase Storage |
| Dashboard          | Next.js + Tailwind + Recharts       |
| Auth               | NextAuth.js or Clerk                |
| Hosting            | Vercel (frontend) + Railway/Render (backend) |

---

## Step-by-Step Implementation

### 1. WhatsApp Integration

#### Option A: Twilio WhatsApp Sandbox (easiest to start)

```bash
npm install twilio express multer axios
```

```javascript
// server.js
import express from 'express';
import twilio from 'twilio';
import { processReceipt } from './receiptProcessor.js';

const app = express();
app.use(express.urlencoded({ extended: true }));

// Twilio webhook endpoint
app.post('/api/whatsapp/webhook', async (req, res) => {
  const { Body, From, NumMedia, MediaUrl0, MediaContentType0 } = req.body;
  const twiml = new twilio.twiml.MessagingResponse();

  if (NumMedia > 0 && MediaContentType0?.startsWith('image/')) {
    twiml.message('📸 Got your receipt! Processing...');
    
    // Process asynchronously
    processReceipt({
      imageUrl: MediaUrl0,
      userId: From,
      contentType: MediaContentType0,
    }).then(result => {
      // Send follow-up message with extracted data
      const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
      client.messages.create({
        from: 'whatsapp:+14155238886',
        to: From,
        body: `✅ Receipt saved!\n\n🏪 ${result.merchant}\n💰 Total: $${result.total}\n📅 Date: ${result.date}\n📦 ${result.items.length} items detected`,
      });
    });
  } else {
    twiml.message('👋 Send me a photo of your receipt and I\'ll track it for you!');
  }

  res.type('text/xml').send(twiml.toString());
});

app.listen(3000);
```

#### Option B: Meta Cloud API (production)

```javascript
// meta-webhook.js
import express from 'express';
import axios from 'axios';

const app = express();
app.use(express.json());

// Verify webhook
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Receive messages
app.post('/webhook', async (req, res) => {
  const { entry } = req.body;
  
  for (const change of entry?.[0]?.changes || []) {
    const message = change.value?.messages?.[0];
    if (!message) continue;

    if (message.type === 'image') {
      const mediaId = message.image.id;
      
      // Download image from Meta
      const mediaUrl = await getMediaUrl(mediaId);
      const imageBuffer = await downloadMedia(mediaUrl);
      
      // Process with AI
      const result = await processReceipt({ imageBuffer, userId: message.from });
      
      // Reply
      await sendWhatsAppMessage(message.from, formatReceiptSummary(result));
    }
  }
  
  res.sendStatus(200);
});

async function getMediaUrl(mediaId) {
  const res = await axios.get(`https://graph.facebook.com/v18.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` },
  });
  return res.data.url;
}

async function downloadMedia(url) {
  const res = await axios.get(url, {
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` },
    responseType: 'arraybuffer',
  });
  return Buffer.from(res.data);
}
```

---

### 2. Receipt Processing with Claude Vision API

```javascript
// receiptProcessor.js
import Anthropic from '@anthropic-ai/sdk';
import { prisma } from './db.js';

const anthropic = new Anthropic();

export async function processReceipt({ imageBuffer, imageUrl, userId }) {
  // Get image as base64
  let base64Image;
  if (imageBuffer) {
    base64Image = imageBuffer.toString('base64');
  } else if (imageUrl) {
    const res = await fetch(imageUrl);
    const buffer = await res.arrayBuffer();
    base64Image = Buffer.from(buffer).toString('base64');
  }

  // Call Claude Vision
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 2000,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/jpeg',
              data: base64Image,
            },
          },
          {
            type: 'text',
            text: `Extract all data from this receipt. Return ONLY valid JSON:
{
  "merchant": "store name",
  "merchant_address": "address if visible",
  "date": "YYYY-MM-DD",
  "time": "HH:MM",
  "items": [
    { "name": "item name", "quantity": 1, "unit_price": 0.00, "total": 0.00 }
  ],
  "subtotal": 0.00,
  "tax": 0.00,
  "tip": 0.00,
  "total": 0.00,
  "payment_method": "cash/card/etc",
  "currency": "USD",
  "category": "groceries|dining|shopping|gas|pharmacy|entertainment|utilities|other"
}`,
          },
        ],
      },
    ],
  });

  const extracted = JSON.parse(response.content[0].text);

  // Save to database
  const receipt = await prisma.receipt.create({
    data: {
      userId,
      merchant: extracted.merchant,
      merchantAddress: extracted.merchant_address,
      date: new Date(extracted.date),
      time: extracted.time,
      subtotal: extracted.subtotal,
      tax: extracted.tax,
      tip: extracted.tip || 0,
      total: extracted.total,
      paymentMethod: extracted.payment_method,
      currency: extracted.currency,
      category: extracted.category,
      rawJson: extracted,
      items: {
        create: extracted.items.map(item => ({
          name: item.name,
          quantity: item.quantity,
          unitPrice: item.unit_price,
          total: item.total,
        })),
      },
    },
    include: { items: true },
  });

  return receipt;
}
```

---

### 3. Database Schema (Prisma)

```prisma
// prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id          String    @id @default(cuid())
  phone       String    @unique
  name        String?
  email       String?   @unique
  createdAt   DateTime  @default(now())
  receipts    Receipt[]
  budgets     Budget[]
}

model Receipt {
  id              String    @id @default(cuid())
  userId          String
  user            User      @relation(fields: [userId], references: [id])
  merchant        String
  merchantAddress String?
  date            DateTime
  time            String?
  subtotal        Float?
  tax             Float?
  tip             Float?
  total           Float
  paymentMethod   String?
  currency        String    @default("USD")
  category        String
  imageUrl        String?
  rawJson         Json?
  createdAt       DateTime  @default(now())
  items           ReceiptItem[]

  @@index([userId, date])
  @@index([category])
}

model ReceiptItem {
  id        String  @id @default(cuid())
  receiptId String
  receipt   Receipt @relation(fields: [receiptId], references: [id], onDelete: Cascade)
  name      String
  quantity  Int     @default(1)
  unitPrice Float
  total     Float
}

model Budget {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  category  String
  amount    Float
  month     Int
  year      Int
  createdAt DateTime @default(now())

  @@unique([userId, category, month, year])
}
```

---

### 4. Dashboard API Routes

```javascript
// routes/dashboard.js
import { Router } from 'express';
import { prisma } from '../db.js';

const router = Router();

// Get spending summary
router.get('/api/summary', async (req, res) => {
  const { userId, startDate, endDate } = req.query;

  const receipts = await prisma.receipt.findMany({
    where: {
      userId,
      date: {
        gte: new Date(startDate),
        lte: new Date(endDate),
      },
    },
    include: { items: true },
    orderBy: { date: 'desc' },
  });

  const totalSpent = receipts.reduce((sum, r) => sum + r.total, 0);

  const byCategory = receipts.reduce((acc, r) => {
    acc[r.category] = (acc[r.category] || 0) + r.total;
    return acc;
  }, {});

  const byMonth = receipts.reduce((acc, r) => {
    const key = `${r.date.getFullYear()}-${String(r.date.getMonth() + 1).padStart(2, '0')}`;
    acc[key] = (acc[key] || 0) + r.total;
    return acc;
  }, {});

  res.json({
    totalSpent,
    receiptCount: receipts.length,
    byCategory,
    byMonth,
    recentReceipts: receipts.slice(0, 10),
  });
});

// Get all receipts with pagination
router.get('/api/receipts', async (req, res) => {
  const { userId, page = 1, limit = 20, category, sortBy = 'date' } = req.query;

  const where = { userId };
  if (category) where.category = category;

  const [receipts, count] = await Promise.all([
    prisma.receipt.findMany({
      where,
      include: { items: true },
      orderBy: { [sortBy]: 'desc' },
      skip: (page - 1) * limit,
      take: Number(limit),
    }),
    prisma.receipt.count({ where }),
  ]);

  res.json({ receipts, total: count, pages: Math.ceil(count / limit) });
});

export default router;
```

---

### 5. Environment Variables

```env
# .env
DATABASE_URL="postgresql://user:pass@localhost:5432/receipts"
ANTHROPIC_API_KEY="sk-ant-..."

# Twilio (Option A)
TWILIO_SID="AC..."
TWILIO_TOKEN="..."
TWILIO_WHATSAPP_NUMBER="whatsapp:+14155238886"

# Meta Cloud API (Option B)
WHATSAPP_TOKEN="..."
WHATSAPP_PHONE_ID="..."
VERIFY_TOKEN="your-verify-token"

# Storage
AWS_S3_BUCKET="receipt-images"
AWS_REGION="us-east-1"
```

---

### 6. Project Structure

```
receipt-bot/
├── prisma/
│   └── schema.prisma
├── src/
│   ├── server.js              # Express app entry
│   ├── db.js                  # Prisma client
│   ├── receiptProcessor.js    # Claude Vision processing
│   ├── routes/
│   │   ├── whatsapp.js        # WhatsApp webhook
│   │   └── dashboard.js       # Dashboard API
│   └── utils/
│       ├── storage.js         # S3 image upload
│       └── formatter.js       # WhatsApp message formatting
├── dashboard/                 # Next.js frontend
│   ├── app/
│   │   ├── page.tsx           # Dashboard home
│   │   ├── receipts/
│   │   │   └── page.tsx       # Receipt list
│   │   └── api/               # API routes (if using Next.js)
│   ├── components/
│   │   ├── SpendingChart.tsx
│   │   ├── CategoryBreakdown.tsx
│   │   ├── ReceiptCard.tsx
│   │   └── RecentActivity.tsx
│   └── package.json
├── package.json
├── .env
└── README.md
```

---

## Deployment Checklist

- [ ] Set up PostgreSQL (Supabase / Neon / Railway)
- [ ] Deploy backend (Railway / Render / Fly.io)
- [ ] Deploy dashboard (Vercel)
- [ ] Configure Twilio/Meta WhatsApp webhook URL
- [ ] Set up S3 bucket for receipt images
- [ ] Add error handling & retry logic
- [ ] Add rate limiting
- [ ] Set up monitoring (Sentry)

---

## WhatsApp Bot Conversation Flow

```
User sends image → Bot: "📸 Processing your receipt..."
                 → Bot: "✅ Receipt saved!
                         🏪 Whole Foods Market
                         💰 Total: $87.43
                         📅 Feb 28, 2026
                         📦 12 items
                         🏷️ Category: Groceries
                         
                         View dashboard: https://your-app.com"

User sends "summary" → Bot: "📊 This month's spending:
                              Groceries: $342.18
                              Dining: $156.90
                              Shopping: $89.50
                              Total: $588.58"

User sends "help" → Bot: "📋 Commands:
                          📸 Send a receipt photo to track it
                          📊 'summary' - Monthly spending
                          🔍 'search [store]' - Find receipts
                          🌐 'dashboard' - Get dashboard link"
```
