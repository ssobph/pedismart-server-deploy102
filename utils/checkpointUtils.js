import CheckpointSnapshot from '../models/CheckpointSnapshot.js';

/**
 * Checkpoint Snapshot Utility Functions
 * 
 * These functions handle the creation and management of checkpoint snapshots
 * for trip tracking and route reconstruction.
 */

/**
 * Calculate distance between two GPS coordinates using Haversine formula
 * @param {number} lat1 - Latitude of first point
 * @param {number} lon1 - Longitude of first point
 * @param {number} lat2 - Latitude of second point
 * @param {number} lon2 - Longitude of second point
 * @returns {number} Distance in kilometers
 */
export const calculateHaversineDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

/**
 * Generate interpolation points between two coordinates
 * @param {Object} start - Start point {latitude, longitude, timestamp}
 * @param {Object} end - End point {latitude, longitude, timestamp}
 * @param {number} numPoints - Number of interpolation points to generate
 * @returns {Array} Array of interpolation points
 */
export const generateInterpolationPoints = (start, end, numPoints = 5) => {
  const points = [];
  
  if (!start || !end || numPoints < 1) return points;
  
  const latDiff = end.latitude - start.latitude;
  const lonDiff = end.longitude - start.longitude;
  const timeDiff = end.timestamp ? 
    (new Date(end.timestamp) - new Date(start.timestamp)) : 0;
  
  for (let i = 1; i <= numPoints; i++) {
    const fraction = i / (numPoints + 1);
    const point = {
      latitude: start.latitude + (latDiff * fraction),
      longitude: start.longitude + (lonDiff * fraction),
      timestamp: start.timestamp ? 
        new Date(new Date(start.timestamp).getTime() + (timeDiff * fraction)) : 
        new Date(),
      distanceFromPrevious: 0,
    };
    
    // Calculate distance from previous point
    if (i === 1) {
      point.distanceFromPrevious = calculateHaversineDistance(
        start.latitude, start.longitude,
        point.latitude, point.longitude
      ) * 1000; // Convert to meters
    } else {
      const prevPoint = points[i - 2];
      point.distanceFromPrevious = calculateHaversineDistance(
        prevPoint.latitude, prevPoint.longitude,
        point.latitude, point.longitude
      ) * 1000; // Convert to meters
    }
    
    points.push(point);
  }
  
  return points;
};

/**
 * Create a checkpoint snapshot
 * @param {Object} params - Checkpoint parameters
 * @returns {Object} Created checkpoint snapshot
 */
export const createCheckpointSnapshot = async ({
  rideId,
  riderId,
  customerId,
  checkpointType,
  location,
  address = null,
  metadata = {},
  previousCheckpoint = null,
}) => {
  try {
    // Get the latest checkpoint for this ride to calculate sequence and cumulative values
    const latestCheckpoint = await CheckpointSnapshot.getLatestCheckpoint(rideId);
    
    let sequenceNumber = 0;
    let distanceFromPrevious = 0;
    let durationFromPrevious = 0;
    let cumulativeDistance = 0;
    let interpolationPoints = [];
    
    if (latestCheckpoint) {
      sequenceNumber = latestCheckpoint.sequenceNumber + 1;
      
      // Calculate distance from previous checkpoint
      distanceFromPrevious = calculateHaversineDistance(
        latestCheckpoint.location.latitude,
        latestCheckpoint.location.longitude,
        location.latitude,
        location.longitude
      );
      
      // Calculate duration from previous checkpoint
      durationFromPrevious = Math.floor(
        (new Date() - new Date(latestCheckpoint.capturedAt)) / 1000
      );
      
      // Calculate cumulative distance
      cumulativeDistance = (latestCheckpoint.cumulativeDistance || 0) + distanceFromPrevious;
      
      // Generate interpolation points between checkpoints
      // Only generate if distance is significant (> 100 meters)
      if (distanceFromPrevious > 0.1) {
        const numPoints = Math.min(Math.floor(distanceFromPrevious * 10), 10); // Max 10 points
        interpolationPoints = generateInterpolationPoints(
          {
            latitude: latestCheckpoint.location.latitude,
            longitude: latestCheckpoint.location.longitude,
            timestamp: latestCheckpoint.capturedAt,
          },
          {
            latitude: location.latitude,
            longitude: location.longitude,
            timestamp: new Date(),
          },
          numPoints
        );
      }
    }
    
    const checkpoint = await CheckpointSnapshot.create({
      rideId,
      riderId,
      customerId,
      checkpointType,
      location: {
        latitude: location.latitude,
        longitude: location.longitude,
        accuracy: location.accuracy || null,
        heading: location.heading || null,
        speed: location.speed || null,
        altitude: location.altitude || null,
      },
      address,
      capturedAt: new Date(),
      interpolationPoints,
      distanceFromPrevious,
      durationFromPrevious,
      cumulativeDistance,
      sequenceNumber,
      metadata,
    });
    
    console.log(`📍 Checkpoint created: ${checkpointType} for ride ${rideId} (seq: ${sequenceNumber})`);
    
    return checkpoint;
  } catch (error) {
    console.error('❌ Error creating checkpoint snapshot:', error);
    throw error;
  }
};

