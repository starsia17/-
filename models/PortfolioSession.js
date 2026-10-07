const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  tokenHash: { type: String, required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'PortfolioUser' },
  tabHash: { type: String, required: true },
  mfaSetupSecret: { type: String, select: false },
  mfaSetupExpiresAt: { type: Date },
  remember: { type: Boolean, default: false },
  authVersion: { type: Number, default: 0 },
  lastSeenAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true }
});
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.model('PortfolioSession', schema, 'portfolioSessions');
