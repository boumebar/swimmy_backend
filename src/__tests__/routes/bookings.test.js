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
        description: 'Test',
        address: 'Test Address',
        capacity: 10,
        pricePerDay: 5000,
        pricePerHour: 500,
        ownerId,
    };
    pools.push(pool);
    return pool;
};

// POST /bookings
app.post('/api/bookings', authMiddleware, (req, res) => {
    const { poolId, startDate, endDate, startTime, endTime, notes } = req.body;

    if (!poolId || !startDate || !endDate) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

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
        startTime: startTime || null,
        endTime: endTime || null,
        totalPrice,
        notes: notes || null,
        status: 'pending',
        createdAt: new Date(),
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

    const validStatuses = ['pending', 'confirmed', 'cancelled'];
    if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
    }

    booking.status = status;
    res.json(booking);
});

// DELETE /bookings/:id
app.delete('/api/bookings/:id', authMiddleware, (req, res) => {
    const booking = bookings.find(b => b.id === req.params.id);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    if (booking.renterId !== req.user.userId) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    bookings = bookings.filter(b => b.id !== req.params.id);
    res.json({ message: 'Booking cancelled' });
});

// Tests
describe('Bookings Flow', () => {
    const ownerToken = jwt.sign({ userId: 'owner_123' }, 'test-secret');
    const renterToken = jwt.sign({ userId: 'renter_456' }, 'test-secret');

    let poolId;
    let bookingId;

    const newBooking = {
        startDate: '2026-05-01',
        endDate: '2026-05-07',
        startTime: '10:00',
        endTime: '18:00',
        notes: 'Please prepare towels',
    };

    beforeAll(() => {
        const pool = createMockPool('owner_123');
        poolId = pool.id;
    });

    it('should create a booking', async () => {
        const response = await request(app)
            .post('/api/bookings')
            .set('Authorization', `Bearer ${renterToken}`)
            .send({ poolId, ...newBooking })
            .expect(200);

        expect(response.body.renterId).toBe('renter_456');
        expect(response.body.status).toBe('pending');
        expect(response.body.totalPrice).toBe(30000); // 5000 * 6 nights

        bookingId = response.body.id;
    });

    it('should reject booking without required fields', async () => {
        await request(app)
            .post('/api/bookings')
            .set('Authorization', `Bearer ${renterToken}`)
            .send({ poolId })
            .expect(400);
    });

    it('should reject booking own pool', async () => {
        await request(app)
            .post('/api/bookings')
            .set('Authorization', `Bearer ${ownerToken}`)
            .send({ poolId, ...newBooking })
            .expect(400);
    });

    it('should reject booking non-existent pool', async () => {
        await request(app)
            .post('/api/bookings')
            .set('Authorization', `Bearer ${renterToken}`)
            .send({ poolId: 'nonexistent', ...newBooking })
            .expect(404);
    });

    it('should list user bookings', async () => {
        const response = await request(app)
            .get('/api/bookings')
            .set('Authorization', `Bearer ${renterToken}`)
            .expect(200);

        expect(Array.isArray(response.body)).toBe(true);
        expect(response.body.length).toBeGreaterThan(0);
    });

    it('should owner accept booking', async () => {
        const response = await request(app)
            .patch(`/api/bookings/${bookingId}`)
            .set('Authorization', `Bearer ${ownerToken}`)
            .send({ status: 'confirmed' })
            .expect(200);

        expect(response.body.status).toBe('confirmed');
    });

    it('should reject status change by non-owner', async () => {
        await request(app)
            .patch(`/api/bookings/${bookingId}`)
            .set('Authorization', `Bearer ${renterToken}`)
            .send({ status: 'cancelled' })
            .expect(403);
    });

    it('should reject invalid status', async () => {
        await request(app)
            .patch(`/api/bookings/${bookingId}`)
            .set('Authorization', `Bearer ${ownerToken}`)
            .send({ status: 'invalid' })
            .expect(400);
    });

    it('should owner decline booking', async () => {
        // Create another booking
        const newBooking2 = { ...newBooking, startDate: '2026-06-01', endDate: '2026-06-07' };
        const createRes = await request(app)
            .post('/api/bookings')
            .set('Authorization', `Bearer ${renterToken}`)
            .send({ poolId, ...newBooking2 })
            .expect(200);

        const bookingId2 = createRes.body.id;

        const response = await request(app)
            .patch(`/api/bookings/${bookingId2}`)
            .set('Authorization', `Bearer ${ownerToken}`)
            .send({ status: 'cancelled' })
            .expect(200);

        expect(response.body.status).toBe('cancelled');
    });

    it('should renter cancel pending booking', async () => {
        // Create another booking
        const newBooking3 = { ...newBooking, startDate: '2026-07-01', endDate: '2026-07-07' };
        const createRes = await request(app)
            .post('/api/bookings')
            .set('Authorization', `Bearer ${renterToken}`)
            .send({ poolId, ...newBooking3 })
            .expect(200);

        const bookingId3 = createRes.body.id;

        const response = await request(app)
            .delete(`/api/bookings/${bookingId3}`)
            .set('Authorization', `Bearer ${renterToken}`)
            .expect(200);

        expect(response.body.message).toBe('Booking cancelled');
    });

    it('should reject cancel by non-renter', async () => {
        await request(app)
            .delete(`/api/bookings/${bookingId}`)
            .set('Authorization', `Bearer ${ownerToken}`)
            .expect(403);
    });
});