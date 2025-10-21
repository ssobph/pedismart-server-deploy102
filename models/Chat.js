import mongoose from "mongoose";

const chatSchema = new mongoose.Schema(
  {
    participants: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        role: {
          type: String,
          enum: ["customer", "rider"],
          required: true,
        },
      },
    ],
    lastMessage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
    },
    lastMessageTime: {
      type: Date,
      default: Date.now,
    },
    unreadCount: {
      customer: {
        type: Number,
        default: 0,
      },
      rider: {
        type: Number,
        default: 0,
      },
    },
  },
  {
    timestamps: true,
  }
);

// Index for faster queries
chatSchema.index({ "participants.userId": 1 });
chatSchema.index({ lastMessageTime: -1 });

export default mongoose.model("Chat", chatSchema);
