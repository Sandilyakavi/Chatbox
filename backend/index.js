const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const dotenv = require('dotenv');
const connectDB = require('./config/db');

dotenv.config();

const app = express();
const server = http.createServer(app);

// Connect to Database
connectDB();

const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
  },
});

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/conversations', require('./routes/conversations'));

// Socket.io Logic & Security Middleware
const jwt = require('jsonwebtoken');
const Conversation = require('./models/Conversation');
const onlineUsers = new Map();

io.use((socket, next) => {
  if (socket.handshake.auth && socket.handshake.auth.token) {
    jwt.verify(socket.handshake.auth.token, process.env.JWT_SECRET, (err, decoded) => {
      if (err) return next(new Error('Authentication error'));
      socket.decoded = decoded;
      next();
    });
  } else {
    next(new Error('Authentication error'));
  }
});

io.on('connection', (socket) => {
  const currentUserId = socket.decoded?.id;
  console.log('A user connected:', currentUserId, socket.id);

  if (currentUserId) {
    onlineUsers.set(currentUserId, socket.id);
    io.emit('getUsers', Array.from(onlineUsers.keys()));
  }

  // Keep addUser handler for compatibility, but onlineUsers is already populated on connection
  socket.on('addUser', (userId) => {
    if (userId) {
      onlineUsers.set(userId, socket.id);
      io.emit('getUsers', Array.from(onlineUsers.keys()));
    }
  });

  // Securely join room for each conversation
  socket.on('joinRooms', async (conversationIds) => {
    try {
      if (!currentUserId || !Array.isArray(conversationIds)) return;
      
      // Verify user is a member of the conversations they are attempting to join
      const validConvs = await Conversation.find({
        _id: { $in: conversationIds },
        members: currentUserId
      });
      
      validConvs.forEach(conv => {
        socket.join(conv._id.toString());
      });
    } catch (err) {
      console.error('Error joining rooms:', err);
    }
  });

  // Securely broadcast new message to conversation room
  socket.on('sendMessage', async ({ senderId, senderName, text, conversationId, fileUrl, fileType, messageId }) => {
    try {
      if (!currentUserId) return;
      
      // Verify sender is indeed a member of this conversation
      const conversation = await Conversation.findOne({ _id: conversationId, members: currentUserId });
      if (!conversation) return;

      // Broadcast message to everyone in the room (including sender on other tabs/devices)
      io.to(conversationId).emit('getMessage', {
        senderId, senderName, text, conversationId, fileUrl, fileType, messageId, createdAt: Date.now()
      });
    } catch (err) {
      console.error('Error sending message:', err);
    }
  });

  // Securely broadcast message deletion to conversation room
  socket.on('deleteMessage', async ({ messageId, conversationId }) => {
    try {
      if (!currentUserId) return;
      
      // Verify user is a member of this conversation
      const conversation = await Conversation.findOne({ _id: conversationId, members: currentUserId });
      if (!conversation) return;

      io.to(conversationId).emit('messageDeleted', { messageId, conversationId });
    } catch (err) {
      console.error('Error deleting message:', err);
    }
  });

  // Securely broadcast group update to conversation room (e.g. member added)
  socket.on('groupUpdate', async ({ conversationId, updatedConversation }) => {
    try {
      if (!currentUserId) return;

      // Verify user is a member of this conversation
      const conversation = await Conversation.findOne({ _id: conversationId, members: currentUserId });
      if (!conversation) return;

      // Emit to everyone in the room
      io.to(conversationId).emit('groupUpdated', { conversationId, updatedConversation });
    } catch (err) {
      console.error('Error in group update:', err);
    }
  });

  socket.on('typing', ({ conversationId, userId }) => {
    socket.broadcast.to(conversationId).emit('typing', { conversationId, userId });
  });

  socket.on('stopTyping', ({ conversationId }) => {
    socket.broadcast.to(conversationId).emit('stopTyping', { conversationId });
  });

  socket.on('disconnect', () => {
    console.log('A user disconnected!', socket.id);
    for (let [key, value] of onlineUsers.entries()) {
      if (value === socket.id) {
        onlineUsers.delete(key);
        break;
      }
    }
    io.emit('getUsers', Array.from(onlineUsers.keys()));
  });

  // ── WebRTC Signaling (native RTCPeerConnection) ──────────────
  socket.on('callUser', ({ to, from, offer, isVideo }) => {
    const toSocket = onlineUsers.get(to);
    const callerName = [...onlineUsers.entries()].find(([,s]) => s === socket.id)?.[0] || 'Someone';
    if (toSocket) io.to(toSocket).emit('callUser', { from, name: callerName, offer, isVideo });
  });

  socket.on('answerCall', ({ to, answer }) => {
    const toSocket = onlineUsers.get(to);
    if (toSocket) io.to(toSocket).emit('callAnswered', { answer });
  });

  socket.on('iceCandidate', ({ to, candidate }) => {
    const toSocket = onlineUsers.get(to);
    if (toSocket) io.to(toSocket).emit('iceCandidate', { candidate });
  });

  socket.on('endCall', ({ to }) => {
    const toSocket = onlineUsers.get(to);
    if (toSocket) io.to(toSocket).emit('callEnded');
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
