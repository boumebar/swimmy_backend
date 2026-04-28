const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const authMiddleware = require('../middleware/auth');

const prisma = new PrismaClient();

// CREATE BOOKING
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { poolId, startDate, endDate, startTime, endTime, notes } = req.body;

    // Validation
    if (!poolId || !startDate || !endDate) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Get pool
    const pool = await prisma.pool.findUnique({ where: { id: poolId } });
    if (!pool) {
      return res.status(404).json({ error: 'Pool not found' });
    }

    // Cannot book own pool
    if (pool.ownerId === req.user.userId) {
      return res.status(400).json({ error: 'Cannot book your own pool' });
    }

    // Calculate total price
    const start = new Date(startDate);
    const end = new Date(endDate);
    const nights = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
    const totalPrice = pool.pricePerDay * nights;

    // Create booking
    const booking = await prisma.booking.create({
      data: {
        poolId,
        renterId: req.user.userId,
        ownerId: pool.ownerId,
        startDate: start,
        endDate: end,
        startTime: startTime || null,
        endTime: endTime || null,
        totalPrice,
        notes: notes || null,
        status: 'pending',
      },
      include: {
        pool: true,
        renter: { select: { id: true, email: true, name: true, phone: true } },
        owner: { select: { id: true, email: true, name: true } },
      },
    });

    res.json(booking);
  } catch (error) {
    // Handle unique constraint error (duplicate booking dates)
    if (error.code === 'P2002') {
      return res.status(400).json({
        error: 'Pool is already booked for these dates. Please select different dates.'
      });
    }

    res.status(500).json({ error: error.message });
  }
});

// GET ALL BOOKINGS (for current user)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const bookings = await prisma.booking.findMany({
      where: {
        OR: [
          { renterId: req.user.userId },
          { ownerId: req.user.userId },
        ],
      },
      include: {
        pool: true,
        renter: { select: { id: true, name: true, email: true } },
        owner: { select: { id: true, name: true } },
      },
      orderBy: { startDate: 'desc' },
    });

    res.json(bookings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET BOOKING BY ID
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const booking = await prisma.booking.findUnique({
      where: { id: req.params.id },
      include: {
        pool: true,
        renter: true,
        owner: true,
      },
    });

    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    // Only renter, owner, or admin can view
    if (
      booking.renterId !== req.user.userId &&
      booking.ownerId !== req.user.userId
    ) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.json(booking);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// UPDATE BOOKING STATUS
router.patch('/:id', authMiddleware, async (req, res) => {
  try {
    const { status } = req.body;

    const booking = await prisma.booking.findUnique({
      where: { id: req.params.id },
    });

    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    // Only owner can update status
    if (booking.ownerId !== req.user.userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Valid statuses
    const validStatuses = ['pending', 'confirmed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const updated = await prisma.booking.update({
      where: { id: req.params.id },
      data: { status },
      include: {
        pool: true,
        renter: true,
        owner: true,
      },
    });

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE BOOKING (cancel)
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const booking = await prisma.booking.findUnique({
      where: { id: req.params.id },
    });

    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    // Only renter can cancel
    if (booking.renterId !== req.user.userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await prisma.booking.delete({
      where: { id: req.params.id },
    });

    res.json({ message: 'Booking cancelled' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;