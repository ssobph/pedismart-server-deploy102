import { StatusCodes } from "http-status-codes";
import Chat from "../models/Chat.js";
import Message from "../models/Message.js";
import User from "../models/User.js";
import { BadRequestError, NotFoundError } from "../errors/index.js";
import cloudinary from "../utils/cloudinary.js";

// Get or create a chat between two users
export const getOrCreateChat = async (req, res) => {
  const { otherUserId, otherUserRole } = req.body;
  const currentUserId = req.user.userId;
  const currentUserRole = req.user.role;

  console.log(`💬 Getting/Creating chat between ${currentUserId} (${currentUserRole}) and ${otherUserId} (${otherUserRole})`);

  // Validate that user is not trying to chat with themselves
  if (currentUserId === otherUserId) {
    throw new BadRequestError("Cannot create chat with yourself");
  }

  // Check if chat already exists
  let chat = await Chat.findOne({
    "participants.userId": { $all: [currentUserId, otherUserId] },
  })
    .populate("participants.userId", "firstName lastName photo role")
    .populate({
      path: "lastMessage",
      select: "content createdAt sender",
    });

  if (chat) {
    console.log(`✅ Found existing chat: ${chat._id}`);
    return res.status(StatusCodes.OK).json({ chat });
  }

  // Create new chat
  chat = await Chat.create({
    participants: [
      { userId: currentUserId, role: currentUserRole },
      { userId: otherUserId, role: otherUserRole },
    ],
  });

  // Populate the newly created chat
  chat = await Chat.findById(chat._id)
    .populate("participants.userId", "firstName lastName photo role")
    .populate("lastMessage");

  console.log(`✅ Created new chat: ${chat._id}`);
  res.status(StatusCodes.CREATED).json({ chat });
};

// Get all chats for current user
export const getMyChats = async (req, res) => {
  const userId = req.user.userId;
  const userRole = req.user.role;

  console.log(`💬 Fetching chats for user ${userId} (${userRole})`);

  // First, check total chats in database
  const totalChats = await Chat.countDocuments();
  console.log(`📊 Total chats in database: ${totalChats}`);

  // CRITICAL FIX: Convert userId to string for comparison
  const userIdString = String(userId);
  console.log(`🔍 Searching for chats with userId: ${userIdString} (type: ${typeof userIdString})`);

  // Check chats with this user as participant (without populate)
  const rawChats = await Chat.find({
    "participants.userId": userId,
  });
  console.log(`🔍 Raw chats found for user ${userId}: ${rawChats.length}`);
  
  // Log raw participant data
  rawChats.forEach((chat, index) => {
    console.log(`📋 Raw Chat ${index + 1}:`, {
      chatId: chat._id,
      participants: chat.participants.map(p => ({
        userId: p.userId,
        userIdType: typeof p.userId,
        role: p.role
      }))
    });
  });

  // FALLBACK: Try finding chats by converting participant IDs to strings
  if (rawChats.length === 0) {
    console.log(`⚠️ No chats found with direct query, trying alternative query...`);
    const allChats = await Chat.find({});
    console.log(`📊 Total chats in DB: ${allChats.length}`);
    
    const matchingChats = allChats.filter(chat => {
      return chat.participants.some(p => String(p.userId) === userIdString);
    });
    console.log(`🔍 Matching chats found with string comparison: ${matchingChats.length}`);
    
    matchingChats.forEach((chat, index) => {
      console.log(`📋 Matching Chat ${index + 1}:`, {
        chatId: chat._id,
        participants: chat.participants.map(p => ({
          userId: String(p.userId),
          role: p.role
        }))
      });
    });
  }

  // Now fetch with population
  const chats = await Chat.find({
    "participants.userId": userId,
  })
    .populate("participants.userId", "firstName lastName photo role vehicleType")
    .populate({
      path: "lastMessage",
      select: "content createdAt sender",
    })
    .sort({ lastMessageTime: -1 });

  console.log(`✅ Found ${chats.length} populated chats for user ${userId}`);
  
  // Debug: Log each chat's participants
  chats.forEach((chat, index) => {
    console.log(`📋 Populated Chat ${index + 1}:`, {
      chatId: chat._id,
      participants: chat.participants.map(p => ({
        userId: p.userId?._id,
        name: `${p.userId?.firstName} ${p.userId?.lastName}`,
        role: p.role
      })),
      lastMessage: chat.lastMessage?.content || 'No messages yet',
      lastMessageTime: chat.lastMessageTime
    });
  });
  
  res.status(StatusCodes.OK).json({ chats, userRole });
};

