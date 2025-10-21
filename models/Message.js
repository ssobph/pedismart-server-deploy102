import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    chatId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Chat",
      required: true,
    },
    sender: {
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
    content: {
      type: String,
      required: function() {
        return this.messageType === "text" || this.messageType === "system";
      },
      trim: true,
      maxlength: 2000,
    },
    messageType: {
      type: String,
      enum: ["text", "image", "system"],
      default: "text",
    },
    imageUrl: {
      type: String,
      default: null,
    },
    imagePublicId: {
      type: String,
      default: null,
    },
    readBy: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        readAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Index for faster queries
messageSchema.index({ chatId: 1, createdAt: -1 });
messageSchema.index({ "sender.userId": 1 });

export default mongoose.model("Message", messageSchema);
