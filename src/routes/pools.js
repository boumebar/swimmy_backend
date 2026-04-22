const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const authMiddleware = require('../middleware/auth');

const prisma = new PrismaClient();

// CREATE POOL
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { title, description, photos, address, latitude, longitude, capacity, pricePerHour, pricePerDay, pricePerWeek } = req.body;

    // Validation
    if (!title || !description || !address || !capacity || !pricePerDay) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Create pool
    const pool = await prisma.pool.create({
      data: {
        title,
        description,
        photos: photos || [],
        address,
        latitude: latitude || 0,
        longitude: longitude || 0,
        capacity,
        pricePerHour: pricePerHour || 0,
        pricePerDay,
        pricePerWeek: pricePerWeek || null,
        ownerId: req.user.userId,
      },
    });

    res.json(pool);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET ALL POOLS
router.get('/', async (req, res) => {
  try {
    const { location, priceMax } = req.query;

    let where = {};
    if (location) {
      where.address = { contains: location, mode: 'insensitive' };
    }
    if (priceMax) {
      where.pricePerDay = { lte: parseFloat(priceMax) };
    }

    const pools = await prisma.pool.findMany({
      where,
      include: { owner: { select: { id: true, name: true, avatar: true } } },
      orderBy: { createdAt: 'desc' },
    });

    res.json(pools);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET POOL BY ID
router.get('/:id', async (req, res) => {
  try {
    const pool = await prisma.pool.findUnique({
      where: { id: req.params.id },
      include: { owner: true },
    });

    if (!pool) {
      return res.status(404).json({ error: 'Pool not found' });
    }

    res.json(pool);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// UPDATE POOL
router.patch('/:id', authMiddleware, async (req, res) => {
  try {
    const pool = await prisma.pool.findUnique({
      where: { id: req.params.id },
    });

    if (!pool) {
      return res.status(404).json({ error: 'Pool not found' });
    }

    // Only owner can update
    if (pool.ownerId !== req.user.userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const updated = await prisma.pool.update({
      where: { id: req.params.id },
      data: { ...req.body },
    });

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE POOL
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const pool = await prisma.pool.findUnique({
      where: { id: req.params.id },
    });

    if (!pool) {
      return res.status(404).json({ error: 'Pool not found' });
    }

    // Only owner can delete
    if (pool.ownerId !== req.user.userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await prisma.pool.delete({
      where: { id: req.params.id },
    });

    res.json({ message: 'Pool deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
