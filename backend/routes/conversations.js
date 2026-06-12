const router = require('express').Router();
const Conversation = require('../models/Conversation');
const { protect } = require('../middleware/auth');
const crypto = require('crypto');

// Apply JWT auth to all conversation routes
router.use(protect);

// NEW CONVERSATION
router.post('/', async (req, res) => {
  const { senderId, receiverId, isGroup, groupName } = req.body;
  
  try {
    if (!isGroup) {
      // Check if conversation already exists between these two
      const existingConv = await Conversation.findOne({
        members: { $all: [senderId, receiverId] },
        isGroup: false
      });
      if (existingConv) return res.status(200).json(existingConv);
    }

    // Generate cryptographically secure random 256-bit key for E2EE
    const key = crypto.randomBytes(32).toString('hex');

    const newConversation = new Conversation({
      members: isGroup ? req.body.members : [senderId, receiverId],
      isGroup: isGroup || false,
      groupName: isGroup ? groupName : "",
      groupAdmin: isGroup ? senderId : null,
      encryptionKey: key
    });

    const savedConversation = await newConversation.save();
    res.status(200).json(savedConversation);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET CONV OF A USER
router.get('/:userId', async (req, res) => {
  try {
    // Only allow the user to fetch their own conversations
    if (req.user._id.toString() !== req.params.userId) {
      return res.status(403).json({ message: "Not authorized to fetch these conversations" });
    }

    let conversations = await Conversation.find({
      members: { $in: [req.params.userId] },
    }).populate('members', 'username profilePicture status').sort({ updatedAt: -1 });

    // Auto-migration: Generate encryptionKey for old conversations that don't have one
    let updated = false;
    for (let conv of conversations) {
      if (!conv.encryptionKey) {
        conv.encryptionKey = crypto.randomBytes(32).toString('hex');
        await conv.save();
        updated = true;
      }
    }

    // Re-fetch populated conversations if any were updated
    if (updated) {
      conversations = await Conversation.find({
        members: { $in: [req.params.userId] },
      }).populate('members', 'username profilePicture status').sort({ updatedAt: -1 });
    }

    res.status(200).json(conversations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ADD MEMBERS TO GROUP
router.put('/:id/members', async (req, res) => {
  try {
    const { newMemberIds } = req.body;
    const conversation = await Conversation.findById(req.params.id);
    if (!conversation) return res.status(404).json({ message: 'Conversation not found' });
    if (!conversation.isGroup) return res.status(400).json({ message: 'Not a group conversation' });

    // Verify req.user is already a member of this group
    const isMember = conversation.members.some(m => m.toString() === req.user._id.toString());
    if (!isMember) {
      return res.status(403).json({ message: 'Not authorized to add members to this group' });
    }

    // Only add members not already in group
    const existing = conversation.members.map(m => m.toString());
    const toAdd = newMemberIds.filter(id => !existing.includes(id));
    conversation.members.push(...toAdd);
    const saved = await conversation.save();
    const populated = await saved.populate('members', 'username profilePicture status');
    res.status(200).json(populated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
