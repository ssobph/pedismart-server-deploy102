import mongoose from 'mongoose';

const { Schema } = mongoose;

const breadcrumbSchema = new Schema({
  timestamp: {
    type: Date,
    default: Date.now
  },
  type: {
    type: String,
    enum: ['navigation', 'action', 'network', 'console', 'error', 'user', 'system'],
    default: 'action'
  },
  category: {
    type: String,
    default: 'general'
  },
  message: {
    type: String,
    required: true
  },
  data: {
    type: Schema.Types.Mixed,
    default: {}
  }
}, { _id: false });

const crashLogSchema = new Schema(
  {
    // User information (optional - crash may happen before login)
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    userEmail: {
      type: String,
      default: null
    },
    userRole: {
      type: String,
      enum: ['customer', 'rider', 'admin', 'unknown'],
      default: 'unknown'
    },

    // Device Information
    deviceInfo: {
      deviceId: String,
      deviceName: String,
      deviceModel: String,
      manufacturer: String,
      brand: String,
      deviceType: {
        type: String,
        enum: ['phone', 'tablet', 'unknown'],
        default: 'unknown'
      },
      isEmulator: {
        type: Boolean,
        default: false
      }
    },

    // OS Information
    osInfo: {
      osName: {
        type: String,
        enum: ['ios', 'android', 'web', 'unknown'],
        default: 'unknown'
      },
      osVersion: String,
      osBuildId: String,
      apiLevel: Number  // Android API level
    },

    // App Information
    appInfo: {
      appVersion: String,
      buildNumber: String,
      bundleId: String,
      appName: {
        type: String,
        default: 'PediSmart'
      },
      environment: {
        type: String,
        enum: ['development', 'staging', 'production'],
        default: 'production'
      }
    },

    // Error Information
    errorInfo: {
      errorType: {
        type: String,
        enum: ['crash', 'exception', 'anr', 'oom', 'network', 'js_error', 'native_crash', 'unhandled_rejection', 'other'],
        default: 'crash'
      },
      errorName: String,
      errorMessage: {
        type: String,
        required: true
      },
      stackTrace: String,
      componentStack: String,  // React component stack
      isFatal: {
        type: Boolean,
        default: true
      }
    },

    // Breadcrumbs (steps before crash)
    breadcrumbs: {
      type: [breadcrumbSchema],
      default: []
    },

    // Network state at crash
    networkInfo: {
      isConnected: Boolean,
      connectionType: String,  // wifi, cellular, none
      isInternetReachable: Boolean
    },

    // Memory state at crash
    memoryInfo: {
      usedMemory: Number,
      totalMemory: Number,
      freeMemory: Number
    },

    // Battery state at crash
    batteryInfo: {
      batteryLevel: Number,
      isCharging: Boolean,
      batteryState: String
    },

    // Screen/UI state
    screenInfo: {
      currentScreen: String,
      previousScreen: String,
      orientation: {
        type: String,
        enum: ['portrait', 'landscape', 'unknown'],
        default: 'unknown'
      }
    },

    // Additional context
    context: {
      type: Schema.Types.Mixed,
      default: {}
    },

    // Status for tracking
    status: {
      type: String,
      enum: ['new', 'investigating', 'resolved', 'ignored', 'duplicate'],
      default: 'new'
    },

    // Resolution notes
    resolution: {
      resolvedBy: {
        type: Schema.Types.ObjectId,
        ref: 'Admin'
      },
      resolvedAt: Date,
      notes: String,
      fixVersion: String
    },

    // Grouping hash for duplicate detection
    crashHash: {
      type: String,
      index: true
    },

    // Occurrence count for grouped crashes
    occurrenceCount: {
      type: Number,
      default: 1
    }
  },
  {
    timestamps: true,
  }
);

// Indexes for efficient querying
crashLogSchema.index({ user: 1, createdAt: -1 });
crashLogSchema.index({ 'errorInfo.errorType': 1, createdAt: -1 });
crashLogSchema.index({ 'osInfo.osName': 1, createdAt: -1 });
crashLogSchema.index({ 'appInfo.appVersion': 1, createdAt: -1 });
crashLogSchema.index({ status: 1, createdAt: -1 });
crashLogSchema.index({ createdAt: -1 });
crashLogSchema.index({ 'errorInfo.isFatal': 1, createdAt: -1 });

// Generate crash hash for grouping similar crashes
crashLogSchema.pre('save', function(next) {
  if (!this.crashHash) {
    const hashComponents = [
      this.errorInfo?.errorName || '',
      this.errorInfo?.errorMessage?.substring(0, 100) || '',
      this.screenInfo?.currentScreen || '',
      this.appInfo?.appVersion || ''
    ];
    this.crashHash = Buffer.from(hashComponents.join('|')).toString('base64');
  }
  next();
});

// Static method to log a crash
crashLogSchema.statics.logCrash = async function(crashData) {
  try {
    const crash = new this(crashData);
    await crash.save();
    console.log(`💥 Crash Log: ${crashData.errorInfo?.errorType} - ${crashData.errorInfo?.errorMessage?.substring(0, 50)}`);
    return crash;
  } catch (error) {
    console.error('Error logging crash:', error);
    return null;
  }
};

// Static method to get crash statistics
crashLogSchema.statics.getCrashStats = async function(startDate, endDate) {
  const dateFilter = {};
  if (startDate) dateFilter.$gte = new Date(startDate);
  if (endDate) dateFilter.$lte = new Date(endDate);

  const matchStage = Object.keys(dateFilter).length > 0 
    ? { createdAt: dateFilter } 
    : {};

  return this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: null,
        totalCrashes: { $sum: 1 },
        fatalCrashes: { $sum: { $cond: ['$errorInfo.isFatal', 1, 0] } },
        uniqueUsers: { $addToSet: '$user' },
        byErrorType: { $push: '$errorInfo.errorType' },
        byOS: { $push: '$osInfo.osName' },
        byAppVersion: { $push: '$appInfo.appVersion' }
      }
    }
  ]);
};

const CrashLog = mongoose.model("CrashLog", crashLogSchema);
export default CrashLog;
