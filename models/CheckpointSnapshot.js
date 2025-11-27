import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Checkpoint Snapshot Model
 * 
 * Instead of saving raw GPS every second (expensive storage), we save important state snapshots only.
 * 
 * States we capture:
 * - SEARCHING: Driver is waiting for a booking
 * - ACCEPTED: Driver accepted a ride
 * - PICKUP: Driver reached the pickup location
 * - ONGOING: During the ride (periodic snapshots)
 * - DROPOFF: On drop-off / trip ends
 * 
 * Interpolation Points:
 * - Generated path points between checkpoints
 * - Not raw GPS, smaller size
 * - Good for approximate map route reconstruction
 */

const interpolationPointSchema = new Schema({
  latitude: { type: Number, required: true },
  longitude: { type: Number, required: true },
  timestamp: { type: Date, default: Date.now },
  // Distance from previous point in meters
  distanceFromPrevious: { type: Number, default: 0 },
}, { _id: false });

const checkpointSnapshotSchema = new Schema(
  {
    // Reference to the ride
    rideId: {
      type: Schema.Types.ObjectId,
      ref: "Ride",
      required: true,
      index: true,
    },
    
    // Reference to the rider (driver)
    riderId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    
    // Reference to the customer (primary passenger)
    customerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    
    // Checkpoint type/state
    checkpointType: {
      type: String,
      enum: ["SEARCHING", "ACCEPTED", "PICKUP", "ONGOING", "DROPOFF"],
      required: true,
    },
    
    // GPS coordinates at this checkpoint
    location: {
      latitude: { type: Number, required: true },
      longitude: { type: Number, required: true },
      // Accuracy in meters (from device GPS)
      accuracy: { type: Number, default: null },
      // Heading/bearing in degrees (0-360)
      heading: { type: Number, default: null },
      // Speed in m/s
      speed: { type: Number, default: null },
      // Altitude in meters
      altitude: { type: Number, default: null },
    },
    
    // Address at this checkpoint (reverse geocoded if available)
    address: {
      type: String,
      default: null,
    },
    
    // Timestamp when this checkpoint was captured
    capturedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    
    // Interpolation points from previous checkpoint to this one
    // These are sampled GPS points for route reconstruction
    interpolationPoints: [interpolationPointSchema],
    
    // Distance traveled from previous checkpoint (in km)
    distanceFromPrevious: {
      type: Number,
      default: 0,
    },
    
    // Duration from previous checkpoint (in seconds)
    durationFromPrevious: {
      type: Number,
      default: 0,
    },
    
    // Cumulative distance from ride start (in km)
    cumulativeDistance: {
      type: Number,
      default: 0,
    },
    
    // Sequence number for ordering checkpoints
    sequenceNumber: {
      type: Number,
      default: 0,
    },
    
    // Additional metadata
    metadata: {
      // Device info
      deviceInfo: { type: String, default: null },
      // Battery level at capture
      batteryLevel: { type: Number, default: null },
      // Network type (wifi, cellular, etc.)
      networkType: { type: String, default: null },
      // Any additional notes
      notes: { type: String, default: null },
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for efficient queries
checkpointSnapshotSchema.index({ rideId: 1, sequenceNumber: 1 });
checkpointSnapshotSchema.index({ riderId: 1, capturedAt: -1 });
checkpointSnapshotSchema.index({ checkpointType: 1, capturedAt: -1 });

// Static method to get all checkpoints for a ride
checkpointSnapshotSchema.statics.getCheckpointsForRide = async function(rideId) {
  return this.find({ rideId })
    .sort({ sequenceNumber: 1 })
    .populate('riderId', 'firstName lastName phone')
    .populate('customerId', 'firstName lastName phone');
};

// Static method to get the latest checkpoint for a ride
checkpointSnapshotSchema.statics.getLatestCheckpoint = async function(rideId) {
  return this.findOne({ rideId })
    .sort({ sequenceNumber: -1 });
};

// Static method to calculate total distance for a ride from checkpoints
checkpointSnapshotSchema.statics.calculateTotalDistance = async function(rideId) {
  const checkpoints = await this.find({ rideId }).sort({ sequenceNumber: 1 });
  if (checkpoints.length === 0) return 0;
  
  const lastCheckpoint = checkpoints[checkpoints.length - 1];
  return lastCheckpoint.cumulativeDistance || 0;
};

// Instance method to calculate distance to another checkpoint
checkpointSnapshotSchema.methods.distanceTo = function(otherCheckpoint) {
  const R = 6371; // Earth's radius in km
  const lat1 = this.location.latitude * Math.PI / 180;
  const lat2 = otherCheckpoint.location.latitude * Math.PI / 180;
  const deltaLat = (otherCheckpoint.location.latitude - this.location.latitude) * Math.PI / 180;
  const deltaLon = (otherCheckpoint.location.longitude - this.location.longitude) * Math.PI / 180;

  const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
            Math.cos(lat1) * Math.cos(lat2) *
            Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in km
};

const CheckpointSnapshot = mongoose.model("CheckpointSnapshot", checkpointSnapshotSchema);
export default CheckpointSnapshot;
