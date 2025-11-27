import mongoose from 'mongoose';

const FareConfigSchema = new mongoose.Schema(
  {
    // Vehicle type this fare config applies to
    vehicleType: {
      type: String,
      required: true,
      enum: ['Tricycle', 'Single Motorcycle', 'Cab'],
      unique: true,
    },
    
    // Base fare (minimum fare regardless of distance)
    baseFare: {
      type: Number,
      required: true,
      min: 0,
      default: 20,
    },
    
    // Rate per kilometer
    perKmRate: {
      type: Number,
      required: true,
      min: 0,
      default: 2.8,
    },
    
    // Minimum fare (floor price)
    minimumFare: {
      type: Number,
      required: true,
      min: 0,
      default: 20,
    },
    
    // Base distance included in base fare (in km)
    baseDistanceKm: {
      type: Number,
      required: true,
      min: 0,
      default: 1,
    },
    
    // Additional charges
    additionalCharges: {
      // Night time surcharge (percentage)
      nightSurchargePercent: {
        type: Number,
        default: 0,
        min: 0,
        max: 100,
      },
      // Night time hours (24-hour format)
      nightStartHour: {
        type: Number,
        default: 22, // 10 PM
        min: 0,
        max: 23,
      },
      nightEndHour: {
        type: Number,
        default: 5, // 5 AM
        min: 0,
        max: 23,
      },
      // Peak hour surcharge (percentage)
      peakHourSurchargePercent: {
        type: Number,
        default: 0,
        min: 0,
        max: 100,
      },
      // Peak hours (24-hour format)
      peakStartHour: {
        type: Number,
        default: 7, // 7 AM
        min: 0,
        max: 23,
      },
      peakEndHour: {
        type: Number,
        default: 9, // 9 AM
        min: 0,
        max: 23,
      },
      // Per additional passenger charge
      perPassengerCharge: {
        type: Number,
        default: 0,
        min: 0,
      },
    },
    
    // Whether this fare config is active
    isActive: {
      type: Boolean,
      default: true,
    },
    
    // Description/notes for admin reference
    description: {
      type: String,
      default: '',
    },
    
    // Last updated by (admin reference)
    lastUpdatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
    },
    
    // Effective date (when this config takes effect)
    effectiveDate: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Index for quick lookups
FareConfigSchema.index({ vehicleType: 1, isActive: 1 });

// Static method to calculate fare
FareConfigSchema.statics.calculateFare = async function(vehicleType, distanceKm, passengerCount = 1, bookingTime = new Date()) {
  const config = await this.findOne({ vehicleType, isActive: true });
  
  if (!config) {
    // Return default fare if no config found
    return {
      baseFare: 20,
      distanceFare: distanceKm * 2.8,
      totalFare: Math.max(20, distanceKm * 2.8),
      breakdown: {
        baseFare: 20,
        distanceFare: distanceKm * 2.8,
        nightSurcharge: 0,
        peakSurcharge: 0,
        passengerCharge: 0,
      },
      configFound: false,
    };
  }
  
  // Calculate base distance fare
  let distanceFare = 0;
  if (distanceKm > config.baseDistanceKm) {
    distanceFare = (distanceKm - config.baseDistanceKm) * config.perKmRate;
  }
  
  let subtotal = config.baseFare + distanceFare;
  
  // Calculate surcharges
  const hour = bookingTime.getHours();
  let nightSurcharge = 0;
  let peakSurcharge = 0;
  
  // Night surcharge check
  if (config.additionalCharges.nightSurchargePercent > 0) {
    const isNightTime = 
      (config.additionalCharges.nightStartHour > config.additionalCharges.nightEndHour)
        ? (hour >= config.additionalCharges.nightStartHour || hour < config.additionalCharges.nightEndHour)
        : (hour >= config.additionalCharges.nightStartHour && hour < config.additionalCharges.nightEndHour);
    
    if (isNightTime) {
      nightSurcharge = subtotal * (config.additionalCharges.nightSurchargePercent / 100);
    }
  }
  
  // Peak hour surcharge check
  if (config.additionalCharges.peakHourSurchargePercent > 0) {
    const isPeakTime = hour >= config.additionalCharges.peakStartHour && hour < config.additionalCharges.peakEndHour;
    if (isPeakTime) {
      peakSurcharge = subtotal * (config.additionalCharges.peakHourSurchargePercent / 100);
    }
  }
  
  // Additional passenger charge
  const additionalPassengers = Math.max(0, passengerCount - 1);
  const passengerCharge = additionalPassengers * config.additionalCharges.perPassengerCharge;
  
  // Calculate total
  let totalFare = subtotal + nightSurcharge + peakSurcharge + passengerCharge;
  
  // Apply minimum fare
  totalFare = Math.max(totalFare, config.minimumFare);
  
  // Round to 2 decimal places
  totalFare = Math.round(totalFare * 100) / 100;
  
  return {
    baseFare: config.baseFare,
    distanceFare: Math.round(distanceFare * 100) / 100,
    totalFare,
    breakdown: {
      baseFare: config.baseFare,
      distanceFare: Math.round(distanceFare * 100) / 100,
      nightSurcharge: Math.round(nightSurcharge * 100) / 100,
      peakSurcharge: Math.round(peakSurcharge * 100) / 100,
      passengerCharge: Math.round(passengerCharge * 100) / 100,
    },
    configFound: true,
    vehicleType,
    distanceKm,
    config: {
      baseFare: config.baseFare,
      perKmRate: config.perKmRate,
      minimumFare: config.minimumFare,
      baseDistanceKm: config.baseDistanceKm,
    },
  };
};

// Static method to get all active fare configs
FareConfigSchema.statics.getActiveFareConfigs = async function() {
  return this.find({ isActive: true }).sort({ vehicleType: 1 });
};

const FareConfig = mongoose.model('FareConfig', FareConfigSchema);

export default FareConfig;
