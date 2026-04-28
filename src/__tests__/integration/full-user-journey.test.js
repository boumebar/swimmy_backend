const request = require('supertest');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Mock app
const app = express();
app.use(express.json());

// Mock database
let users = [];
let pools = [];
let bookings = [];
let messages = [];
let userCounter = 1;
let poolCounter = 1;
let bookingCounter = 1;
let messageCounter = 1;

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

// POST /auth/signup
app.post('/api/auth/signup', async (req, res) => {
  const { email, password, name } = req.body;

  if (!email || !password || !name) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  if (users.find(u => u.email === email)) {
    return res.status(400).json({ error: 'Email already exists' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const user = {
    id: 'user_' + userCounter++,
    email,
    name,
    password: hashedPassword
  };
  users.push(user);

  const token = jwt.sign({ userId: user.id }, 'test-secret');
  res.json({ user: { id: user.id, email, name }, token });
});

// POST /pools
app.post('/api/pools', authMiddleware, (req, res) => {
  const { title, description, address, capacity, pricePerDay } = req.body;

  if (!title || !description || !address || !capacity || !pricePerDay) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const pool = {
    id: 'pool_' + poolCounter++,
    title,
    description,
    address,
    capacity,
    pricePerDay,
    ownerId: req.user.userId,
  };

  pools.push(pool);
  res.json(pool);
});

// GET /pools
app.get('/api/pools', (req, res) => {
  res.json(pools);
});

// GET /pools/:id
app.get('/api/pools/:id', (req, res) => {
  const pool = pools.find(p => p.id === req.params.id);
  if (!pool) return res.status(404).json({ error: 'Pool not found' });
  res.json(pool);
});

// POST /bookings
app.post('/api/bookings', authMiddleware, (req, res) => {
  const { poolId, startDate, endDate } = req.body;

  const pool = pools.find(p => p.id === poolId);
  if (!pool) return res.status(404).json({ error: 'Pool not found' });

  if (pool.ownerId === req.user.userId) {
    return res.status(400).json({ error: 'Cannot book your own pool' });
  }

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

// PATCH /bookings/:id
app.patch('/api/bookings/:id', authMiddleware, (req, res) => {
  const { status } = req.body;

  const booking = bookings.find(b => b.id === req.params.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });

  if (booking.ownerId !== req.user.userId) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  booking.status = status;
  res.json(booking);
});

// POST /messages/:userId
app.post('/api/messages/:userId', authMiddleware, (req, res) => {
  const { text } = req.body;

  if (!text || text.trim() === '') {
    return res.status(400).json({ error: 'Message cannot be empty' });
  }

  if (req.user.userId === req.params.userId) {
    return res.status(400).json({ error: 'Cannot message yourself' });
  }

  const message = {
    id: 'msg_' + messageCounter++,
    senderId: req.user.userId,
    receiverId: req.params.userId,
    text,
    isRead: false,
    createdAt: new Date(),
  };

  messages.push(message);
  res.json(message);
});

// GET /messages/inbox
app.get('/api/messages/inbox', authMiddleware, (req, res) => {
  const userId = req.user.userId;
  const userMessages = messages.filter(m => m.senderId === userId || m.receiverId === userId);
  res.json(userMessages);
});

// Tests
describe('Full User Journey: Owner Creates Pool → Renter Books → Message', () => {
  let ownerToken;
  let renterToken;
  let ownerId;
  let renterId;

  beforeAll(async () => {
    // Reset database once at start
    users = [];
    pools = [];
    bookings = [];
    messages = [];
    userCounter = 1;
    poolCounter = 1;
    bookingCounter = 1;
    messageCounter = 1;

    // Owner signup
    const ownerRes = await request(app)
      .post('/api/auth/signup')
      .send({
        email: 'owner@example.com',
        password: 'Owner123!',
        name: 'Pool Owner',
      });
    ownerToken = ownerRes.body.token;
    ownerId = ownerRes.body.user.id;

    // Renter signup
    const renterRes = await request(app)
      .post('/api/auth/signup')
      .send({
        email: 'renter@example.com',
        password: 'Renter123!',
        name: 'Pool Renter',
      });
    renterToken = renterRes.body.token;
    renterId = renterRes.body.user.id;
  });

  it('Step 1: Owner signed up', () => {
    expect(ownerToken).toBeDefined();
    expect(ownerId).toBeDefined();
  });

  it('Step 2: Renter signed up', () => {
    expect(renterToken).toBeDefined();
    expect(renterId).toBeDefined();
  });

  it('Step 3: Owner creates a pool', async () => {
    const response = await request(app)
      .post('/api/pools')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        title: 'Luxury Villa Pool',
        description: 'Beautiful pool in Algiers',
        address: 'Algiers, Algeria',
        capacity: 10,
        pricePerDay: 5000,
      })
      .expect(200);

    expect(response.body.title).toBe('Luxury Villa Pool');
    expect(response.body.ownerId).toBe(ownerId);
  });

  it('Step 4: Renter browses and finds the pool', async () => {
    const response = await request(app)
      .get('/api/pools')
      .expect(200);

    expect(response.body.length).toBeGreaterThan(0);
    expect(response.body.some(p => p.ownerId === ownerId)).toBe(true);
  });

  it('Step 5: Renter books the pool', async () => {
    // Get first pool from owner
    const poolsRes = await request(app)
      .get('/api/pools')
      .expect(200);

    const ownerPool = poolsRes.body.find(p => p.ownerId === ownerId);
    expect(ownerPool).toBeDefined();

    const response = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${renterToken}`)
      .send({
        poolId: ownerPool.id,
        startDate: '2026-05-01',
        endDate: '2026-05-07',
      })
      .expect(200);

    expect(response.body.status).toBe('pending');
    expect(response.body.renterId).toBe(renterId);
    expect(response.body.totalPrice).toBe(30000); // 5000 * 6 nights
  });

  it('Step 6: Owner accepts the booking', async () => {
    // Get the booking
    const bookingsRes = await request(app)
      .get('/api/bookings')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    const pendingBooking = bookingsRes.body.find(b => b.status === 'pending');
    expect(pendingBooking).toBeDefined();

    const response = await request(app)
      .patch(`/api/bookings/${pendingBooking.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ status: 'confirmed' })
      .expect(200);

    expect(response.body.status).toBe('confirmed');
  });

  it('Step 7: Renter sends message to owner', async () => {
    const response = await request(app)
      .post(`/api/messages/${ownerId}`)
      .set('Authorization', `Bearer ${renterToken}`)
      .send({ text: 'Hi! I just booked your pool. See you soon!' })
      .expect(200);

    expect(response.body.text).toBe('Hi! I just booked your pool. See you soon!');
    expect(response.body.senderId).toBe(renterId);
    expect(response.body.receiverId).toBe(ownerId);
  });

  it('Step 8: Owner receives and responds to message', async () => {
    // Owner checks inbox
    const inboxRes = await request(app)
      .get('/api/messages/inbox')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect(inboxRes.body.length).toBeGreaterThan(0);

    // Owner responds
    const response = await request(app)
      .post(`/api/messages/${renterId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ text: 'Welcome! Looking forward to seeing you!' })
      .expect(200);

    expect(response.body.senderId).toBe(ownerId);
    expect(response.body.receiverId).toBe(renterId);
  });
  it('FULL JOURNEY: Complete user flow from signup to confirmed booking + messaging', async () => {
    // 1. New owner signup
    const ownerSignupRes = await request(app)
      .post('/api/auth/signup')
      .send({
        email: 'journey-owner@example.com',
        password: 'Owner123!',
        name: 'Journey Owner',
      })
      .expect(200);

    const journeyOwnerToken = ownerSignupRes.body.token;
    const journeyOwnerId = ownerSignupRes.body.user.id;

    // 2. New renter signup
    const renterSignupRes = await request(app)
      .post('/api/auth/signup')
      .send({
        email: 'journey-renter@example.com',
        password: 'Renter123!',
        name: 'Journey Renter',
      })
      .expect(200);

    const journeyRenterToken = renterSignupRes.body.token;
    const journeyRenterId = renterSignupRes.body.user.id;

    // 3. Owner creates pool
    const poolRes = await request(app)
      .post('/api/pools')
      .set('Authorization', `Bearer ${journeyOwnerToken}`)
      .send({
        title: 'Journey Pool',
        description: 'Full journey test pool',
        address: 'Algiers',
        capacity: 8,
        pricePerDay: 4000,
      })
      .expect(200);

    const journeyPoolId = poolRes.body.id;
    expect(poolRes.body.ownerId).toBe(journeyOwnerId);

    // 4. Renter books pool
    const bookingRes = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${journeyRenterToken}`)
      .send({
        poolId: journeyPoolId,
        startDate: '2026-09-01',
        endDate: '2026-09-08',
      })
      .expect(200);

    const journeyBookingId = bookingRes.body.id;
    expect(bookingRes.body.status).toBe('pending');
    expect(bookingRes.body.totalPrice).toBe(28000); // 4000 * 7 nights

    // 5. Owner accepts booking
    const acceptRes = await request(app)
      .patch(`/api/bookings/${journeyBookingId}`)
      .set('Authorization', `Bearer ${journeyOwnerToken}`)
      .send({ status: 'confirmed' })
      .expect(200);

    expect(acceptRes.body.status).toBe('confirmed');

    // 6. Renter sends message
    const messageRes = await request(app)
      .post(`/api/messages/${journeyOwnerId}`)
      .set('Authorization', `Bearer ${journeyRenterToken}`)
      .send({ text: 'Great! Your pool is amazing!' })
      .expect(200);

    expect(messageRes.body.text).toBe('Great! Your pool is amazing!');
    expect(messageRes.body.senderId).toBe(journeyRenterId);

    // 7. Owner responds
    const responseRes = await request(app)
      .post(`/api/messages/${journeyRenterId}`)
      .set('Authorization', `Bearer ${journeyOwnerToken}`)
      .send({ text: 'Thanks! Enjoy your stay!' })
      .expect(200);

    expect(responseRes.body.senderId).toBe(journeyOwnerId);

    // 8. Verify confirmed booking exists
    const bookingsRes = await request(app)
      .get('/api/bookings')
      .set('Authorization', `Bearer ${journeyOwnerToken}`)
      .expect(200);

    const confirmedBooking = bookingsRes.body.find(b => b.id === journeyBookingId);
    expect(confirmedBooking).toBeDefined();
    expect(confirmedBooking.status).toBe('confirmed');
  });
});