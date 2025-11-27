import mongoose from 'mongoose';

const { Schema } = mongoose;

const adminLoginAttemptSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    admin: {
      type: Schema.Types.ObjectId,
      ref: 'Admin',
      required: false, // May not exist if email is wrong
    },
    success: {
      type: Boolean,
      required: true,
      default: false,
    },
    failureReason: {
      type: String,
      enum: [
        'INVALID_EMAIL',
        'INVALID_PASSWORD',
        'ACCOUNT_DEACTIVATED',
        'ACCOUNT_LOCKED',
        'TOO_MANY_ATTEMPTS',
        'SERVER_ERROR',
        null
      ],
      default: null,
    },
    ipAddress: {
      type: String,
      required: false,
    },
    userAgent: {
      type: String,
      required: false,
    },
    deviceInfo: {
      browser: String,
      os: String,
      device: String,
    },
    location: {
      country: String,
      city: String,
      region: String,
    },
    attemptNumber: {
      type: Number,
      default: 1,
    },
    isBlocked: {
      type: Boolean,
      default: false,
    },
    blockedUntil: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Index for efficient queries
adminLoginAttemptSchema.index({ email: 1, createdAt: -1 });
adminLoginAttemptSchema.index({ admin: 1, createdAt: -1 });
adminLoginAttemptSchema.index({ success: 1, createdAt: -1 });
adminLoginAttemptSchema.index({ ipAddress: 1, createdAt: -1 });

// Static method to get recent failed attempts for an email
adminLoginAttemptSchema.statics.getRecentFailedAttempts = async function(email, minutes = 15) {
  const cutoffTime = new Date(Date.now() - minutes * 60 * 1000);
  
  return await this.countDocuments({
    email: email.toLowerCase(),
    success: false,
    createdAt: { $gte: cutoffTime },
  });
};

// Static method to check if email is locked
adminLoginAttemptSchema.statics.isEmailLocked = async function(email, maxAttempts = 5, lockoutMinutes = 15) {
  const failedAttempts = await this.getRecentFailedAttempts(email, lockoutMinutes);
  return failedAttempts >= maxAttempts;
};

// Static method to get lockout remaining time
adminLoginAttemptSchema.statics.getLockoutRemainingTime = async function(email, maxAttempts = 5, lockoutMinutes = 15) {
  const cutoffTime = new Date(Date.now() - lockoutMinutes * 60 * 1000);
  
  const lastAttempt = await this.findOne({
    email: email.toLowerCase(),
    success: false,
    createdAt: { $gte: cutoffTime },
  }).sort({ createdAt: -1 });
  
  if (!lastAttempt) return 0;
  
  const failedAttempts = await this.getRecentFailedAttempts(email, lockoutMinutes);
  
  if (failedAttempts < maxAttempts) return 0;
  
  const unlockTime = new Date(lastAttempt.createdAt.getTime() + lockoutMinutes * 60 * 1000);
  const remainingMs = unlockTime.getTime() - Date.now();
  
  return Math.max(0, Math.ceil(remainingMs / 1000 / 60)); // Return minutes
};

// Static method to log a login attempt
adminLoginAttemptSchema.statics.logAttempt = async function(data) {
  const { email, admin, success, failureReason, ipAddress, userAgent, deviceInfo, location } = data;
  
  // Get attempt number for this email in the last 15 minutes
  const recentAttempts = await this.getRecentFailedAttempts(email, 15);
  
  return await this.create({
    email: email.toLowerCase(),
    admin,
    success,
    failureReason,
    ipAddress,
    userAgent,
    deviceInfo,
    location,
    attemptNumber: success ? 1 : recentAttempts + 1,
    isBlocked: recentAttempts >= 4, // Will be blocked on 5th attempt
    blockedUntil: recentAttempts >= 4 ? new Date(Date.now() + 15 * 60 * 1000) : null,
  });
};

// Static method to get login statistics
adminLoginAttemptSchema.statics.getLoginStats = async function(startDate, endDate) {
  const query = {};
  
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(endDate);
  }
  
  const [
    totalAttempts,
    successfulLogins,
    failedAttempts,
    blockedAttempts,
    uniqueEmails,
    uniqueIPs,
  ] = await Promise.all([
    this.countDocuments(query),
    this.countDocuments({ ...query, success: true }),
    this.countDocuments({ ...query, success: false }),
    this.countDocuments({ ...query, isBlocked: true }),
    this.distinct('email', query),
    this.distinct('ipAddress', query),
  ]);
  
  // Get failure reasons breakdown
  const failureReasons = await this.aggregate([
    { $match: { ...query, success: false } },
    { $group: { _id: '$failureReason', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
  
  // Get attempts by hour (last 24 hours)
  const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const attemptsByHour = await this.aggregate([
    { $match: { createdAt: { $gte: last24Hours } } },
    {
      $group: {
        _id: { $hour: '$createdAt' },
        total: { $sum: 1 },
        successful: { $sum: { $cond: ['$success', 1, 0] } },
        failed: { $sum: { $cond: ['$success', 0, 1] } },
      },
    },
    { $sort: { _id: 1 } },
  ]);
  
  // Get top failed emails
  const topFailedEmails = await this.aggregate([
    { $match: { ...query, success: false } },
    { $group: { _id: '$email', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 },
  ]);
  
  // Get top failed IPs
  const topFailedIPs = await this.aggregate([
    { $match: { ...query, success: false, ipAddress: { $ne: null } } },
    { $group: { _id: '$ipAddress', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 },
  ]);
  
  return {
    totalAttempts,
    successfulLogins,
    failedAttempts,
    blockedAttempts,
    successRate: totalAttempts > 0 ? ((successfulLogins / totalAttempts) * 100).toFixed(2) : 0,
    uniqueEmails: uniqueEmails.length,
    uniqueIPs: uniqueIPs.length,
    failureReasons,
    attemptsByHour,
    topFailedEmails,
    topFailedIPs,
  };
};

const AdminLoginAttempt = mongoose.model('AdminLoginAttempt', adminLoginAttemptSchema);
export default AdminLoginAttempt;