// Get messages for a specific chat
export const getChatMessages = async (req, res) => {
  const { chatId } = req.params;
  const userId = req.user.userId;
  const { page = 1, limit = 50 } = req.query;

  console.log(`💬 Fetching messages for chat ${chatId}, page ${page}`);

  // Verify user is participant in this chat
  const chat = await Chat.findOne({
    _id: chatId,
    "participants.userId": userId,
  });

  if (!chat) {
    throw new NotFoundError("Chat not found or you don't have access");
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);

  const messages = await Message.find({
    chatId,
    isDeleted: false,
  })
    .populate("sender.userId", "firstName lastName photo")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit));

  const totalMessages = await Message.countDocuments({
    chatId,
    isDeleted: false,
  });

  console.log(`✅ Found ${messages.length} messages (total: ${totalMessages})`);

  res.status(StatusCodes.OK).json({
    messages: messages.reverse(), // Reverse to show oldest first
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total: totalMessages,
      hasMore: skip + messages.length < totalMessages,
    },
  });
};

// Send a message
export const sendMessage = async (req, res) => {
  const { chatId, content } = req.body;
  const userId = req.user.userId;
  const userRole = req.user.role;

  console.log(`💬 Sending message in chat ${chatId} from ${userId}`);

  if (!content || content.trim().length === 0) {
    throw new BadRequestError("Message content cannot be empty");
  }

  // Verify user is participant in this chat
  const chat = await Chat.findOne({
    _id: chatId,
    "participants.userId": userId,
  });

  if (!chat) {
    throw new NotFoundError("Chat not found or you don't have access");
  }

  // Create message
  const message = await Message.create({
    chatId,
    sender: {
      userId,
      role: userRole,
    },
    content: content.trim(),
    messageType: "text",
  });

  // Update chat's last message and timestamp
  chat.lastMessage = message._id;
  chat.lastMessageTime = message.createdAt;

  // Increment unread count for the other participant
  const otherParticipantRole = userRole === "customer" ? "rider" : "customer";
  chat.unreadCount[otherParticipantRole] += 1;

  await chat.save();

  // Populate message before sending
  const populatedMessage = await Message.findById(message._id).populate(
    "sender.userId",
    "firstName lastName photo"
  );

  console.log(`✅ Message sent: ${message._id}`);

  res.status(StatusCodes.CREATED).json({ message: populatedMessage });
};

// Mark messages as read
export const markMessagesAsRead = async (req, res) => {
  const { chatId } = req.body;
  const userId = req.user.userId;
  const userRole = req.user.role;

  console.log(`💬 Marking messages as read in chat ${chatId} for ${userId}`);

  // Verify user is participant in this chat
  const chat = await Chat.findOne({
    _id: chatId,
    "participants.userId": userId,
  });

  if (!chat) {
    throw new NotFoundError("Chat not found or you don't have access");
  }

  // Get unread messages
  const unreadMessages = await Message.find({
    chatId,
    "sender.userId": { $ne: userId },
    "readBy.userId": { $ne: userId },
    isDeleted: false,
  });

  // Mark messages as read
  for (const message of unreadMessages) {
    message.readBy.push({
      userId,
      readAt: new Date(),
    });
    await message.save();
  }

  // Reset unread count for this user
  chat.unreadCount[userRole] = 0;
  await chat.save();

  console.log(`✅ Marked ${unreadMessages.length} messages as read`);

  res.status(StatusCodes.OK).json({
    message: "Messages marked as read",
    count: unreadMessages.length,
  });
};

