const request = require('supertest');
const express = require('express');

// Mock app for testing
const app = express();
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date() });
});

describe('Health Check Endpoint', () => {
  it('should return OK status', async () => {
    const response = await request(app)
      .get('/api/health')
      .expect(200);

    expect(response.body.status).toBe('OK');
    expect(response.body.timestamp).toBeDefined();
  });

  it('should return JSON', async () => {
    const response = await request(app)
      .get('/api/health')
      .expect('Content-Type', /json/);

    expect(response.status).toBe(200);
  });
});
