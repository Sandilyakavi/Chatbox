const router = require('express').Router();
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const { protect } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage });

// Apply JWT auth to all message routes
router.use(protect);

// UPLOAD FILE
router.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
  res.status(200).json({ url: `/uploads/${req.file.filename}` });
});

// ADD MESSAGE
router.post('/', async (req, res) => {
  const newMessage = new Message(req.body);
  try {
    // Verify user is member of conversation they are trying to post to
    const conversation = await Conversation.findById(req.body.conversationId);
    if (!conversation) return res.status(404).json({ message: 'Conversation not found' });
    
    const isMember = conversation.members.some(m => m.toString() === req.user._id.toString());
    if (!isMember) return res.status(403).json({ message: 'Not authorized to send messages to this conversation' });

    const saved = await newMessage.save();
    await Conversation.findByIdAndUpdate(req.body.conversationId, { updatedAt: Date.now() });
    res.status(200).json(saved);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET MESSAGES
router.get('/:conversationId', async (req, res) => {
  try {
    // Verify conversation exists and req.user is a member
    const conversation = await Conversation.findById(req.params.conversationId);
    if (!conversation) return res.status(404).json({ message: 'Conversation not found' });

    const isMember = conversation.members.some(m => m.toString() === req.user._id.toString());
    if (!isMember) {
      return res.status(403).json({ message: 'Not authorized to view messages in this conversation' });
    }

    const messages = await Message.find({ conversationId: req.params.conversationId })
      .populate('sender', 'username profilePicture');
    res.status(200).json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE MESSAGE
router.delete('/:messageId', async (req, res) => {
  try {
    const msg = await Message.findById(req.params.messageId);
    if (!msg) return res.status(404).json({ message: 'Message not found' });

    // Verify req.user is the sender of the message
    if (msg.sender.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to delete this message' });
    }

    await Message.findByIdAndDelete(req.params.messageId);
    res.status(200).json({ message: 'Message deleted successfully', messageId: req.params.messageId, conversationId: msg.conversationId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// REACT TO MESSAGE
router.put('/:messageId/react', async (req, res) => {
  try {
    const { userId, emoji } = req.body;
    // Verify req.user is the one reacting
    if (req.user._id.toString() !== userId) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const msg = await Message.findById(req.params.messageId);
    if (!msg) return res.status(404).json({ message: 'Message not found' });
    if (!msg.reactions) msg.reactions = new Map();
    msg.reactions.set(userId, emoji);
    await msg.save();
    res.status(200).json(msg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
