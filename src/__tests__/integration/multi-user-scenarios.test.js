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

// Helper: Create user
const createUser = async (email, name) => {
  const hashedPassword = await bcrypt.hash('Pass123!', 10);
  const user = { 
    id: 'user_' + userCounter++, 
    email, 
    name, 
    password: hashedPassword 
  };
  users.push(user);
  const token = jwt.sign({ userId: user.id }, 'test-secret');
  return { user, token };
};

// POST /auth/signup
app.post('/api/auth/signup', async (req, res) => {
  const { email, password, name } = req.body;
  
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

// POST /bookings
app.post('/api/bookings', authMiddleware, (req, res) => {
  const { poolId, startDate, endDate } = req.body;
  
  const pool = pools.find(p => p.id === poolId);
  if (!pool) return res.status(404).json({ error: 'Pool not found' });
  
  if (pool.ownerId === req.user.userId) {
    return res.status(400).json({ error: 'Cannot book your own pool' });
  }

  // Check for conflicts
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  const conflict = bookings.find(b =>
    b.poolId === poolId &&
    new Date(b.startDate) <= end &&
    new Date(b.endDate) >= start &&
    b.status !== 'cancelled'
  );

  if (conflict) {
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
describe('Multi-user Scenarios', () => {
  let ownerA, ownerB, renterC, renterD;
  let ownerAToken, ownerBToken, renterCToken, renterDToken;
  let poolA1, poolB1;

  beforeAll(async () => {
    users = [];
    pools = [];
    bookings = [];
    messages = [];
    userCounter = 1;
    poolCounter = 1;
    bookingCounter = 1;
    messageCounter = 1;

    // Create 4 users
    const resA = await createUser('ownerA@example.com', 'Owner A');
    ownerA = resA.user;
    ownerAToken = resA.token;

    const resB = await createUser('ownerB@example.com', 'Owner B');
    ownerB = resB.user;
    ownerBToken = resB.token;

    const resC = await createUser('renterC@example.com', 'Renter C');
    renterC = resC.user;
    renterCToken = resC.token;

    const resD = await createUser('renterD@example.com', 'Renter D');
    renterD = resD.user;
    renterDToken = resD.token;
  });

  it('Scenario 1: Two owners create different pools', async () => {
    // Owner A creates pool
    const poolARes = await request(app)
      .post('/api/pools')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({
        title: 'Pool A',
        description: 'Owner A pool',
        address: 'Address A',
        capacity: 10,
        pricePerDay: 5000,
      })
      .expect(200);

    poolA1 = poolARes.body;
    expect(poolA1.ownerId).toBe(ownerA.id);

    // Owner B creates pool
    const poolBRes = await request(app)
      .post('/api/pools')
      .set('Authorization', `Bearer ${ownerBToken}`)
      .send({
        title: 'Pool B',
        description: 'Owner B pool',
        address: 'Address B',
        capacity: 8,
        pricePerDay: 4000,
      })
      .expect(200);

    poolB1 = poolBRes.body;
    expect(poolB1.ownerId).toBe(ownerB.id);
  });

  it('Scenario 2: Renter C books from Owner A, Renter D books from Owner B', async () => {
    // Renter C books Pool A
    const bookingCRes = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${renterCToken}`)
      .send({
        poolId: poolA1.id,
        startDate: '2026-05-01',
        endDate: '2026-05-07',
      })
      .expect(200);

    expect(bookingCRes.body.renterId).toBe(renterC.id);
    expect(bookingCRes.body.ownerId).toBe(ownerA.id);

    // Renter D books Pool B
    const bookingDRes = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${renterDToken}`)
      .send({
        poolId: poolB1.id,
        startDate: '2026-06-01',
        endDate: '2026-06-07',
      })
      .expect(200);

    expect(bookingDRes.body.renterId).toBe(renterD.id);
    expect(bookingDRes.body.ownerId).toBe(ownerB.id);
  });

  it('Scenario 3: Owner A and B can see their respective bookings', async () => {
    // Owner A checks bookings (should see Renter C booking)
    const bookingsA = await request(app)
      .get('/api/bookings')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .expect(200);

    expect(bookingsA.body.some(b => b.ownerId === ownerA.id)).toBe(true);

    // Owner B checks bookings (should see Renter D booking)
    const bookingsB = await request(app)
      .get('/api/bookings')
      .set('Authorization', `Bearer ${ownerBToken}`)
      .expect(200);

    expect(bookingsB.body.some(b => b.ownerId === ownerB.id)).toBe(true);
  });

  it('Scenario 4: Owner A accepts, Owner B refuses', async () => {
    // Get Renter C booking
    const bookingsA = await request(app)
      .get('/api/bookings')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .expect(200);

    const bookingC = bookingsA.body.find(b => b.renterId === renterC.id);

    // Owner A accepts
    const acceptRes = await request(app)
      .patch(`/api/bookings/${bookingC.id}`)
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({ status: 'confirmed' })
      .expect(200);

    expect(acceptRes.body.status).toBe('confirmed');

    // Get Renter D booking
    const bookingsB = await request(app)
      .get('/api/bookings')
      .set('Authorization', `Bearer ${ownerBToken}`)
      .expect(200);

    const bookingD = bookingsB.body.find(b => b.renterId === renterD.id);

    // Owner B refuses
    const refuseRes = await request(app)
      .patch(`/api/bookings/${bookingD.id}`)
      .set('Authorization', `Bearer ${ownerBToken}`)
      .send({ status: 'cancelled' })
      .expect(200);

    expect(refuseRes.body.status).toBe('cancelled');
  });

  it('Scenario 5: Renters message their respective owners', async () => {
    // Renter C messages Owner A
    const msgCRes = await request(app)
      .post(`/api/messages/${ownerA.id}`)
      .set('Authorization', `Bearer ${renterCToken}`)
      .send({ text: 'Thanks for accepting my booking!' })
      .expect(200);

    expect(msgCRes.body.receiverId).toBe(ownerA.id);

    // Renter D messages Owner B
    const msgDRes = await request(app)
      .post(`/api/messages/${ownerB.id}`)
      .set('Authorization', `Bearer ${renterDToken}`)
      .send({ text: 'I understand you declined my booking' })
      .expect(200);

    expect(msgDRes.body.receiverId).toBe(ownerB.id);
  });

  it('Scenario 6: Both renters cannot book same dates on same pool', async () => {
    // Create new pool
    const poolNewRes = await request(app)
      .post('/api/pools')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({
        title: 'Shared Pool',
        description: 'Pool for testing conflicts',
        address: 'Shared Address',
        capacity: 5,
        pricePerDay: 3000,
      })
      .expect(200);

    const poolNew = poolNewRes.body;

    // Renter C books 2026-07-01 to 2026-07-07
    const booking1Res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${renterCToken}`)
      .send({
        poolId: poolNew.id,
        startDate: '2026-07-01',
        endDate: '2026-07-07',
      })
      .expect(200);

    expect(booking1Res.body.status).toBe('pending');

    // Renter D tries to book overlapping dates (should fail)
    await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${renterDToken}`)
      .send({
        poolId: poolNew.id,
        startDate: '2026-07-05',
        endDate: '2026-07-10',
      })
      .expect(400);
  });

  it('Scenario 7: Both renters can book non-overlapping dates on same pool', async () => {
    // Create another pool
    const poolNewRes = await request(app)
      .post('/api/pools')
      .set('Authorization', `Bearer ${ownerBToken}`)
      .send({
        title: 'Popular Pool',
        description: 'Popular pool',
        address: 'Popular Address',
        capacity: 6,
        pricePerDay: 3500,
      })
      .expect(200);

    const poolNew = poolNewRes.body;

    // Renter C books 2026-08-01 to 2026-08-07
    const booking1Res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${renterCToken}`)
      .send({
        poolId: poolNew.id,
        startDate: '2026-08-01',
        endDate: '2026-08-07',
      })
      .expect(200);

    expect(booking1Res.body.renterId).toBe(renterC.id);

    // Renter D books non-overlapping dates (should succeed)
    const booking2Res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${renterDToken}`)
      .send({
        poolId: poolNew.id,
        startDate: '2026-08-10',
        endDate: '2026-08-15',
      })
      .expect(200);

    expect(booking2Res.body.renterId).toBe(renterD.id);
  });

  it('FULL MULTI-USER: Complex scenario with 2 owners, 2 renters, multiple pools', async () => {
    // Owner A creates 2 pools
    const poolA2Res = await request(app)
      .post('/api/pools')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({
        title: 'Pool A2',
        description: 'Second pool from A',
        address: 'Address A2',
        capacity: 7,
        pricePerDay: 4500,
      })
      .expect(200);

    const poolA2 = poolA2Res.body;

    // Owner B creates 2 pools
    const poolB2Res = await request(app)
      .post('/api/pools')
      .set('Authorization', `Bearer ${ownerBToken}`)
      .send({
        title: 'Pool B2',
        description: 'Second pool from B',
        address: 'Address B2',
        capacity: 9,
        pricePerDay: 4200,
      })
      .expect(200);

    const poolB2 = poolB2Res.body;

    // Renter C books multiple pools
    const bookingC1 = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${renterCToken}`)
      .send({
        poolId: poolA2.id,
        startDate: '2026-09-01',
        endDate: '2026-09-07',
      })
      .expect(200);

    const bookingC2 = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${renterCToken}`)
      .send({
        poolId: poolB2.id,
        startDate: '2026-10-01',
        endDate: '2026-10-07',
      })
      .expect(200);

    // Renter D books remaining pools
    const bookingD1 = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${renterDToken}`)
      .send({
        poolId: poolA2.id,
        startDate: '2026-09-10',
        endDate: '2026-09-15',
      })
      .expect(200);

    // Owner A accepts C1, refuses D1
    await request(app)
      .patch(`/api/bookings/${bookingC1.body.id}`)
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({ status: 'confirmed' })
      .expect(200);

    await request(app)
      .patch(`/api/bookings/${bookingD1.body.id}`)
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({ status: 'cancelled' })
      .expect(200);

    // Owner B accepts C2
    await request(app)
      .patch(`/api/bookings/${bookingC2.body.id}`)
      .set('Authorization', `Bearer ${ownerBToken}`)
      .send({ status: 'confirmed' })
      .expect(200);

    // Verify final states
    const bookingsA = await request(app)
      .get('/api/bookings')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .expect(200);

    const confirmedCount = bookingsA.body.filter(b => b.status === 'confirmed').length;
    expect(confirmedCount).toBeGreaterThan(0);

    const cancelledCount = bookingsA.body.filter(b => b.status === 'cancelled').length;
    expect(cancelledCount).toBeGreaterThan(0);
  });
});