// Delete a message (soft delete)
export const deleteMessage = async (req, res) => {
  const { messageId } = req.params;
  const userId = req.user.userId;

  console.log(`💬 Deleting message ${messageId}`);

  const message = await Message.findOne({
    _id: messageId,
    "sender.userId": userId,
  });

  if (!message) {
    throw new NotFoundError("Message not found or you don't have permission");
  }

  message.isDeleted = true;
  await message.save();

  console.log(`✅ Message deleted: ${messageId}`);

  res.status(StatusCodes.OK).json({ message: "Message deleted" });
};

// Get chat by ID
export const getChatById = async (req, res) => {
  const { chatId } = req.params;
  const userId = req.user.userId;

  console.log(`💬 Fetching chat ${chatId}`);

  const chat = await Chat.findOne({
    _id: chatId,
    "participants.userId": userId,
  })
    .populate("participants.userId", "firstName lastName photo role vehicleType")
    .populate({
      path: "lastMessage",
      select: "content createdAt sender",
    });

  if (!chat) {
    throw new NotFoundError("Chat not found or you don't have access");
  }

  console.log(`✅ Found chat: ${chatId}`);
  res.status(StatusCodes.OK).json({ chat });
};

// Get all online users (both customers and riders)
export const getOnlineUsers = async (req, res) => {
  try {
    const currentUserId = req.user.userId;
    const currentUserRole = req.user.role;

    console.log(`💬 Fetching online users for ${currentUserId} (${currentUserRole})`);

    // Get the io instance from request
    const io = req.io || req.app.get("io");
    
    if (!io) {
      console.error("❌ Socket.IO instance not found");
      return res.status(StatusCodes.OK).json({
        onlineUsers: [],
        currentUserRole,
        currentUserId, // CRITICAL: Return current user ID even when Socket.IO not found
      });
    }

    const onlineUserIds = new Set();

    // Get all connected sockets using the sockets Map
    const allSockets = io.sockets.sockets;
    
    console.log(`📊 Total connected sockets: ${allSockets.size}`);
    
    // Iterate through all connected sockets
    for (const [socketId, socket] of allSockets) {
      // Check if socket has user data
      if (socket.user && socket.user.id) {
        const socketUserId = String(socket.user.id);
        const currentUserIdStr = String(currentUserId);
        
        // Log for debugging
        if (socketUserId === currentUserIdStr) {
          console.log(`🚫 Skipping current user socket: ${socketUserId}`);
        } else {
          console.log(`✅ Adding online user: ${socketUserId}`);
          onlineUserIds.add(socketUserId);
        }
      }
    }

    console.log(`Found ${onlineUserIds.size} online users (excluding self: ${currentUserId})`);

    // If no online users, return empty array
    if (onlineUserIds.size === 0) {
      console.log(`✅ No other users online`);
      return res.status(StatusCodes.OK).json({
        onlineUsers: [],
        currentUserRole,
        currentUserId, // CRITICAL: Return current user ID even when no online users
      });
    }

    // Fetch user details for online users (excluding current user as extra safety)
    const onlineUsers = await User.find({
      _id: { 
        $in: Array.from(onlineUserIds),
        $ne: currentUserId // Extra safety: exclude current user
      },
    }).select("firstName lastName photo role vehicleType");

    console.log(`✅ Returning ${onlineUsers.length} online users (current user excluded)`);
    console.log(`📤 Response includes currentUserId: ${currentUserId}`);

    res.status(StatusCodes.OK).json({
      onlineUsers,
      currentUserRole,
      currentUserId, // Return current user ID for client-side filtering
    });
  } catch (error) {
    console.error("❌ Error in getOnlineUsers:", error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      message: "Error fetching online users",
      error: error.message,
    });
  }
};

