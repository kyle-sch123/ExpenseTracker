import { Router } from 'express';
import { deleteImage } from '../services/storage.js';
import prisma from '../db.js';

const router = Router();

// GET /api/summary?period=month|year&month=&year=
router.get('/summary', async (req, res) => {
  try {
    const now = new Date();
    const period = req.query.period || 'month';
    const month = parseInt(req.query.month) || now.getMonth() + 1;
    const year = parseInt(req.query.year) || now.getFullYear();

    let startDate, endDate;

    if (period === 'year') {
      startDate = new Date(year, 0, 1);
      endDate = new Date(year, 11, 31, 23, 59, 59);
    } else {
      startDate = new Date(year, month - 1, 1);
      endDate = new Date(year, month, 0, 23, 59, 59);
    }

    const receipts = await prisma.receipt.findMany({
      where: { date: { gte: startDate, lte: endDate } },
      include: { items: true },
      orderBy: { date: 'desc' },
    });

    const totalSpent = receipts.reduce((sum, r) => sum + r.total, 0);

    const byCategory = receipts.reduce((acc, r) => {
      acc[r.category] = (acc[r.category] || 0) + r.total;
      return acc;
    }, {});

    const byMonth = receipts.reduce((acc, r) => {
      const d = new Date(r.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      acc[key] = (acc[key] || 0) + r.total;
      return acc;
    }, {});

    // Last 6 months for trend chart
    const monthlyTrend = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthlyTrend.push({ month: key, amount: byMonth[key] || 0 });
    }

    res.json({
      totalSpent,
      receiptCount: receipts.length,
      averagePerReceipt: receipts.length > 0 ? totalSpent / receipts.length : 0,
      byCategory,
      byMonth,
      monthlyTrend,
      recentReceipts: receipts.slice(0, 5),
      period,
      month,
      year,
    });
  } catch (err) {
    console.error('[API] /summary error:', err);
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

// POST /api/receipts — Manual expense entry from dashboard
router.post('/receipts', async (req, res) => {
  try {
    const { merchant, total, category, paymentMethod, date } = req.body;

    if (!merchant || !total || !category) {
      return res.status(400).json({ error: 'merchant, total, and category are required' });
    }

    const receipt = await prisma.receipt.create({
      data: {
        merchant,
        total: Number(total),
        category,
        paymentMethod: paymentMethod || null,
        currency: 'ZAR',
        date: date ? new Date(date) : new Date(),
      },
    });

    res.status(201).json(receipt);
  } catch (err) {
    console.error('[API] POST /receipts error:', err);
    res.status(500).json({ error: 'Failed to create receipt' });
  }
});

// GET /api/receipts?page=1&limit=20&category=&search=&sort=date
router.get('/receipts', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const { category, search, sort = 'date' } = req.query;

    const where = {};
    if (category) where.category = category;
    if (search) {
      where.OR = [
        { merchant: { contains: search } },
        { items: { some: { name: { contains: search } } } },
      ];
    }

    const validSorts = { date: 'date', total: 'total', merchant: 'merchant', createdAt: 'createdAt' };
    const orderBy = { [validSorts[sort] || 'date']: 'desc' };

    const [receipts, total] = await Promise.all([
      prisma.receipt.findMany({
        where,
        include: { items: true },
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.receipt.count({ where }),
    ]);

    res.json({ receipts, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('[API] /receipts error:', err);
    res.status(500).json({ error: 'Failed to fetch receipts' });
  }
});

// GET /api/receipts/:id
router.get('/receipts/:id', async (req, res) => {
  try {
    const receipt = await prisma.receipt.findUnique({
      where: { id: req.params.id },
      include: { items: true },
    });
    if (!receipt) return res.status(404).json({ error: 'Receipt not found' });
    res.json(receipt);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch receipt' });
  }
});

// PUT /api/receipts/:id
router.put('/receipts/:id', async (req, res) => {
  try {
    const { merchant, total, date, category, paymentMethod, tax, tip } = req.body;
    const data = {};
    if (merchant !== undefined) data.merchant = merchant;
    if (total !== undefined) data.total = Number(total);
    if (date !== undefined) data.date = new Date(date);
    if (category !== undefined) data.category = category;
    if (paymentMethod !== undefined) data.paymentMethod = paymentMethod;
    if (tax !== undefined) data.tax = Number(tax);
    if (tip !== undefined) data.tip = Number(tip);

    const receipt = await prisma.receipt.update({
      where: { id: req.params.id },
      data,
      include: { items: true },
    });
    res.json(receipt);
  } catch (err) {
    console.error('[API] PUT /receipts error:', err);
    res.status(500).json({ error: 'Failed to update receipt' });
  }
});

// DELETE /api/receipts/:id
router.delete('/receipts/:id', async (req, res) => {
  try {
    const receipt = await prisma.receipt.findUnique({ where: { id: req.params.id } });
    if (!receipt) return res.status(404).json({ error: 'Receipt not found' });

    // Delete associated image from Supabase Storage
    if (receipt.imageUrl) await deleteImage(receipt.imageUrl);

    await prisma.receipt.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    console.error('[API] DELETE /receipts error:', err);
    res.status(500).json({ error: 'Failed to delete receipt' });
  }
});

// GET /api/categories
router.get('/categories', async (req, res) => {
  try {
    const receipts = await prisma.receipt.findMany({
      select: { category: true, total: true },
    });

    const categories = receipts.reduce((acc, r) => {
      if (!acc[r.category]) acc[r.category] = { count: 0, total: 0 };
      acc[r.category].count++;
      acc[r.category].total += r.total;
      return acc;
    }, {});

    res.json(categories);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

export default router;
