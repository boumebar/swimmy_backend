const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

// Mock app
const app = express();
app.use(express.json());

// Mock database
let bookings = [];
let bookingCounter = 1;
let pools = [];
let poolCounter = 1;

// Mock auth middleware
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  
  try {
    const decoded = jwt.verify(token, 'test-secret');
    req.user = { userId: decoded.userId };
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Mock pool creation
const createMockPool = (ownerId) => {
  const pool = {
    id: 'pool_' + poolCounter++,
    title: 'Test Pool',
    pricePerDay: 5000,
    ownerId,
  };
  pools.push(pool);
  return pool;
};

// POST /bookings
app.post('/api/bookings', authMiddleware, (req, res) => {
  const { poolId, startDate, endDate } = req.body;

  const pool = pools.find(p => p.id === poolId);
  if (!pool) return res.status(404).json({ error: 'Pool not found' });

  const start = new Date(startDate);
  const end = new Date(endDate);
  const nights = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
  const totalPrice = pool.pricePerDay * nights;

  const booking = {
    id: 'booking_' + bookingCounter++,
    poolId,
    renterId: req.user.userId,
    ownerId: pool.ownerId,
    startDate,
    endDate,
    totalPrice,
    status: 'pending',
  };

  bookings.push(booking);
  res.json(booking);
});

// GET /bookings
app.get('/api/bookings', authMiddleware, (req, res) => {
  const userBookings = bookings.filter(b =>
    b.renterId === req.user.userId || b.ownerId === req.user.userId
  );
  res.json(userBookings);
});

// PATCH /bookings/:id (Accept/Refuse)
app.patch('/api/bookings/:id', authMiddleware, (req, res) => {
  const { status } = req.body;

  const booking = bookings.find(b => b.id === req.params.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });

  // Only owner can update status
  if (booking.ownerId !== req.user.userId) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const validStatuses = ['pending', 'confirmed', 'cancelled'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  booking.status = status;
  res.json(booking);
});

// Tests
describe('Owner Accepting/Refusing Bookings', () => {
  const ownerToken = jwt.sign({ userId: 'owner_123' }, 'test-secret');
  const renterToken = jwt.sign({ userId: 'renter_456' }, 'test-secret');
  
  let poolId;
  let bookingId;

  beforeEach(() => {
    bookings = [];
    bookingCounter = 1;
    const pool = createMockPool('owner_123');
    poolId = pool.id;
  });

  it('should create a pending booking', async () => {
    const response = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${renterToken}`)
      .send({
        poolId,
        startDate: '2026-05-01',
        endDate: '2026-05-07',
      })
      .expect(200);

    expect(response.body.status).toBe('pending');
    bookingId = response.body.id;
  });

  it('owner should accept booking', async () => {
    // Create booking
    const createRes = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${renterToken}`)
      .send({
        poolId,
        startDate: '2026-05-01',
        endDate: '2026-05-07',
      })
      .expect(200);

    bookingId = createRes.body.id;

    // Owner accepts
    const response = await request(app)
      .patch(`/api/bookings/${bookingId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ status: 'confirmed' })
      .expect(200);

    expect(response.body.status).toBe('confirmed');
  });

  it('owner should refuse (decline) booking', async () => {
    // Create booking
    const createRes = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${renterToken}`)
      .send({
        poolId,
        startDate: '2026-06-01',
        endDate: '2026-06-07',
      })
      .expect(200);

    bookingId = createRes.body.id;

    // Owner declines
    const response = await request(app)
      .patch(`/api/bookings/${bookingId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ status: 'cancelled' })
      .expect(200);

    expect(response.body.status).toBe('cancelled');
  });

  it('renter should NOT be able to change status', async () => {
    // Create booking
    const createRes = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${renterToken}`)
      .send({
        poolId,
        startDate: '2026-07-01',
        endDate: '2026-07-07',
      })
      .expect(200);

    bookingId = createRes.body.id;

    // Renter tries to change status (should fail)
    await request(app)
      .patch(`/api/bookings/${bookingId}`)
      .set('Authorization', `Bearer ${renterToken}`)
      .send({ status: 'confirmed' })
      .expect(403);
  });

  it('owner should see pending bookings in list', async () => {
    // Create booking
    await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${renterToken}`)
      .send({
        poolId,
        startDate: '2026-08-01',
        endDate: '2026-08-07',
      })
      .expect(200);

    // Owner lists their bookings
    const response = await request(app)
      .get('/api/bookings')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect(response.body.length).toBeGreaterThan(0);
    const pendingBookings = response.body.filter(b => b.status === 'pending');
    expect(pendingBookings.length).toBeGreaterThan(0);
  });

  it('should validate status change', async () => {
    // Create booking
    const createRes = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${renterToken}`)
      .send({
        poolId,
        startDate: '2026-09-01',
        endDate: '2026-09-07',
      })
      .expect(200);

    bookingId = createRes.body.id;

    // Try invalid status
    await request(app)
      .patch(`/api/bookings/${bookingId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ status: 'invalid_status' })
      .expect(400);
  });
});
