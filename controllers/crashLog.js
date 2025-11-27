import CrashLog from '../models/CrashLog.js';
import { StatusCodes } from 'http-status-codes';

// Submit a crash report (from mobile app)
export const submitCrashReport = async (req, res) => {
  try {
    const crashData = req.body;

    // Add user info if authenticated
    if (req.user) {
      crashData.user = req.user.id;
      crashData.userEmail = req.user.email;
      crashData.userRole = req.user.role;
    }

    const crash = await CrashLog.logCrash(crashData);

    if (!crash) {
      return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        message: 'Failed to log crash report'
      });
    }

    res.status(StatusCodes.CREATED).json({
      message: 'Crash report submitted successfully',
      crashId: crash._id
    });
  } catch (error) {
    console.error('Error submitting crash report:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      message: 'Error submitting crash report',
      error: error.message
    });
  }
};

// Get all crash logs with filters (admin)
export const getCrashLogs = async (req, res) => {
  try {
    const {
      errorType,
      osName,
      appVersion,
      status,
      isFatal,
      userRole,
      startDate,
      endDate,
      search,
      limit = 100,
      page = 1,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Build query
    const query = {};

    if (errorType) {
      query['errorInfo.errorType'] = errorType;
    }

    if (osName) {
      query['osInfo.osName'] = osName;
    }

    if (appVersion) {
      query['appInfo.appVersion'] = appVersion;
    }

    if (status) {
      query.status = status;
    }

    if (isFatal !== undefined && isFatal !== '') {
      query['errorInfo.isFatal'] = isFatal === 'true';
    }

    if (userRole && userRole !== 'all') {
      query.userRole = userRole;
    }

    if (search) {
      query.$or = [
        { 'errorInfo.errorMessage': { $regex: search, $options: 'i' } },
        { 'errorInfo.errorName': { $regex: search, $options: 'i' } },
        { userEmail: { $regex: search, $options: 'i' } },
        { 'screenInfo.currentScreen': { $regex: search, $options: 'i' } }
      ];
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
      CrashLog.find(query)
        .populate('user', 'firstName lastName email phone role')
        .populate('resolution.resolvedBy', 'name username')
        .sort(sortOptions)
        .skip(skip)
        .limit(parseInt(limit)),
      CrashLog.countDocuments(query)
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
    console.error('Error fetching crash logs:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      message: 'Error fetching crash logs',
      error: error.message
    });
  }
};

// Get crash log statistics
export const getCrashStats = async (req, res) => {
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
      totalCrashes,
      fatalCrashes,
      newCrashes,
      resolvedCrashes,
      crashesByType,
      crashesByOS,
      crashesByVersion,
      crashesByStatus,
      recentCrashes,
      topCrashingScreens,
      affectedUsers
    ] = await Promise.all([
      // Total crashes
      CrashLog.countDocuments(dateFilter),
      
      // Fatal crashes
      CrashLog.countDocuments({ ...dateFilter, 'errorInfo.isFatal': true }),
      
      // New crashes
      CrashLog.countDocuments({ ...dateFilter, status: 'new' }),
      
      // Resolved crashes
      CrashLog.countDocuments({ ...dateFilter, status: 'resolved' }),
      
      // Crashes by type
      CrashLog.aggregate([
        { $match: dateFilter },
        { $group: { _id: '$errorInfo.errorType', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      
      // Crashes by OS
      CrashLog.aggregate([
        { $match: dateFilter },
        { $group: { _id: '$osInfo.osName', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      
      // Crashes by app version
      CrashLog.aggregate([
        { $match: dateFilter },
        { $group: { _id: '$appInfo.appVersion', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]),
      
      // Crashes by status
      CrashLog.aggregate([
        { $match: dateFilter },
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      
      // Recent crashes (last 24 hours)
      CrashLog.countDocuments({
        createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
      }),
      
      // Top crashing screens
      CrashLog.aggregate([
        { $match: { ...dateFilter, 'screenInfo.currentScreen': { $ne: null } } },
        { $group: { _id: '$screenInfo.currentScreen', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]),
      
      // Unique affected users
      CrashLog.distinct('user', { ...dateFilter, user: { $ne: null } })
    ]);

    // Calculate crash-free rate (mock - would need total sessions in real implementation)
    const crashFreeRate = totalCrashes > 0 ? 
      Math.max(0, 100 - (fatalCrashes / Math.max(totalCrashes, 1) * 10)).toFixed(2) : 100;

    res.status(StatusCodes.OK).json({
      overview: {
        totalCrashes,
        fatalCrashes,
        nonFatalCrashes: totalCrashes - fatalCrashes,
        newCrashes,
        resolvedCrashes,
        recentCrashes,
        affectedUsers: affectedUsers.length,
        crashFreeRate: parseFloat(crashFreeRate)
      },
      crashesByType: crashesByType.map(e => ({ type: e._id || 'unknown', count: e.count })),
      crashesByOS: crashesByOS.map(e => ({ os: e._id || 'unknown', count: e.count })),
      crashesByVersion: crashesByVersion.map(e => ({ version: e._id || 'unknown', count: e.count })),
      crashesByStatus: crashesByStatus.map(e => ({ status: e._id || 'unknown', count: e.count })),
      topCrashingScreens: topCrashingScreens.map(e => ({ screen: e._id, count: e.count }))
    });
  } catch (error) {
    console.error('Error fetching crash stats:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      message: 'Error fetching crash statistics',
      error: error.message
    });
  }
};

// Get a single crash log by ID
export const getCrashLogById = async (req, res) => {
  try {
    const { id } = req.params;

    const crash = await CrashLog.findById(id)
      .populate('user', 'firstName lastName email phone role')
      .populate('resolution.resolvedBy', 'name username');

    if (!crash) {
      return res.status(StatusCodes.NOT_FOUND).json({
        message: 'Crash log not found'
      });
    }

    res.status(StatusCodes.OK).json({ crash });
  } catch (error) {
    console.error('Error fetching crash log:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      message: 'Error fetching crash log',
      error: error.message
    });
  }
};

// Update crash log status
export const updateCrashStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes, fixVersion } = req.body;

    const updateData = { status };

    if (status === 'resolved') {
      updateData.resolution = {
        resolvedBy: req.user?.id,
        resolvedAt: new Date(),
        notes,
        fixVersion
      };
    }

    const crash = await CrashLog.findByIdAndUpdate(
      id,
      updateData,
      { new: true }
    ).populate('resolution.resolvedBy', 'name username');

    if (!crash) {
      return res.status(StatusCodes.NOT_FOUND).json({
        message: 'Crash log not found'
      });
    }

    res.status(StatusCodes.OK).json({
      message: 'Crash status updated successfully',
      crash
    });
  } catch (error) {
    console.error('Error updating crash status:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      message: 'Error updating crash status',
      error: error.message
    });
  }
};

// Get similar crashes (by crash hash)
export const getSimilarCrashes = async (req, res) => {
  try {
    const { id } = req.params;

    const crash = await CrashLog.findById(id);
    if (!crash) {
      return res.status(StatusCodes.NOT_FOUND).json({
        message: 'Crash log not found'
      });
    }

    const similarCrashes = await CrashLog.find({
      crashHash: crash.crashHash,
      _id: { $ne: id }
    })
      .sort({ createdAt: -1 })
      .limit(20)
      .select('createdAt userEmail osInfo.osName appInfo.appVersion status');

    res.status(StatusCodes.OK).json({
      count: similarCrashes.length,
      crashes: similarCrashes
    });
  } catch (error) {
    console.error('Error fetching similar crashes:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      message: 'Error fetching similar crashes',
      error: error.message
    });
  }
};

// Export crash logs as CSV
export const exportCrashLogs = async (req, res) => {
  try {
    const { startDate, endDate, status, errorType } = req.query;

    // Build query
    const query = {};

    if (status) {
      query.status = status;
    }

    if (errorType) {
      query['errorInfo.errorType'] = errorType;
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

    const logs = await CrashLog.find(query)
      .populate('user', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .limit(10000);

    // Generate CSV
    const headers = [
      'Date',
      'Time',
      'User Email',
      'User Role',
      'Error Type',
      'Error Name',
      'Error Message',
      'OS',
      'OS Version',
      'App Version',
      'Device',
      'Screen',
      'Is Fatal',
      'Status'
    ];

    const rows = logs.map(log => [
      new Date(log.createdAt).toLocaleDateString(),
      new Date(log.createdAt).toLocaleTimeString(),
      log.userEmail || '',
      log.userRole || '',
      log.errorInfo?.errorType || '',
      log.errorInfo?.errorName || '',
      (log.errorInfo?.errorMessage || '').substring(0, 200),
      log.osInfo?.osName || '',
      log.osInfo?.osVersion || '',
      log.appInfo?.appVersion || '',
      log.deviceInfo?.deviceModel || '',
      log.screenInfo?.currentScreen || '',
      log.errorInfo?.isFatal ? 'Yes' : 'No',
      log.status || ''
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=crash_logs_${new Date().toISOString().split('T')[0]}.csv`);
    res.status(StatusCodes.OK).send(csvContent);
  } catch (error) {
    console.error('Error exporting crash logs:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      message: 'Error exporting crash logs',
      error: error.message
    });
  }
};

// Delete old crash logs (cleanup)
export const deleteOldCrashLogs = async (req, res) => {
  try {
    const { daysOld = 90 } = req.query;
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - parseInt(daysOld));

    const result = await CrashLog.deleteMany({
      createdAt: { $lt: cutoffDate },
      status: { $in: ['resolved', 'ignored', 'duplicate'] }
    });

    res.status(StatusCodes.OK).json({
      message: `Deleted ${result.deletedCount} old crash logs`,
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error('Error deleting old crash logs:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      message: 'Error deleting old crash logs',
      error: error.message
    });
  }
};
