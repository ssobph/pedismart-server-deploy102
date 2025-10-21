import express from "express";
import {
  getOrCreateChat,
  getMyChats,
  getChatMessages,
  sendMessage,
  markMessagesAsRead,
  deleteMessage,
  getChatById,
  getOnlineUsers,
  uploadChatImage,
} from "../controllers/chat.js";
import { upload } from "../utils/cloudinary.js";

const router = express.Router();

// Get or create a chat
router.post("/chat", getOrCreateChat);

// Get all chats for current user
router.get("/chats", getMyChats);

// Get all online users
router.get("/online-users", getOnlineUsers);

// Get specific chat by ID
router.get("/chat/:chatId", getChatById);

// Get messages for a chat
router.get("/chat/:chatId/messages", getChatMessages);

// Send a message
router.post("/message", sendMessage);

// Upload image message
router.post("/message/image", upload.single('image'), uploadChatImage);

// Mark messages as read
router.post("/messages/read", markMessagesAsRead);

// Delete a message
router.delete("/message/:messageId", deleteMessage);

export default router;
