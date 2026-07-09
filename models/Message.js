const mongoose = require('mongoose');

const PollOptionSchema = new mongoose.Schema({
  text: { type: String, required: true },
  voters: { type: [String], default: [] } // 투표한 사람들의 IP 목록 (중복투표 방지)
}, { _id: false });

const MessageSchema = new mongoose.Schema({
  roomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true, index: true },
  type: { type: String, enum: ['text', 'image', 'video', 'poll', 'system'], required: true },
  senderIp: { type: String }, // 관리자/서버 로직 전용, 클라이언트로 전송되지 않음
  senderUid: { type: String }, // 클라이언트에 노출되는 익명 식별자
  senderNickname: { type: String },
  senderAvatar: { type: String },
  content: { type: String, default: '' }, // 텍스트 메세지 내용 or 시스템 메세지 내용
  fileUrl: { type: String, default: '' }, // 이미지/동영상 URL
  poll: {
    question: { type: String },
    options: { type: [PollOptionSchema], default: undefined }
  },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Message', MessageSchema);
