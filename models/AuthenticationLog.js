import mongoose from 'mongoose';

const { Schema } = mongoose;

const authenticationLogSchema = new Schema(
  {
    // User information (can be null for failed attempts with unknown users)
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    // Admin information (for admin login attempts)
    admin: {
      type: Schema.Types.ObjectId,
      ref: 'Admin',
      default: null
    },
    // Email used in the attempt (stored even if user not found)
    email: {
      type: String,
      required: true
    },
    // User role attempted
    userRole: {
      type: String,
      enum: ['customer', 'rider', 'admin', 'super-admin', 'unknown'],
      default: 'unknown'
    },
    // Type of authentication event
    eventType: {
      type: String,
      required: true,
      enum: [
        'LOGIN_SUCCESS',
        'LOGIN_FAILED',
        'LOGIN_BLOCKED',           // Account locked/disapproved
        'LOGOUT',
        'PASSWORD_RESET_REQUEST',
        'PASSWORD_RESET_SUCCESS',
        'PASSWORD_RESET_FAILED',
        'OTP_SENT',
        'OTP_VERIFIED',
        'OTP_FAILED',
        'OTP_EXPIRED',
        'ACCOUNT_LOCKED',
        'ACCOUNT_UNLOCKED',
        'TOKEN_REFRESH',
        'TOKEN_REFRESH_FAILED',
        'REGISTRATION_SUCCESS',
        'REGISTRATION_FAILED'
      ]
    },
    // Whether the event was successful
    success: {
      type: Boolean,
      required: true
    },
    // Failure reason if applicable
    failureReason: {
      type: String,
      default: null
    },
    // IP address of the request
    ipAddress: {
      type: String,
      default: null
    },
    // User agent string
    userAgent: {
      type: String,
      default: null
    },
    // Device information (parsed from user agent or provided by client)
    deviceInfo: {
      type: {
        deviceType: String,      // mobile, tablet, desktop
        os: String,              // iOS, Android, Windows, etc.
        browser: String,         // Chrome, Safari, etc.
        appVersion: String       // Mobile app version if applicable
      },
      default: {}
    },
    // Session information
    sessionInfo: {
      sessionId: String,
      tokenId: String
    },
    // Geographic location (optional, can be derived from IP)
    location: {
      country: String,
      city: String,
      region: String
    },
    // Additional metadata
    metadata: {
      type: Schema.Types.Mixed,
      default: {}
    },
    // Description of the event
    description: {
      type: String,
      required: true
    }
  },
  {
    timestamps: true,
  }
);

// Indexes for efficient querying
authenticationLogSchema.index({ user: 1, createdAt: -1 });
authenticationLogSchema.index({ admin: 1, createdAt: -1 });
authenticationLogSchema.index({ email: 1, createdAt: -1 });
authenticationLogSchema.index({ eventType: 1, createdAt: -1 });
authenticationLogSchema.index({ success: 1, createdAt: -1 });
authenticationLogSchema.index({ ipAddress: 1, createdAt: -1 });
authenticationLogSchema.index({ createdAt: -1 });

// Static method to log authentication events
authenticationLogSchema.statics.logEvent = async function(eventData) {
  try {
    const log = new this(eventData);
    await log.save();
    console.log(`🔐 Auth Log: ${eventData.eventType} - ${eventData.email} - ${eventData.success ? 'SUCCESS' : 'FAILED'}`);
    return log;
  } catch (error) {
    console.error('Error logging authentication event:', error);
    // Don't throw - logging should not break the main flow
    return null;
  }
};

// Static method to get failed login attempts for an email in last X minutes
authenticationLogSchema.statics.getRecentFailedAttempts = async function(email, minutes = 30) {
  const since = new Date(Date.now() - minutes * 60 * 1000);
  return this.countDocuments({
    email,
    eventType: 'LOGIN_FAILED',
    createdAt: { $gte: since }
  });
};

// Static method to check if account should be locked
authenticationLogSchema.statics.shouldLockAccount = async function(email, maxAttempts = 5, windowMinutes = 30) {
  const failedAttempts = await this.getRecentFailedAttempts(email, windowMinutes);
  return failedAttempts >= maxAttempts;
};

const AuthenticationLog = mongoose.model("AuthenticationLog", authenticationLogSchema);
export default AuthenticationLog;
