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
  },
  {
    timestamps: true,
  }
);

const Ride = mongoose.model("Ride", rideSchema);
export default Ride;
