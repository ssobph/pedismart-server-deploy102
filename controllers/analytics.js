import User from '../models/User.js';
import Ride from '../models/Ride.js';
import { StatusCodes } from 'http-status-codes';

// Helper function to get date range based on filter
const getDateRange = (filter) => {
  const now = new Date();
  const endDate = now;
  let startDate;

  switch (filter) {
    case '24h':
      startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      break;
    case 'week':
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case 'month':
      startDate = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
      break;
    default:
      startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000); // Default to 24h
  }

  return { startDate, endDate };
};

// Get user statistics (gender distribution)
export const getUserStats = async (req, res) => {
  try {
    const { timeFilter = '24h' } = req.query;
    const { startDate, endDate } = getDateRange(timeFilter);

    // Get gender distribution - all users, not time-filtered
    const genderStats = await User.aggregate([
      {
        $match: {
          role: { $ne: 'admin' }
        }
      },
      {
        $group: {
          _id: { $ifNull: ['$sex', 'unknown'] },
          count: { $sum: 1 }
        }
      }
    ]);

    // Get role distribution - all users, not time-filtered
    const roleStats = await User.aggregate([
      {
        $match: {
          role: { $ne: 'admin' }
        }
      },
      {
        $group: {
          _id: '$role',
          count: { $sum: 1 }
        }
      }
    ]);

    // Format the response
    const formattedGenderStats = {
      male: 0,
      female: 0
    };

    genderStats.forEach(stat => {
      if (stat._id) {
        formattedGenderStats[stat._id] = stat.count;
      }
    });

    const formattedRoleStats = {
      customer: 0,
      rider: 0
    };

    roleStats.forEach(stat => {
      if (stat._id && stat._id !== 'admin') {
        formattedRoleStats[stat._id] = stat.count;
      }
    });

    // Get total users
    const totalUsers = await User.countDocuments({
      role: { $ne: 'admin' }
    });

    // Get new users in the time period
    const newUsers = await User.countDocuments({
      createdAt: { $gte: startDate, $lte: endDate },
      role: { $ne: 'admin' }
    });

    res.status(StatusCodes.OK).json({
      timeFilter,
      period: {
        start: startDate,
        end: endDate
      },
      totalUsers,
      newUsers,
      genderDistribution: formattedGenderStats,
      roleDistribution: formattedRoleStats
    });
  } catch (error) {
    console.error('Error fetching user statistics:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      message: 'Failed to fetch user statistics',
      error: error.message
    });
  }
};

// Get ride statistics (vehicle types, etc.)
export const getRideStats = async (req, res) => {
  try {
    const { timeFilter = '24h' } = req.query;
    const { startDate, endDate } = getDateRange(timeFilter);

    // Get vehicle type distribution
    const vehicleStats = await Ride.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: { $ifNull: ['$vehicle', 'unknown'] },
          count: { $sum: 1 },
          totalFare: { $sum: { $ifNull: ['$fare', 0] } },
          totalDistance: { $sum: { $ifNull: ['$distance', 0] } }
        }
      }
    ]);

    // Get ride status distribution
    const statusStats = await Ride.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    // Format vehicle stats
    const formattedVehicleStats = {
      "Single Motorcycle": { count: 0, totalFare: 0, totalDistance: 0 },
      "Tricycle": { count: 0, totalFare: 0, totalDistance: 0 },
      "Cab": { count: 0, totalFare: 0, totalDistance: 0 }
    };

    vehicleStats.forEach(stat => {
      if (stat._id && formattedVehicleStats.hasOwnProperty(stat._id)) {
        formattedVehicleStats[stat._id] = {
          count: stat.count,
          totalFare: stat.totalFare || 0,
          totalDistance: stat.totalDistance || 0
        };
      } else if (stat._id === 'unknown') {
        console.log(`Found ${stat.count} rides with unknown vehicle type`);
      }
    });

    // Format status stats
    const formattedStatusStats = {
      SEARCHING_FOR_RIDER: 0,
      START: 0,
      ARRIVED: 0,
      COMPLETED: 0
    };

    statusStats.forEach(stat => {
      if (stat._id) {
        formattedStatusStats[stat._id] = stat.count;
      }
    });

    // Get total rides in the time period
    const totalRides = await Ride.countDocuments({
      createdAt: { $gte: startDate, $lte: endDate }
    });

    // Get total revenue in the time period
    const revenueResult = await Ride.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate },
          status: 'COMPLETED'
        }
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$fare' },
          totalDistance: { $sum: '$distance' },
          count: { $sum: 1 }
        }
      }
    ]);

    const totalRevenue = revenueResult.length > 0 ? revenueResult[0].totalRevenue : 0;
    const totalDistance = revenueResult.length > 0 ? revenueResult[0].totalDistance : 0;
    const completedRides = revenueResult.length > 0 ? revenueResult[0].count : 0;

    res.status(StatusCodes.OK).json({
      timeFilter,
      period: {
        start: startDate,
        end: endDate
      },
      totalRides,
      completedRides,
      totalRevenue,
      totalDistance,
      vehicleDistribution: formattedVehicleStats,
      statusDistribution: formattedStatusStats
    });
  } catch (error) {
    console.error('Error fetching ride statistics:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      message: 'Failed to fetch ride statistics',
      error: error.message
    });
  }
};

