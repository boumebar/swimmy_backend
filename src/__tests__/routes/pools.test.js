const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

// Mock app
const app = express();
app.use(express.json());

// Mock database
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

// Validation helper
const validatePrices = (pricePerHour, pricePerDay, pricePerWeek, capacity) => {
    if (pricePerHour !== undefined && pricePerHour < 0) return 'pricePerHour cannot be negative';
    if (pricePerDay !== undefined && pricePerDay < 0) return 'pricePerDay cannot be negative';
    if (pricePerWeek !== undefined && pricePerWeek < 0) return 'pricePerWeek cannot be negative';
    if (capacity !== undefined && capacity <= 0) return 'capacity must be positive';
    return null;
};

// POST /pools
app.post('/api/pools', authMiddleware, (req, res) => {
    const { title, description, address, capacity, pricePerDay, pricePerHour, pricePerWeek } = req.body;

    if (!title || !description || !address || !capacity || !pricePerDay) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    const priceError = validatePrices(pricePerHour, pricePerDay, pricePerWeek, capacity);
    if (priceError) return res.status(400).json({ error: priceError });

    const pool = {
        id: 'pool_' + poolCounter++,
        title,
        description,
        address,
        capacity,
        pricePerDay,
        pricePerHour: pricePerHour || 0,
        pricePerWeek: pricePerWeek || null,
        photos: [],
        latitude: 0,
        longitude: 0,
        ownerId: req.user.userId,
        createdAt: new Date(),
    };

    pools.push(pool);
    res.json(pool);
});

// GET /pools
app.get('/api/pools', (req, res) => {
    const { location, priceMax } = req.query;
    let filtered = pools;

    if (location) {
        filtered = filtered.filter(p => p.address.toLowerCase().includes(location.toLowerCase()));
    }

    if (priceMax) {
        const maxPrice = Math.max(0, parseFloat(priceMax));
        if (maxPrice > 0) {
            filtered = filtered.filter(p => p.pricePerDay <= maxPrice);
        }
    }

    res.json(filtered);
});

// GET /pools/:id
app.get('/api/pools/:id', (req, res) => {
    const pool = pools.find(p => p.id === req.params.id);
    if (!pool) return res.status(404).json({ error: 'Pool not found' });
    res.json(pool);
});

// Tests
describe('Pools CRUD', () => {
    const token = jwt.sign({ userId: 'user_123' }, 'test-secret');
    let createdPoolId;

    const newPool = {
        title: 'Villa Garden',
        description: 'Beautiful pool in the garden',
        address: 'Algiers, Algeria',
        capacity: 10,
        pricePerDay: 5000,
        pricePerHour: 500,
        pricePerWeek: 30000,
    };

    it('should create a pool', async () => {
        const response = await request(app)
            .post('/api/pools')
            .set('Authorization', `Bearer ${token}`)
            .send(newPool)
            .expect(200);

        expect(response.body.title).toBe(newPool.title);
        expect(response.body.capacity).toBe(newPool.capacity);
        expect(response.body.pricePerDay).toBe(newPool.pricePerDay);
        expect(response.body.ownerId).toBe('user_123');

        createdPoolId = response.body.id;
    });

    it('should reject pool without required fields', async () => {
        await request(app)
            .post('/api/pools')
            .set('Authorization', `Bearer ${token}`)
            .send({ title: 'Only Title' })
            .expect(400);
    });

    it('should reject pool with negative price', async () => {
        await request(app)
            .post('/api/pools')
            .set('Authorization', `Bearer ${token}`)
            .send({ ...newPool, pricePerDay: -1000 })
            .expect(400);
    });

    it('should reject pool with zero/negative capacity', async () => {
        await request(app)
            .post('/api/pools')
            .set('Authorization', `Bearer ${token}`)
            .send({ ...newPool, capacity: 0 })
            .expect(400);
    });

    it('should list all pools', async () => {
        const response = await request(app)
            .get('/api/pools')
            .expect(200);

        expect(Array.isArray(response.body)).toBe(true);
        expect(response.body.length).toBeGreaterThan(0);
    });

    it('should filter pools by location', async () => {
        const response = await request(app)
            .get('/api/pools?location=Algiers')
            .expect(200);

        expect(response.body.length).toBeGreaterThan(0);
        expect(response.body[0].address).toContain('Algiers');
    });

    it('should filter pools by max price', async () => {
        const response = await request(app)
            .get('/api/pools?priceMax=4000')
            .expect(200);

        response.body.forEach(pool => {
            expect(pool.pricePerDay).toBeLessThanOrEqual(4000);
        });
    });

    it('should get pool detail by id', async () => {
        const response = await request(app)
            .get(`/api/pools/${createdPoolId}`)
            .expect(200);

        expect(response.body.id).toBe(createdPoolId);
        expect(response.body.title).toBe(newPool.title);
    });

    it('should return 404 for non-existent pool', async () => {
        await request(app)
            .get('/api/pools/nonexistent')
            .expect(404);
    });

    it('should require auth to create pool', async () => {
        await request(app)
            .post('/api/pools')
            .send(newPool)
            .expect(401);
    });
});