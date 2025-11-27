import AuthenticationLog from '../models/AuthenticationLog.js';
import { StatusCodes } from 'http-status-codes';

// Get all authentication logs with filters
export const getAuthenticationLogs = async (req, res) => {
  try {
    const {
      eventType,
      success,
      email,
      userRole,
      startDate,
      endDate,
      ipAddress,
      limit = 100,
      page = 1,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Build query
    const query = {};

    if (eventType) {
      query.eventType = eventType;
    }

    if (success !== undefined && success !== '') {
      query.success = success === 'true';
    }

    if (email) {
      query.email = { $regex: email, $options: 'i' };
    }

    if (userRole && userRole !== 'all') {
      query.userRole = userRole;
    }

    if (ipAddress) {
      query.ipAddress = { $regex: ipAddress, $options: 'i' };
    }

    // Date range filter
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) {
        query.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sortOptions = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    // Execute query with pagination
    const [logs, totalCount] = await Promise.all([
      AuthenticationLog.find(query)
        .populate('user', 'firstName lastName email phone role')
        .populate('admin', 'name username email role')
        .sort(sortOptions)
        .skip(skip)
        .limit(parseInt(limit)),
      AuthenticationLog.countDocuments(query)
    ]);

    res.status(StatusCodes.OK).json({
      logs,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / parseInt(limit)),
        totalCount,
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Error fetching authentication logs:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      message: 'Error fetching authentication logs',
      error: error.message
    });
  }
};

