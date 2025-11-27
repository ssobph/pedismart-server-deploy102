import CheckpointSnapshot from "../models/CheckpointSnapshot.js";
import Ride from "../models/Ride.js";
import { StatusCodes } from "http-status-codes";
import { BadRequestError, NotFoundError } from "../errors/index.js";
import {
  getRideCheckpointsWithRoute,
  getCheckpointStats,
  createOngoingCheckpoint,
} from "../utils/checkpointUtils.js";

/**
 * Get all checkpoint snapshots with filtering and pagination
 * For admin monitoring dashboard
 */
export const getAllCheckpoints = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      rideId,
      riderId,
      customerId,
      checkpointType,
      startDate,
      endDate,
      sortBy = 'capturedAt',
      sortOrder = 'desc',
    } = req.query;

    // Build query
    const query = {};
    
    if (rideId) query.rideId = rideId;
    if (riderId) query.riderId = riderId;
    if (customerId) query.customerId = customerId;
    if (checkpointType) query.checkpointType = checkpointType;
    
    if (startDate || endDate) {
      query.capturedAt = {};
      if (startDate) query.capturedAt.$gte = new Date(startDate);
      if (endDate) query.capturedAt.$lte = new Date(endDate);
    }

    // Calculate skip for pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

    // Execute query with pagination
    const [checkpoints, total] = await Promise.all([
      CheckpointSnapshot.find(query)
        .populate('rideId', 'pickup drop status fare distance')
        .populate('riderId', 'firstName lastName phone vehicleType')
        .populate('customerId', 'firstName lastName phone')
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit)),
      CheckpointSnapshot.countDocuments(query),
    ]);

    res.status(StatusCodes.OK).json({
      success: true,
      checkpoints,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
        hasMore: skip + checkpoints.length < total,
      },
    });
  } catch (error) {
    console.error("Error fetching checkpoints:", error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to fetch checkpoints",
      error: error.message,
    });
  }
};

/**
 * Get checkpoints for a specific ride with route reconstruction
 */
export const getRideCheckpoints = async (req, res) => {
  try {
    const { rideId } = req.params;

    if (!rideId) {
      throw new BadRequestError("Ride ID is required");
    }

    // Verify ride exists
    const ride = await Ride.findById(rideId)
      .populate('customer', 'firstName lastName phone')
      .populate('rider', 'firstName lastName phone vehicleType');

    if (!ride) {
      throw new NotFoundError("Ride not found");
    }

    // Get checkpoints with route reconstruction
    const result = await getRideCheckpointsWithRoute(rideId);

    res.status(StatusCodes.OK).json({
      success: true,
      ride: {
        _id: ride._id,
        status: ride.status,
        pickup: ride.pickup,
        drop: ride.drop,
        fare: ride.fare,
        distance: ride.distance,
        customer: ride.customer,
        rider: ride.rider,
        createdAt: ride.createdAt,
      },
      ...result,
    });
  } catch (error) {
    console.error("Error fetching ride checkpoints:", error);
    if (error instanceof BadRequestError || error instanceof NotFoundError) {
      throw error;
    }
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to fetch ride checkpoints",
      error: error.message,
    });
  }
};

/**
 * Get checkpoint statistics for analytics
 */
export const getCheckpointStatistics = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const stats = await getCheckpointStats(startDate, endDate);

    // Get additional aggregate stats
    const matchStage = {};
    if (startDate || endDate) {
      matchStage.capturedAt = {};
      if (startDate) matchStage.capturedAt.$gte = new Date(startDate);
      if (endDate) matchStage.capturedAt.$lte = new Date(endDate);
    }

    const [totalCheckpoints, uniqueRides, uniqueRiders] = await Promise.all([
      CheckpointSnapshot.countDocuments(matchStage),
      CheckpointSnapshot.distinct('rideId', matchStage).then(arr => arr.length),
      CheckpointSnapshot.distinct('riderId', matchStage).then(arr => arr.length),
    ]);

    // Get average distance per ride
    const distanceStats = await CheckpointSnapshot.aggregate([
      { $match: { ...matchStage, checkpointType: 'DROPOFF' } },
      {
        $group: {
          _id: null,
          avgDistance: { $avg: '$cumulativeDistance' },
          maxDistance: { $max: '$cumulativeDistance' },
          minDistance: { $min: '$cumulativeDistance' },
          totalDistance: { $sum: '$cumulativeDistance' },
        }
      }
    ]);

    res.status(StatusCodes.OK).json({
      success: true,
      stats: {
        byType: stats,
        totals: {
          totalCheckpoints,
          uniqueRides,
          uniqueRiders,
        },
        distance: distanceStats[0] || {
          avgDistance: 0,
          maxDistance: 0,
          minDistance: 0,
          totalDistance: 0,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching checkpoint statistics:", error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to fetch checkpoint statistics",
      error: error.message,
    });
  }
};

/**
 * Get recent checkpoints for live monitoring
 */
