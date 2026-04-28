const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

// Mock app
const app = express();
app.use(express.json());

// Mock database
let messages = [];
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

// POST /messages/:userId
app.post('/api/messages/:userId', authMiddleware, (req, res) => {
    const { userId } = req.params;
    const { text, bookingId } = req.body;
    const senderId = req.user.userId;

    if (!text || text.trim() === '') {
        return res.status(400).json({ error: 'Message text cannot be empty' });
    }

    if (senderId === userId) {
        return res.status(400).json({ error: 'Cannot message yourself' });
    }

    const message = {
        id: 'msg_' + messageCounter++,
        senderId,
        receiverId: userId,
        text,
        bookingId: bookingId || null,
        isRead: false,
        createdAt: new Date(),
    };

    messages.push(message);
    res.json(message);
});

// GET /messages/inbox
app.get('/api/messages/inbox', authMiddleware, (req, res) => {
    const userId = req.user.userId;

    const conversations = messages
        .filter(m => m.senderId === userId || m.receiverId === userId)
        .reduce((acc, msg) => {
            const partnerId = msg.senderId === userId ? msg.receiverId : msg.senderId;
            if (!acc[partnerId]) {
                acc[partnerId] = {
                    partnerId,
                    lastMessage: msg.text,
                    lastMessageTime: msg.createdAt,
                    unreadCount: msg.senderId !== userId && !msg.isRead ? 1 : 0,
                };
            }
            return acc;
        }, {});

    res.json(Object.values(conversations));
});

// GET /messages/:userId (conversation)
app.get('/api/messages/:userId', authMiddleware, (req, res) => {
    const { userId } = req.params;
    const currentUserId = req.user.userId;

    const conversation = messages.filter(m =>
        (m.senderId === currentUserId && m.receiverId === userId) ||
        (m.senderId === userId && m.receiverId === currentUserId)
    );

    // Mark as read
    conversation.forEach(m => {
        if (m.receiverId === currentUserId) {
            m.isRead = true;
        }
    });

    res.json(conversation);
});

// Tests
describe('Messaging System', () => {
    const userAToken = jwt.sign({ userId: 'user_a' }, 'test-secret');
    const userBToken = jwt.sign({ userId: 'user_b' }, 'test-secret');

    beforeEach(() => {
        messages = [];
        messageCounter = 1;
    });

    it('should send a message', async () => {
        const response = await request(app)
            .post('/api/messages/user_b')
            .set('Authorization', `Bearer ${userAToken}`)
            .send({ text: 'Hello user B!' })
            .expect(200);

        expect(response.body.senderId).toBe('user_a');
        expect(response.body.receiverId).toBe('user_b');
        expect(response.body.text).toBe('Hello user B!');
        expect(response.body.isRead).toBe(false);
    });

    it('should reject empty message', async () => {
        await request(app)
            .post('/api/messages/user_b')
            .set('Authorization', `Bearer ${userAToken}`)
            .send({ text: '' })
            .expect(400);
    });

    it('should reject message without text', async () => {
        await request(app)
            .post('/api/messages/user_b')
            .set('Authorization', `Bearer ${userAToken}`)
            .send({})
            .expect(400);
    });

    it('should reject self-messaging', async () => {
        await request(app)
            .post('/api/messages/user_a')
            .set('Authorization', `Bearer ${userAToken}`)
            .send({ text: 'Talking to myself' })
            .expect(400);
    });

    it('should require auth to send message', async () => {
        await request(app)
            .post('/api/messages/user_b')
            .send({ text: 'No token' })
            .expect(401);
    });

    it('should get inbox conversations', async () => {
        // Send a message first
        await request(app)
            .post('/api/messages/user_b')
            .set('Authorization', `Bearer ${userAToken}`)
            .send({ text: 'Message 1' })
            .expect(200);

        const response = await request(app)
            .get('/api/messages/inbox')
            .set('Authorization', `Bearer ${userAToken}`)
            .expect(200);

        expect(Array.isArray(response.body)).toBe(true);
        expect(response.body.length).toBeGreaterThan(0);
    });

    it('should get conversation with specific user', async () => {
        // Send message first
        await request(app)
            .post('/api/messages/user_b')
            .set('Authorization', `Bearer ${userAToken}`)
            .send({ text: 'Test message' })
            .expect(200);

        const response = await request(app)
            .get('/api/messages/user_b')
            .set('Authorization', `Bearer ${userAToken}`)
            .expect(200);

        expect(Array.isArray(response.body)).toBe(true);
        expect(response.body.length).toBeGreaterThan(0);
        expect(response.body[0].text).toBe('Test message');
    });

    it('should mark messages as read', async () => {
        // Send message from A to B
        await request(app)
            .post('/api/messages/user_b')
            .set('Authorization', `Bearer ${userAToken}`)
            .send({ text: 'Message to mark as read' })
            .expect(200);

        // B reads the conversation
        const response = await request(app)
            .get('/api/messages/user_a')
            .set('Authorization', `Bearer ${userBToken}`)
            .expect(200);

        expect(response.body.some(m => m.isRead === true)).toBe(true);
    });

    it('should show unread count in inbox', async () => {
        // A sends unread message to B
        await request(app)
            .post('/api/messages/user_b')
            .set('Authorization', `Bearer ${userAToken}`)
            .send({ text: 'Unread message' })
            .expect(200);

        const response = await request(app)
            .get('/api/messages/inbox')
            .set('Authorization', `Bearer ${userBToken}`)
            .expect(200);

        const convo = response.body.find(c => c.partnerId === 'user_a');
        expect(convo.unreadCount).toBeGreaterThan(0);
    });

    it('should require auth to view inbox', async () => {
        await request(app)
            .get('/api/messages/inbox')
            .expect(401);
    });

    it('should require auth to view conversation', async () => {
        await request(app)
            .get('/api/messages/user_b')
            .expect(401);
    });
});