// Get authentication log statistics
export const getAuthenticationStats = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    // Build date filter
    const dateFilter = {};
    if (startDate || endDate) {
      dateFilter.createdAt = {};
      if (startDate) {
        dateFilter.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        dateFilter.createdAt.$lte = end;
      }
    }

    // Get various statistics
    const [
      totalEvents,
      successfulLogins,
      failedLogins,
      passwordResets,
      otpEvents,
      accountLockouts,
      eventsByType,
      eventsByRole,
      recentFailedAttempts,
      topFailedIPs
    ] = await Promise.all([
      // Total events
      AuthenticationLog.countDocuments(dateFilter),
      
      // Successful logins
      AuthenticationLog.countDocuments({ ...dateFilter, eventType: 'LOGIN_SUCCESS' }),
      
      // Failed logins
      AuthenticationLog.countDocuments({ ...dateFilter, eventType: 'LOGIN_FAILED' }),
      
      // Password reset requests
      AuthenticationLog.countDocuments({ ...dateFilter, eventType: 'PASSWORD_RESET_REQUEST' }),
      
      // OTP events
      AuthenticationLog.countDocuments({ 
        ...dateFilter, 
        eventType: { $in: ['OTP_SENT', 'OTP_VERIFIED', 'OTP_FAILED', 'OTP_EXPIRED'] }
      }),
      
      // Account lockouts
      AuthenticationLog.countDocuments({ ...dateFilter, eventType: 'ACCOUNT_LOCKED' }),
      
      // Events by type
      AuthenticationLog.aggregate([
        { $match: dateFilter },
        { $group: { _id: '$eventType', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      
      // Events by role
      AuthenticationLog.aggregate([
        { $match: dateFilter },
        { $group: { _id: '$userRole', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      
      // Recent failed attempts (last 24 hours)
      AuthenticationLog.aggregate([
        { 
          $match: { 
            eventType: 'LOGIN_FAILED',
            createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
          }
        },
        { $group: { _id: '$email', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]),
      
      // Top IPs with failed attempts
      AuthenticationLog.aggregate([
        { 
          $match: { 
            eventType: 'LOGIN_FAILED',
            ipAddress: { $ne: null },
            ...dateFilter
          }
        },
        { $group: { _id: '$ipAddress', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ])
    ]);

    // Calculate success rate
    const totalLoginAttempts = successfulLogins + failedLogins;
    const successRate = totalLoginAttempts > 0 
      ? ((successfulLogins / totalLoginAttempts) * 100).toFixed(2) 
      : 0;

    res.status(StatusCodes.OK).json({
      overview: {
        totalEvents,
        successfulLogins,
        failedLogins,
        passwordResets,
        otpEvents,
        accountLockouts,
        successRate: parseFloat(successRate)
      },
      eventsByType: eventsByType.map(e => ({ type: e._id, count: e.count })),
      eventsByRole: eventsByRole.map(e => ({ role: e._id, count: e.count })),
      recentFailedAttempts: recentFailedAttempts.map(e => ({ email: e._id, count: e.count })),
      topFailedIPs: topFailedIPs.map(e => ({ ip: e._id, count: e.count }))
    });
  } catch (error) {
    console.error('Error fetching authentication stats:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      message: 'Error fetching authentication statistics',
      error: error.message
    });
  }
};

// Get authentication logs for a specific user
export const getUserAuthenticationLogs = async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 50 } = req.query;

    const logs = await AuthenticationLog.find({ user: userId })
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    res.status(StatusCodes.OK).json({ logs });
  } catch (error) {
    console.error('Error fetching user authentication logs:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      message: 'Error fetching user authentication logs',
      error: error.message
    });
  }
};

// Get authentication logs by email
export const getLogsByEmail = async (req, res) => {
  try {
    const { email } = req.params;
    const { limit = 50 } = req.query;

    const logs = await AuthenticationLog.find({ email })
      .populate('user', 'firstName lastName email phone role')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    res.status(StatusCodes.OK).json({ logs });
  } catch (error) {
    console.error('Error fetching logs by email:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      message: 'Error fetching authentication logs by email',
      error: error.message
    });
  }
};

// Export authentication logs as CSV
export const exportAuthenticationLogs = async (req, res) => {
  try {
    const { startDate, endDate, eventType, success } = req.query;

    // Build query
    const query = {};

    if (eventType) {
      query.eventType = eventType;
    }

    if (success !== undefined && success !== '') {
      query.success = success === 'true';
    }

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) {
        query.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }

    const logs = await AuthenticationLog.find(query)
      .populate('user', 'firstName lastName email phone role')
      .sort({ createdAt: -1 })
      .limit(10000); // Limit export to 10k records

    // Generate CSV
    const headers = [
      'Date',
      'Time',
      'Email',
      'User Role',
      'Event Type',
      'Success',
      'Failure Reason',
      'IP Address',
      'User Agent',
      'Description'
    ];

    const rows = logs.map(log => [
      new Date(log.createdAt).toLocaleDateString(),
      new Date(log.createdAt).toLocaleTimeString(),
      log.email,
      log.userRole,
      log.eventType,
      log.success ? 'Yes' : 'No',
      log.failureReason || '',
      log.ipAddress || '',
      log.userAgent || '',
      log.description
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=authentication_logs_${new Date().toISOString().split('T')[0]}.csv`);
    res.status(StatusCodes.OK).send(csvContent);
  } catch (error) {
    console.error('Error exporting authentication logs:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      message: 'Error exporting authentication logs',
      error: error.message
    });
  }
};

// Helper function to log authentication events (used by auth controller)
export const logAuthEvent = async (eventData, req = null) => {
  try {
    // Extract IP and user agent from request if available
    let ipAddress = null;
    let userAgent = null;

    if (req) {
      ipAddress = req.headers['x-forwarded-for'] || 
                  req.connection?.remoteAddress || 
                  req.socket?.remoteAddress ||
                  req.ip;
      userAgent = req.headers['user-agent'];
    }

    const logData = {
      ...eventData,
      ipAddress: eventData.ipAddress || ipAddress,
      userAgent: eventData.userAgent || userAgent
    };

    return await AuthenticationLog.logEvent(logData);
  } catch (error) {
    console.error('Error in logAuthEvent:', error);
    return null;
  }
};
