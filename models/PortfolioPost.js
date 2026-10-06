const mongoose = require('mongoose');

const MediaSchema = new mongoose.Schema({
  fileId: { type: mongoose.Schema.Types.ObjectId, required: true },
  type: { type: String, enum: ['image', 'video'], required: true },
  name: { type: String, default: '' },
  size: { type: Number, default: 0 }
}, { _id: false });

const PortfolioPostSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, default: '', trim: true, maxlength: 5000 },
  category: { type: String, default: '기타', trim: true, maxlength: 40 },
  media: { type: [MediaSchema], default: [] },
  createdAt: { type: Date, default: Date.now }
});

PortfolioPostSchema.index({ createdAt: -1, _id: -1 });
PortfolioPostSchema.index({ category: 1, createdAt: -1 });

module.exports = mongoose.model('PortfolioPost', PortfolioPostSchema, 'portfolioPosts');

