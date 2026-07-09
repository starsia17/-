const mongoose = require('mongoose');const RoomSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 50 },
  passwordHash: { type: String, default: null }, // null이면 비밀번호 없음
  creatorIp: { type: String, required: true },
  creatorNickname: { type: String, required: true },
  notice: { type: String, default: '' }, // 관리자 공지사항
  bannedIps: { type: [String], default: [] }, // 강퇴당한 IP 목록
  memberCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});module.exports = mongoose.model('Room', RoomSchema);