// Upload image for chat
export const uploadChatImage = async (req, res) => {
  try {
    const { chatId } = req.body;
    const userId = req.user.userId;
    const userRole = req.user.role;

    console.log(`📸 User ${userId} uploading image to chat ${chatId}`);
    console.log(`📸 File received:`, req.file ? 'Yes' : 'No');
    console.log(`📸 Cloudinary config:`, {
      cloud_name: process.env.CLOUDINARY_API_NAME ? 'Set' : 'Not set',
      api_key: process.env.CLOUDINARY_API_KEY ? 'Set' : 'Not set',
    });

    if (!req.file) {
      throw new BadRequestError("No image file provided");
    }

    // Verify user is participant in this chat
    const chat = await Chat.findOne({
      _id: chatId,
      "participants.userId": userId,
    });

    if (!chat) {
      // Delete uploaded image from cloudinary if chat validation fails
      if (req.file && req.file.filename) {
        await cloudinary.v2.uploader.destroy(req.file.filename);
      }
      throw new NotFoundError("Chat not found or you don't have access");
    }

    // Create image message
    const message = await Message.create({
      chatId,
      sender: {
        userId,
        role: userRole,
      },
      content: "📷 Image", // Default content for image messages
      messageType: "image",
      imageUrl: req.file.path, // Cloudinary URL
      imagePublicId: req.file.filename, // Cloudinary public ID
    });

    // Update chat's last message and timestamp
    chat.lastMessage = message._id;
    chat.lastMessageTime = message.createdAt;

    // Increment unread count for the other participant
    const otherParticipantRole = userRole === "customer" ? "rider" : "customer";
    chat.unreadCount[otherParticipantRole] += 1;

    await chat.save();

    // Populate message before sending
    const populatedMessage = await Message.findById(message._id).populate(
      "sender.userId",
      "firstName lastName photo"
    );

    // Get socket.io instance and broadcast the image message
    const io = req.io || req.app.get("io");
    if (io) {
      // Broadcast to chat room
      io.to(`chat_${chatId}`).emit("newMessage", populatedMessage);

      // Also send to both participants directly (fallback)
      for (const participant of chat.participants) {
        const participantSockets = await io.in(`user_${participant.userId}`).fetchSockets();
        participantSockets.forEach(sock => {
          sock.emit("newMessage", populatedMessage);
        });
      }

      // Send unread count update to the recipient
      const otherParticipant = chat.participants.find(p => p.userId.toString() !== userId);
      if (otherParticipant) {
        const recipientChats = await Chat.find({
          "participants.userId": otherParticipant.userId,
        });
        
        const totalUnread = recipientChats.reduce((sum, c) => {
          return sum + (c.unreadCount[otherParticipant.role] || 0);
        }, 0);

        io.to(`user_${otherParticipant.userId}`).emit("unreadCountUpdate", {
          unreadCount: totalUnread,
          chatId: chatId,
        });
        
        console.log(`🔔 Sent unread count update to user ${otherParticipant.userId}: ${totalUnread} unread messages`);
      }
    }

    console.log(`✅ Image uploaded and message created: ${message._id}`);

    res.status(StatusCodes.CREATED).json({ 
      message: populatedMessage,
      imageUrl: req.file.path,
    });
  } catch (error) {
    console.error(`❌ Error uploading chat image:`, error);
    console.error(`❌ Error stack:`, error.stack);
    console.error(`❌ Error details:`, {
      message: error.message,
      name: error.name,
      chatId: req.body?.chatId,
      hasFile: !!req.file,
    });
    
    // Clean up uploaded image if there's an error
    if (req.file && req.file.filename) {
      try {
        await cloudinary.v2.uploader.destroy(req.file.filename);
      } catch (cleanupError) {
        console.error(`❌ Error cleaning up image:`, cleanupError);
      }
    }
    
    throw error;
  }
};
