const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const authMiddleware = require('../middleware/auth');

const prisma = new PrismaClient();

// VALIDATION HELPER
const validatePrices = (pricePerHour, pricePerDay, pricePerWeek, capacity) => {
  if (pricePerHour !== undefined && pricePerHour !== null && pricePerHour < 0) {
    return 'pricePerHour cannot be negative';
  }
  if (pricePerDay !== undefined && pricePerDay !== null && pricePerDay < 0) {
    return 'pricePerDay cannot be negative';
  }
  if (pricePerWeek !== undefined && pricePerWeek !== null && pricePerWeek < 0) {
    return 'pricePerWeek cannot be negative';
  }
  if (capacity !== undefined && capacity !== null && capacity <= 0) {
    return 'capacity must be positive';
  }
  return null;
};

// CREATE POOL
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { title, description, photos, address, latitude, longitude, capacity, pricePerHour, pricePerDay, pricePerWeek } = req.body;

    // Validation - Required fields
    if (!title || !description || !address || !capacity || !pricePerDay) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Validation - Prices & Capacity
    const priceError = validatePrices(pricePerHour, pricePerDay, pricePerWeek, capacity);
    if (priceError) {
      return res.status(400).json({ error: priceError });
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

// GET ALL POOLS (with filters)
router.get('/', async (req, res) => {
  try {
    const { location, priceMax } = req.query;

    let where = {};
    
    if (location) {
      where.address = { contains: location, mode: 'insensitive' };
    }
    
    if (priceMax) {
      const maxPrice = Math.max(0, parseFloat(priceMax));
      if (maxPrice > 0) {
        where.pricePerDay = { lte: maxPrice };
      }
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

    // Validation - Prices & Capacity
    const priceError = validatePrices(
      req.body.pricePerHour,
      req.body.pricePerDay,
      req.body.pricePerWeek,
      req.body.capacity
    );
    if (priceError) {
      return res.status(400).json({ error: priceError });
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

// GET POOL AVAILABILITY
router.get('/:id/availability', async (req, res) => {
  try {
    const { id } = req.params;

    // Get all bookings for this pool
    const bookings = await prisma.booking.findMany({
      where: {
        poolId: id,
        status: { in: ['pending', 'confirmed'] },
      },
    });

    // Get availability records
    const availability = await prisma.availability.findMany({
      where: { poolId: id },
      orderBy: { date: 'asc' },
    });

    res.json({
      poolId: id,
      bookings: bookings.map((b) => ({
        id: b.id,
        startDate: b.startDate,
        endDate: b.endDate,
        status: b.status,
      })),
      availability: availability,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// SET POOL AVAILABILITY
router.post('/:id/availability', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { date, isAvailable } = req.body;

    // Verify pool exists and user is owner
    const pool = await prisma.pool.findUnique({
      where: { id },
    });

    if (!pool) {
      return res.status(404).json({ error: 'Pool not found' });
    }

    if (pool.ownerId !== req.user.userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Upsert availability
    const availability = await prisma.availability.upsert({
      where: {
        poolId_date: {
          poolId: id,
          date: new Date(date),
        },
      },
      update: { isAvailable },
      create: {
        poolId: id,
        date: new Date(date),
        isAvailable,
      },
    });

    res.json(availability);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;