// Get combined analytics data
export const getCombinedAnalytics = async (req, res) => {
  try {
    const { timeFilter = '24h' } = req.query;
    const { startDate, endDate } = getDateRange(timeFilter);

    // Get all users statistics (not time-filtered for user counts)
    const userStats = await User.aggregate([
      {
        $match: {
          role: { $ne: 'admin' }
        }
      },
      {
        $group: {
          _id: {
            role: '$role',
            sex: '$sex'
          },
          count: { $sum: 1 }
        }
      }
    ]);

    // Get rider vehicle type statistics (all riders, not time-filtered)
    const riderVehicleStats = await User.aggregate([
      {
        $match: {
          role: 'rider',
        }
      },
      {
        $group: {
          _id: { $ifNull: ['$vehicleType', 'Unknown'] },
          count: { $sum: 1 }
        }
      }
    ]);

    // Get ride statistics
    const rideStats = await Ride.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: '$vehicle',
          count: { $sum: 1 },
          totalFare: { $sum: '$fare' },
          totalDistance: { $sum: '$distance' }
        }
      }
    ]);

    // Format user stats
    const formattedUserStats = {
      gender: {
        male: {
          customer: 0,
          rider: 0,
          total: 0
        },
        female: {
          customer: 0,
          rider: 0,
          total: 0
        },
        total: {
          customer: 0,
          rider: 0,
          total: 0
        }
      }
    };

    userStats.forEach(stat => {
      const role = stat._id.role;
      const sex = stat._id.sex || 'unknown';
      
      if (role !== 'admin') {
        // Initialize the gender category if it doesn't exist
        if (sex !== 'male' && sex !== 'female') {
          // Skip unknown gender or add to a separate category if needed
          return;
        }
        
        // Make sure the role is valid
        if (role !== 'customer' && role !== 'rider') {
          return;
        }
        
        formattedUserStats.gender[sex][role] = stat.count;
        formattedUserStats.gender[sex].total += stat.count;
        formattedUserStats.gender.total[role] += stat.count;
        formattedUserStats.gender.total.total += stat.count;
      }
    });

    // Format vehicle stats
    const formattedVehicleStats = {
      riders: {
        'Single Motorcycle': 0,
        'Tricycle': 0,
        'Cab': 0
      },
      rides: {
        "Single Motorcycle": { count: 0, totalFare: 0, totalDistance: 0 },
        "Tricycle": { count: 0, totalFare: 0, totalDistance: 0 },
        "Cab": { count: 0, totalFare: 0, totalDistance: 0 }
      }
    };

    riderVehicleStats.forEach(stat => {
      if (stat._id && formattedVehicleStats.riders.hasOwnProperty(stat._id)) {
        formattedVehicleStats.riders[stat._id] = stat.count;
      } else if (stat._id === 'Unknown') {
        // Distribute unknown vehicle types proportionally or add a new category
        // For now, we'll just log them
        console.log(`Found ${stat.count} riders with unknown vehicle type`);
      }
    });

    rideStats.forEach(stat => {
      if (stat._id && formattedVehicleStats.rides.hasOwnProperty(stat._id)) {
        formattedVehicleStats.rides[stat._id] = {
          count: stat.count,
          totalFare: stat.totalFare || 0,
          totalDistance: stat.totalDistance || 0
        };
      } else if (stat._id) {
        console.log(`Found rides with unrecognized vehicle type: ${stat._id}`);
      }
    });

    // Get total counts - all users, not time-filtered
    const totalUsers = await User.countDocuments({
      role: { $ne: 'admin' }
    });

    const totalRides = await Ride.countDocuments({
      createdAt: { $gte: startDate, $lte: endDate }
    });

    const completedRidesData = await Ride.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate },
          status: 'COMPLETED'
        }
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: { $ifNull: ['$fare', 0] } },
          totalDistance: { $sum: { $ifNull: ['$distance', 0] } },
          count: { $sum: 1 }
        }
      }
    ]);

    const totalRevenue = completedRidesData.length > 0 ? completedRidesData[0].totalRevenue : 0;
    const totalDistance = completedRidesData.length > 0 ? completedRidesData[0].totalDistance : 0;
    const completedRides = completedRidesData.length > 0 ? completedRidesData[0].count : 0;

    res.status(StatusCodes.OK).json({
      timeFilter,
      period: {
        start: startDate,
        end: endDate
      },
      totalUsers,
      totalRides,
      completedRides,
      totalRevenue,
      totalDistance,
      userStats: formattedUserStats,
      vehicleStats: formattedVehicleStats
    });
  } catch (error) {
    console.error('Error fetching combined analytics:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      message: 'Failed to fetch combined analytics',
      error: error.message
    });
  }
};