/**
 * Create SEARCHING checkpoint when driver goes on duty
 * @param {string} riderId - Rider ID
 * @param {Object} location - GPS coordinates
 */
export const createSearchingCheckpoint = async (riderId, location) => {
  try {
    // For SEARCHING, we don't have a ride yet, so we create a standalone record
    // This will be linked later when a ride is accepted
    console.log(`📍 Driver ${riderId} is searching at location:`, location);
    // Note: We'll create the actual checkpoint when the ride is accepted
    return { status: 'pending', riderId, location };
  } catch (error) {
    console.error('❌ Error creating searching checkpoint:', error);
    throw error;
  }
};

/**
 * Create ACCEPTED checkpoint when driver accepts a ride
 */
export const createAcceptedCheckpoint = async (rideId, riderId, customerId, location, address = null) => {
  return createCheckpointSnapshot({
    rideId,
    riderId,
    customerId,
    checkpointType: 'ACCEPTED',
    location,
    address,
    metadata: { event: 'ride_accepted' },
  });
};

/**
 * Create PICKUP checkpoint when driver reaches pickup location
 */
export const createPickupCheckpoint = async (rideId, riderId, customerId, location, address = null) => {
  return createCheckpointSnapshot({
    rideId,
    riderId,
    customerId,
    checkpointType: 'PICKUP',
    location,
    address,
    metadata: { event: 'passenger_pickup' },
  });
};

/**
 * Create ONGOING checkpoint during the ride (periodic updates)
 */
export const createOngoingCheckpoint = async (rideId, riderId, customerId, location, address = null) => {
  return createCheckpointSnapshot({
    rideId,
    riderId,
    customerId,
    checkpointType: 'ONGOING',
    location,
    address,
    metadata: { event: 'trip_in_progress' },
  });
};

/**
 * Create DROPOFF checkpoint when ride ends
 */
export const createDropoffCheckpoint = async (rideId, riderId, customerId, location, address = null) => {
  return createCheckpointSnapshot({
    rideId,
    riderId,
    customerId,
    checkpointType: 'DROPOFF',
    location,
    address,
    metadata: { event: 'trip_completed' },
  });
};

/**
 * Get all checkpoints for a ride with route reconstruction
 */
export const getRideCheckpointsWithRoute = async (rideId) => {
  const checkpoints = await CheckpointSnapshot.getCheckpointsForRide(rideId);
  
  // Build complete route from checkpoints and interpolation points
  const route = [];
  
  for (const checkpoint of checkpoints) {
    // Add interpolation points first
    if (checkpoint.interpolationPoints && checkpoint.interpolationPoints.length > 0) {
      route.push(...checkpoint.interpolationPoints.map(p => ({
        latitude: p.latitude,
        longitude: p.longitude,
        timestamp: p.timestamp,
        type: 'interpolation',
      })));
    }
    
    // Add the checkpoint itself
    route.push({
      latitude: checkpoint.location.latitude,
      longitude: checkpoint.location.longitude,
      timestamp: checkpoint.capturedAt,
      type: 'checkpoint',
      checkpointType: checkpoint.checkpointType,
      address: checkpoint.address,
    });
  }
  
  return {
    checkpoints,
    route,
    totalDistance: checkpoints.length > 0 ? 
      checkpoints[checkpoints.length - 1].cumulativeDistance : 0,
    totalDuration: checkpoints.length > 1 ?
      Math.floor((new Date(checkpoints[checkpoints.length - 1].capturedAt) - 
        new Date(checkpoints[0].capturedAt)) / 1000) : 0,
  };
};

/**
 * Get checkpoint statistics for analytics
 */
export const getCheckpointStats = async (startDate, endDate) => {
  const matchStage = {};
  
  if (startDate || endDate) {
    matchStage.capturedAt = {};
    if (startDate) matchStage.capturedAt.$gte = new Date(startDate);
    if (endDate) matchStage.capturedAt.$lte = new Date(endDate);
  }
  
  const stats = await CheckpointSnapshot.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: '$checkpointType',
        count: { $sum: 1 },
        avgDistance: { $avg: '$distanceFromPrevious' },
        avgDuration: { $avg: '$durationFromPrevious' },
        totalDistance: { $sum: '$distanceFromPrevious' },
      }
    },
    { $sort: { count: -1 } }
  ]);
  
  return stats;
};

export default {
  calculateHaversineDistance,
  generateInterpolationPoints,
  createCheckpointSnapshot,
  createSearchingCheckpoint,
  createAcceptedCheckpoint,
  createPickupCheckpoint,
  createOngoingCheckpoint,
  createDropoffCheckpoint,
  getRideCheckpointsWithRoute,
  getCheckpointStats,
};
