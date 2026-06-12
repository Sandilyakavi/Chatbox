const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
  members: {
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    required: true,
  },
  isGroup: {
    type: Boolean,
    default: false,
  },
  groupName: {
    type: String,
  },
  groupAdmin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  encryptionKey: {
    type: String
  }
}, { timestamps: true });

module.exports = mongoose.model('Conversation', conversationSchema);
