const request = require('supertest');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Mock auth routes for testing
const app = express();
app.use(express.json());

// Mock database
let users = [];

// Mock auth middleware
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  
  try {
    const decoded = jwt.verify(token, 'test-secret');
    req.user = decoded;
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
  const user = { id: 'user_' + Date.now(), email, name, password: hashedPassword };
  users.push(user);
  
  const token = jwt.sign({ userId: user.id, email }, 'test-secret');
  res.json({ user: { id: user.id, email, name }, token });
});

// POST /auth/login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  
  const user = users.find(u => u.email === email);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  
  const passwordMatch = await bcrypt.compare(password, user.password);
  if (!passwordMatch) return res.status(401).json({ error: 'Invalid credentials' });
  
  const token = jwt.sign({ userId: user.id, email }, 'test-secret');
  res.json({ user: { id: user.id, email, name: user.name }, token });
});

// GET /auth/me
app.get('/api/auth/me', authMiddleware, (req, res) => {
  const user = users.find(u => u.id === req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ id: user.id, email: user.email, name: user.name });
});

// Tests
describe('Auth Full Flow', () => {
  let token;
  let userId;
  const testUser = {
    email: 'test@example.com',
    password: 'Test123!',
    name: 'Test User',
  };

  it('should signup successfully', async () => {
    const response = await request(app)
      .post('/api/auth/signup')
      .send(testUser)
      .expect(200);

    expect(response.body.user.email).toBe(testUser.email);
    expect(response.body.user.name).toBe(testUser.name);
    expect(response.body.token).toBeDefined();
    
    token = response.body.token;
    userId = response.body.user.id;
  });

  it('should reject duplicate email on signup', async () => {
    await request(app)
      .post('/api/auth/signup')
      .send(testUser)
      .expect(400);
  });

  it('should login successfully', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({
        email: testUser.email,
        password: testUser.password,
      })
      .expect(200);

    expect(response.body.user.email).toBe(testUser.email);
    expect(response.body.token).toBeDefined();
  });

  it('should reject invalid password', async () => {
    await request(app)
      .post('/api/auth/login')
      .send({
        email: testUser.email,
        password: 'WrongPassword',
      })
      .expect(401);
  });

  it('should get user profile with valid token', async () => {
    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.email).toBe(testUser.email);
    expect(response.body.name).toBe(testUser.name);
  });

  it('should reject request without token', async () => {
    await request(app)
      .get('/api/auth/me')
      .expect(401);
  });

  it('should reject request with invalid token', async () => {
    await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer invalid_token')
      .expect(401);
  });
});