export const getRecentCheckpoints = async (req, res) => {
  try {
    const { limit = 20, checkpointType } = req.query;

    const query = {};
    if (checkpointType) query.checkpointType = checkpointType;

    const checkpoints = await CheckpointSnapshot.find(query)
      .populate('rideId', 'pickup drop status fare')
      .populate('riderId', 'firstName lastName phone')
      .populate('customerId', 'firstName lastName')
      .sort({ capturedAt: -1 })
      .limit(parseInt(limit));

    res.status(StatusCodes.OK).json({
      success: true,
      checkpoints,
    });
  } catch (error) {
    console.error("Error fetching recent checkpoints:", error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to fetch recent checkpoints",
      error: error.message,
    });
  }
};

/**
 * Create an ONGOING checkpoint manually (for periodic updates during ride)
 */
export const createManualOngoingCheckpoint = async (req, res) => {
  try {
    const { rideId } = req.params;
    const { location, address } = req.body;
    const riderId = req.user.id;

    if (!rideId || !location) {
      throw new BadRequestError("Ride ID and location are required");
    }

    // Verify ride exists and is in progress
    const ride = await Ride.findById(rideId);
    if (!ride) {
      throw new NotFoundError("Ride not found");
    }

    if (!['START', 'ARRIVED'].includes(ride.status)) {
      throw new BadRequestError("Ride is not in progress");
    }

    // Verify the rider is assigned to this ride
    if (ride.rider.toString() !== riderId) {
      throw new BadRequestError("You are not the rider for this ride");
    }

    const checkpoint = await createOngoingCheckpoint(
      rideId,
      riderId,
      ride.customer,
      location,
      address
    );

    res.status(StatusCodes.CREATED).json({
      success: true,
      message: "Ongoing checkpoint created",
      checkpoint,
    });
  } catch (error) {
    console.error("Error creating ongoing checkpoint:", error);
    if (error instanceof BadRequestError || error instanceof NotFoundError) {
      throw error;
    }
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to create ongoing checkpoint",
      error: error.message,
    });
  }
};

/**
 * Get checkpoint summary for a specific rider
 */
export const getRiderCheckpointSummary = async (req, res) => {
  try {
    const { riderId } = req.params;
    const { startDate, endDate } = req.query;

    const matchStage = { riderId };
    if (startDate || endDate) {
      matchStage.capturedAt = {};
      if (startDate) matchStage.capturedAt.$gte = new Date(startDate);
      if (endDate) matchStage.capturedAt.$lte = new Date(endDate);
    }

    const [summary, recentCheckpoints] = await Promise.all([
      CheckpointSnapshot.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: '$checkpointType',
            count: { $sum: 1 },
            totalDistance: { $sum: '$distanceFromPrevious' },
            avgDuration: { $avg: '$durationFromPrevious' },
          }
        }
      ]),
      CheckpointSnapshot.find(matchStage)
        .populate('rideId', 'pickup drop status')
        .sort({ capturedAt: -1 })
        .limit(10),
    ]);

    res.status(StatusCodes.OK).json({
      success: true,
      riderId,
      summary,
      recentCheckpoints,
    });
  } catch (error) {
    console.error("Error fetching rider checkpoint summary:", error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to fetch rider checkpoint summary",
      error: error.message,
    });
  }
};

/**
 * Export checkpoints to CSV format
 */
export const exportCheckpoints = async (req, res) => {
  try {
    const { rideId, riderId, startDate, endDate, checkpointType } = req.query;

    const query = {};
    if (rideId) query.rideId = rideId;
    if (riderId) query.riderId = riderId;
    if (checkpointType) query.checkpointType = checkpointType;
    if (startDate || endDate) {
      query.capturedAt = {};
      if (startDate) query.capturedAt.$gte = new Date(startDate);
      if (endDate) query.capturedAt.$lte = new Date(endDate);
    }

    const checkpoints = await CheckpointSnapshot.find(query)
      .populate('rideId', 'pickup drop status fare')
      .populate('riderId', 'firstName lastName')
      .populate('customerId', 'firstName lastName')
      .sort({ capturedAt: -1 })
      .limit(1000); // Limit export to 1000 records

    // Convert to CSV format
    const headers = [
      'Checkpoint ID',
      'Ride ID',
      'Checkpoint Type',
      'Latitude',
      'Longitude',
      'Address',
      'Rider Name',
      'Customer Name',
      'Captured At',
      'Distance From Previous (km)',
      'Duration From Previous (s)',
      'Cumulative Distance (km)',
      'Sequence Number',
    ];

    const rows = checkpoints.map(cp => [
      cp._id.toString(),
      cp.rideId?._id?.toString() || '',
      cp.checkpointType,
      cp.location.latitude,
      cp.location.longitude,
      cp.address || '',
      `${cp.riderId?.firstName || ''} ${cp.riderId?.lastName || ''}`.trim(),
      `${cp.customerId?.firstName || ''} ${cp.customerId?.lastName || ''}`.trim(),
      cp.capturedAt.toISOString(),
      cp.distanceFromPrevious.toFixed(3),
      cp.durationFromPrevious,
      cp.cumulativeDistance.toFixed(3),
      cp.sequenceNumber,
    ]);

    const csv = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=checkpoints_${Date.now()}.csv`);
    res.status(StatusCodes.OK).send(csv);
  } catch (error) {
    console.error("Error exporting checkpoints:", error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to export checkpoints",
      error: error.message,
    });
  }
};
