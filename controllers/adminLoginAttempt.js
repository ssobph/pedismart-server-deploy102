import AdminLoginAttempt from '../models/AdminLoginAttempt.js';
import { StatusCodes } from 'http-status-codes';

// Get all login attempts with filters
export const getLoginAttempts = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      email,
      success,
      startDate,
      endDate,
      ipAddress,
      isBlocked,
    } = req.query;

    const query = {};

    if (email) {
      query.email = { $regex: email, $options: 'i' };
    }

    if (success !== undefined) {
      query.success = success === 'true';
    }

    if (isBlocked !== undefined) {
      query.isBlocked = isBlocked === 'true';
    }

    if (ipAddress) {
      query.ipAddress = { $regex: ipAddress, $options: 'i' };
    }

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [attempts, total] = await Promise.all([
      AdminLoginAttempt.find(query)
        .populate('admin', 'name username email role')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      AdminLoginAttempt.countDocuments(query),
    ]);

    res.status(StatusCodes.OK).json({
      success: true,
      attempts,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Error fetching login attempts:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error fetching login attempts',
      error: error.message,
    });
  }
};

// Get login statistics
export const getLoginStats = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const stats = await AdminLoginAttempt.getLoginStats(startDate, endDate);

    // Get recent blocked accounts
    const recentBlocked = await AdminLoginAttempt.find({
      isBlocked: true,
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    })
      .sort({ createdAt: -1 })
      .limit(10)
      .select('email ipAddress createdAt blockedUntil attemptNumber');

    // Get currently locked emails
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    const currentlyLocked = await AdminLoginAttempt.aggregate([
      {
        $match: {
          success: false,
          createdAt: { $gte: fifteenMinutesAgo },
        },
      },
      {
        $group: {
          _id: '$email',
          count: { $sum: 1 },
          lastAttempt: { $max: '$createdAt' },
        },
      },
      {
        $match: { count: { $gte: 5 } },
      },
      {
        $project: {
          email: '$_id',
          failedAttempts: '$count',
          lastAttempt: 1,
          unlocksAt: {
            $add: ['$lastAttempt', 15 * 60 * 1000],
          },
        },
      },
    ]);

    res.status(StatusCodes.OK).json({
      success: true,
      stats: {
        ...stats,
        recentBlocked,
        currentlyLocked,
      },
    });
  } catch (error) {
    console.error('Error fetching login stats:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error fetching login statistics',
      error: error.message,
    });
  }
};

// Get attempts for a specific email
export const getAttemptsByEmail = async (req, res) => {
  try {
    const { email } = req.params;
    const { limit = 50 } = req.query;

    const attempts = await AdminLoginAttempt.find({
      email: email.toLowerCase(),
    })
      .populate('admin', 'name username email role')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    const failedCount = await AdminLoginAttempt.getRecentFailedAttempts(email, 15);
    const isLocked = await AdminLoginAttempt.isEmailLocked(email);
    const lockoutRemaining = await AdminLoginAttempt.getLockoutRemainingTime(email);

    res.status(StatusCodes.OK).json({
      success: true,
      email,
      attempts,
      recentFailedAttempts: failedCount,
      isLocked,
      lockoutRemainingMinutes: lockoutRemaining,
    });
  } catch (error) {
    console.error('Error fetching attempts by email:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error fetching login attempts',
      error: error.message,
    });
  }
};

// Unlock an email manually
export const unlockEmail = async (req, res) => {
  try {
    const { email } = req.params;

    // Delete recent failed attempts to unlock
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    
    await AdminLoginAttempt.updateMany(
      {
        email: email.toLowerCase(),
        success: false,
        createdAt: { $gte: fifteenMinutesAgo },
      },
      {
        $set: {
          isBlocked: false,
          blockedUntil: null,
        },
      }
    );

    res.status(StatusCodes.OK).json({
      success: true,
      message: `Email ${email} has been unlocked`,
    });
  } catch (error) {
    console.error('Error unlocking email:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error unlocking email',
      error: error.message,
    });
  }
};

// Export login attempts as CSV
export const exportLoginAttempts = async (req, res) => {
  try {
    const { startDate, endDate, success, email } = req.query;

    const query = {};

    if (email) {
      query.email = { $regex: email, $options: 'i' };
    }

    if (success !== undefined) {
      query.success = success === 'true';
    }

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const attempts = await AdminLoginAttempt.find(query)
      .populate('admin', 'name username email role')
      .sort({ createdAt: -1 })
      .limit(10000);

    // Generate CSV
    const headers = [
      'Date',
      'Time',
      'Email',
      'Admin Name',
      'Success',
      'Failure Reason',
      'IP Address',
      'User Agent',
      'Attempt Number',
      'Blocked',
    ];

    const rows = attempts.map((attempt) => [
      new Date(attempt.createdAt).toLocaleDateString(),
      new Date(attempt.createdAt).toLocaleTimeString(),
      attempt.email,
      attempt.admin?.name || 'N/A',
      attempt.success ? 'Yes' : 'No',
      attempt.failureReason || 'N/A',
      attempt.ipAddress || 'N/A',
      attempt.userAgent || 'N/A',
      attempt.attemptNumber,
      attempt.isBlocked ? 'Yes' : 'No',
    ]);

    const csv = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=admin_login_attempts.csv');
    res.status(StatusCodes.OK).send(csv);
  } catch (error) {
    console.error('Error exporting login attempts:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error exporting login attempts',
      error: error.message,
    });
  }
};

// Clear old login attempts (cleanup)
export const clearOldAttempts = async (req, res) => {
  try {
    const { daysOld = 30 } = req.body;

    const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);

    const result = await AdminLoginAttempt.deleteMany({
      createdAt: { $lt: cutoffDate },
    });

    res.status(StatusCodes.OK).json({
      success: true,
      message: `Deleted ${result.deletedCount} login attempts older than ${daysOld} days`,
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    console.error('Error clearing old attempts:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error clearing old login attempts',
      error: error.message,
    });
  }
};
