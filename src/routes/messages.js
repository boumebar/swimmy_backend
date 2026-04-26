const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const authMiddleware = require('../middleware/auth');

const prisma = new PrismaClient();

// POST /messages/:userId send
router.post('/:userId', authMiddleware, async (req, res) => {
    try {
        const { userId } = req.params;
        const { text, bookingId } = req.body;
        const senderId = req.user.userId;

        // Validation
        if (!text || text.trim() === '') {
            return res.status(400).json({ error: 'Message text cannot be empty' });
        }

        if (senderId === userId) {
            return res.status(400).json({ error: 'Cannot message yourself' });
        }

        // Create message
        const message = await prisma.message.create({
            data: {
                senderId,
                receiverId: userId,
                text,
                bookingId: bookingId || null,
                isRead: false,
            },
            include: {
                sender: { select: { id: true, name: true, email: true, avatar: true } },
                receiver: { select: { id: true, name: true, email: true } },
            },
        });

        res.json(message);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /messages/inbox - List conversations
router.get('/inbox', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.userId;

        // Get all unique conversations
        const conversations = await prisma.message.findMany({
            where: {
                OR: [{ senderId: userId }, { receiverId: userId }],
            },
            distinct: ['senderId', 'receiverId'],
            orderBy: { createdAt: 'desc' },
            include: {
                sender: { select: { id: true, name: true, avatar: true } },
                receiver: { select: { id: true, name: true, avatar: true } },
            },
        });

        // Group by conversation partner
        const grouped = {};
        conversations.forEach((msg) => {
            const partnerId = msg.senderId === userId ? msg.receiverId : msg.senderId;
            if (!grouped[partnerId]) {
                grouped[partnerId] = {
                    partnerId,
                    partner: msg.senderId === userId ? msg.receiver : msg.sender,
                    lastMessage: msg.text,
                    lastMessageTime: msg.createdAt,
                    unreadCount: msg.senderId !== userId && !msg.isRead ? 1 : 0,
                };
            }
        });

        res.json(Object.values(grouped));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /messages/:userId - Get conversation with user
router.get('/:userId', authMiddleware, async (req, res) => {
    try {
        const { userId } = req.params;
        const currentUserId = req.user.userId;

        const messages = await prisma.message.findMany({
            where: {
                OR: [
                    { senderId: currentUserId, receiverId: userId },
                    { senderId: userId, receiverId: currentUserId },
                ],
            },
            include: {
                sender: { select: { id: true, name: true, avatar: true } },
            },
            orderBy: { createdAt: 'asc' },
        });

        // Mark messages as read
        await prisma.message.updateMany({
            where: {
                senderId: userId,
                receiverId: currentUserId,
                isRead: false,
            },
            data: { isRead: true },
        });

        res.json(messages);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;