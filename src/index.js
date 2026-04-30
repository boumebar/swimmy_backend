const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const poolRoutes = require('./routes/pools');
const bookingRoutes = require('./routes/bookings');
const messageRoutes = require('./routes/messages');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    methods: ['GET', 'POST'],
  },
});

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173'
}));
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/pools', poolRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/messages', messageRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date() });
});

// Socket.io connection
io.on('connection', (socket) => {
  console.log('✅ User connected:', socket.id);

  socket.on('join_user', (userId) => {
    socket.join(`user_${userId}`);
    console.log(`📌 User ${userId} joined room`);
  });

  socket.on('send_message', (data) => {
    const { receiverId, senderId, text } = data;
    console.log(`💬 Message from ${senderId} to ${receiverId}: ${text}`);

    io.to(`user_${receiverId}`).emit(`message_from_${senderId}`, {
      senderId,
      text,
      createdAt: new Date(),
    });

    io.to(`user_${receiverId}`).emit('new_message_received');
  });

  socket.on('leave_user', (userId) => {
    socket.leave(`user_${userId}`);
    console.log(`📌 User ${userId} left room`);
  });

  socket.on('disconnect', () => {
    console.log('❌ User disconnected:', socket.id);
  });
});

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Backend running on http://0.0.0.0:${PORT}`);
  console.log(`📊 Health check: http://0.0.0.0:${PORT}/api/health`);
});

module.exports = io;