const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

// Mock app
const app = express();
app.use(express.json());

// Mock database
let pools = [];
let availability = [];
let bookings = [];
let poolCounter = 1;
let bookingCounter = 1;

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

// POST /pools/:id/availability (owner marks dates as available)
app.post('/api/pools/:id/availability', authMiddleware, (req, res) => {
  const { poolId, date, isAvailable } = req.body;

  const pool = pools.find(p => p.id === req.params.id);
  if (!pool) return res.status(404).json({ error: 'Pool not found' });

  if (pool.ownerId !== req.user.userId) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Remove existing entry for this date
  availability = availability.filter(a => !(a.poolId === req.params.id && a.date === date));

  // Add new availability
  const availRecord = {
    poolId: req.params.id,
    date,
    isAvailable,
  };

  availability.push(availRecord);
  res.json(availRecord);
});

// GET /pools/:id/availability (check availability)
app.get('/api/pools/:id/availability', (req, res) => {
  const poolAvailability = availability.filter(a => a.poolId === req.params.id);
  res.json(poolAvailability);
});

// POST /bookings (create booking)
app.post('/api/bookings', authMiddleware, (req, res) => {
  const { poolId, startDate, endDate } = req.body;

  const pool = pools.find(p => p.id === poolId);
  if (!pool) return res.status(404).json({ error: 'Pool not found' });

  if (pool.ownerId === req.user.userId) {
    return res.status(400).json({ error: 'Cannot book your own pool' });
  }

  // Check if dates are available
  const start = new Date(startDate);
  const end = new Date(endDate);
  const currentDate = new Date(start);

  while (currentDate <= end) {
    const dateStr = currentDate.toISOString().split('T')[0];
    const avail = availability.find(a => a.poolId === poolId && a.date === dateStr);
    
    if (avail && !avail.isAvailable) {
      return res.status(400).json({ error: `Pool not available on ${dateStr}` });
    }

    currentDate.setDate(currentDate.getDate() + 1);
  }

  // Check for conflicting bookings
  const conflictingBooking = bookings.find(b =>
    b.poolId === poolId &&
    new Date(b.startDate) <= end &&
    new Date(b.endDate) >= start
  );

  if (conflictingBooking) {
    return res.status(400).json({ error: 'Dates conflict with existing booking' });
  }

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

// Tests
describe('Pool Availability Flow', () => {
  const ownerToken = jwt.sign({ userId: 'owner_1' }, 'test-secret');
  const renterToken = jwt.sign({ userId: 'renter_1' }, 'test-secret');
  let poolId;

  beforeAll(() => {
    pools = [];
    availability = [];
    bookings = [];
    poolCounter = 1;
    bookingCounter = 1;

    const pool = createMockPool('owner_1');
    poolId = pool.id;
  });

  it('Step 1: Owner creates pool', () => {
    expect(pools.length).toBe(1);
    expect(pools[0].ownerId).toBe('owner_1');
  });

  it('Step 2: Owner marks dates as available', async () => {
    const response = await request(app)
      .post(`/api/pools/${poolId}/availability`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        poolId,
        date: '2026-05-01',
        isAvailable: true,
      })
      .expect(200);

    expect(response.body.isAvailable).toBe(true);
    expect(response.body.date).toBe('2026-05-01');
  });

  it('Step 3: Owner marks some dates as unavailable', async () => {
    // Mark 2026-05-15 as unavailable
    const response = await request(app)
      .post(`/api/pools/${poolId}/availability`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        poolId,
        date: '2026-05-15',
        isAvailable: false,
      })
      .expect(200);

    expect(response.body.isAvailable).toBe(false);
  });

  it('Step 4: Check availability records', async () => {
    // Mark a few dates available first
    for (let i = 1; i <= 10; i++) {
      await request(app)
        .post(`/api/pools/${poolId}/availability`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          poolId,
          date: `2026-05-${String(i).padStart(2, '0')}`,
          isAvailable: true,
        });
    }

    const response = await request(app)
      .get(`/api/pools/${poolId}/availability`)
      .expect(200);

    expect(response.body.length).toBeGreaterThan(0);
    expect(response.body.some(a => a.date === '2026-05-01')).toBe(true);
  });

  it('Step 5: Renter can book available dates', async () => {
    // Mark dates available
    for (let i = 1; i <= 7; i++) {
      await request(app)
        .post(`/api/pools/${poolId}/availability`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          poolId,
          date: `2026-06-${String(i).padStart(2, '0')}`,
          isAvailable: true,
        });
    }

    // Renter books
    const response = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${renterToken}`)
      .send({
        poolId,
        startDate: '2026-06-01',
        endDate: '2026-06-07',
      })
      .expect(200);

    expect(response.body.status).toBe('pending');
    expect(response.body.totalPrice).toBe(30000); // 5000 * 6 nights
  });

  it('Step 6: Renter cannot book unavailable dates', async () => {
    // Create new pool
    const newPool = createMockPool('owner_1');

    // Mark only some dates as available (2026-07-01 to 2026-07-05)
    for (let i = 1; i <= 5; i++) {
      await request(app)
        .post(`/api/pools/${newPool.id}/availability`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          poolId: newPool.id,
          date: `2026-07-${String(i).padStart(2, '0')}`,
          isAvailable: true,
        });
    }

    // Mark 2026-07-06 as unavailable
    await request(app)
      .post(`/api/pools/${newPool.id}/availability`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        poolId: newPool.id,
        date: '2026-07-06',
        isAvailable: false,
      });

    // Try to book including unavailable date (should fail)
    await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${renterToken}`)
      .send({
        poolId: newPool.id,
        startDate: '2026-07-01',
        endDate: '2026-07-06',
      })
      .expect(400);
  });

  it('Step 7: Renter cannot book conflicting dates', async () => {
    // Create new pool
    const newPool = createMockPool('owner_1');

    // Mark dates available
    for (let i = 1; i <= 15; i++) {
      await request(app)
        .post(`/api/pools/${newPool.id}/availability`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          poolId: newPool.id,
          date: `2026-08-${String(i).padStart(2, '0')}`,
          isAvailable: true,
        });
    }

    // First renter books 2026-08-01 to 2026-08-07
    await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${renterToken}`)
      .send({
        poolId: newPool.id,
        startDate: '2026-08-01',
        endDate: '2026-08-07',
      })
      .expect(200);

    // Second renter tries to book overlapping dates (should fail)
    const renter2Token = jwt.sign({ userId: 'renter_2' }, 'test-secret');

    await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${renter2Token}`)
      .send({
        poolId: newPool.id,
        startDate: '2026-08-05',
        endDate: '2026-08-10',
      })
      .expect(400);
  });

  it('FULL AVAILABILITY FLOW: Owner sets availability → Renter books → Conflict prevented', async () => {
    // Create new pool
    const newPool = createMockPool('owner_1');

    // Owner marks dates 2026-09-01 to 2026-09-20 as available
    for (let i = 1; i <= 20; i++) {
      await request(app)
        .post(`/api/pools/${newPool.id}/availability`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          poolId: newPool.id,
          date: `2026-09-${String(i).padStart(2, '0')}`,
          isAvailable: true,
        });
    }

    // Check availability
    const availRes = await request(app)
      .get(`/api/pools/${newPool.id}/availability`)
      .expect(200);

    expect(availRes.body.length).toBe(20);
    expect(availRes.body.filter(a => a.isAvailable).length).toBe(20);

    // Renter 1 books 2026-09-01 to 2026-09-10
    const booking1 = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${renterToken}`)
      .send({
        poolId: newPool.id,
        startDate: '2026-09-01',
        endDate: '2026-09-10',
      })
      .expect(200);

    expect(booking1.body.status).toBe('pending');

    // Renter 2 books available dates 2026-09-11 to 2026-09-20 (should succeed)
    const renter2Token = jwt.sign({ userId: 'renter_2' }, 'test-secret');

    const booking2 = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${renter2Token}`)
      .send({
        poolId: newPool.id,
        startDate: '2026-09-11',
        endDate: '2026-09-20',
      })
      .expect(200);

    expect(booking2.body.status).toBe('pending');

    // Renter 3 tries to book overlapping with Renter 1 (should fail)
    const renter3Token = jwt.sign({ userId: 'renter_3' }, 'test-secret');

    await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${renter3Token}`)
      .send({
        poolId: newPool.id,
        startDate: '2026-09-05',
        endDate: '2026-09-15',
      })
      .expect(400);
  });
});
