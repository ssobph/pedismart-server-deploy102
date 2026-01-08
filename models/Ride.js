import mongoose from 'mongoose';

const { Schema } = mongoose;

const rideSchema = new Schema(
  {
    vehicle: {
      type: String,
      // enum: ["Single Motorcycle", "Tricycle", "Cab"], // Commented out: Only using Tricycle
      enum: ["Tricycle"], // Only Tricycle is active
      required: true,
    },
    distance: {
      type: Number,
      required: true,
    },
    pickup: {
      address: { type: String, required: true },
      latitude: { type: Number, required: true },
      longitude: { type: Number, required: true },
    },
    drop: {
      address: { type: String, required: true },
      latitude: { type: Number, required: true },
      longitude: { type: Number, required: true },
    },
    fare: {
      type: Number,
      required: true,
    },
    customer: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    rider: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    // Rider's current/last known location (updated when rider accepts and during ride)
    riderLocation: {
      latitude: { type: Number, default: null },
      longitude: { type: Number, default: null },
      heading: { type: Number, default: null },
      updatedAt: { type: Date, default: null },
    },
    status: {
      type: String,
      enum: ["SEARCHING_FOR_RIDER", "START", "ARRIVED", "COMPLETED", "CANCELLED", "TIMEOUT"],
      default: "SEARCHING_FOR_RIDER",
    },
    otp: {
      type: String,
      default: null,
    },
    cancelledBy: {
      type: String,
      enum: ["customer", "rider"],
      default: null,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    blacklistedRiders: {
      type: [Schema.Types.ObjectId],
      ref: "User",
      default: [],
      // Array of rider IDs who have cancelled this ride - they won't see it again
    },
    // ============================================
    // MULTI-PASSENGER FEATURE (Up to 6 passengers)
    // ============================================
    passengers: [{
      userId: {
        type: Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
      firstName: { type: String, required: true },
      lastName: { type: String, required: true },
      phone: { type: String },
      status: {
        type: String,
        enum: ["WAITING", "ONBOARD", "DROPPED"],
        default: "WAITING",
      },
      joinedAt: {
        type: Date,
        default: Date.now,
      },
      boardedAt: {
        type: Date,
        default: null,
      },
      isOriginalBooker: {
        type: Boolean,
        default: false,
      }
    }],
    maxPassengers: {
      type: Number,
      default: 6,
      min: 1,
      max: 6,
    },
    currentPassengerCount: {
      type: Number,
      default: 1,
      min: 0,
      max: 6,
    },
    acceptingNewPassengers: {
      type: Boolean,
      default: true, // Allows passengers to join in-progress rides
    },
    // ============================================

    // ============================================
    // TRIP LOG TIMESTAMPS (for audits, disputes, analytics)
    // ============================================
    tripLogs: {
      // When the ride request was created (same as createdAt, but explicit)
      requestTime: {
        type: Date,
        default: null,
      },
      // When driver accepts the booking
      acceptTime: {
        type: Date,
        default: null,
      },
      // When driver starts navigation/goes online for this ride
      startTime: {
        type: Date,
        default: null,
      },
      // When passenger is picked up (driver arrives at pickup)
      pickupTime: {
        type: Date,
        default: null,
      },
      // When passenger is dropped off
      dropoffTime: {
        type: Date,
        default: null,
      },
      // When trip is fully completed
      endTime: {
        type: Date,
        default: null,
      },
      // Auto-cancellation fields (set by system job)
      autoCancelledAt: {
        type: Date,
        default: null,
      },
      autoCancelledReason: {
        type: String,
        default: null,
      },
    },
    // Final computed distance after trip completion (in km)
    finalDistance: {
      type: Number,
      default: null,
    },
    // ============================================

    // ============================================
    // EARLY STOP FEATURE (passenger requests to stop before drop-off)
    // ============================================
    earlyStop: {
      // Whether the ride was completed early (before reaching original drop-off)
      completedEarly: {
        type: Boolean,
        default: false,
      },
      // The actual stop location (where passenger was dropped off early)
      location: {
        latitude: { type: Number, default: null },
        longitude: { type: Number, default: null },
      },
      // Human-readable address of the early stop location
      address: {
        type: String,
        default: null,
      },
      // Who requested the early stop (customer or rider)
      requestedBy: {
        type: String,
        enum: ["customer", "rider", null],
        default: null,
      },
      // When the early stop was requested
      requestedAt: {
        type: Date,
        default: null,
      },
      // Reason for early stop (optional)
      reason: {
        type: String,
        default: null,
      },
    },
    // ============================================

    // ============================================
    // ROUTE LOGS (for route deviation detection, fair pricing, analytics)
    // ============================================
    routeLogs: {
      // Estimated distance from routing API (straight-line or API-calculated route)
      // This is the distance shown to customer when booking
      estimatedDistance: {
        type: Number,
        default: null,
      },
      // Actual distance computed from trip path (pickup to dropoff coordinates)
      // This is the direct path distance between pickup and dropoff
      actualDistance: {
        type: Number,
        default: null,
      },
      // Route distance - the path the driver actually took
      // Calculated from GPS checkpoints during the ride
      routeDistance: {
        type: Number,
        default: null,
      },
      // Deviation percentage ((routeDistance - estimatedDistance) / estimatedDistance * 100)
      deviationPercentage: {
        type: Number,
        default: null,
      },
      // Flag if route deviation exceeds threshold (e.g., > 20%)
      hasSignificantDeviation: {
        type: Boolean,
        default: false,
      },
    },
    // ============================================
  },
  {
    timestamps: true,
  }
);

const Ride = mongoose.model("Ride", rideSchema);
export default Ride;
