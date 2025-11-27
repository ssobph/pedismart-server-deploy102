import Ride from '../models/Ride.js';

/**
 * Auto-cancel ride job configuration
 * 
 * SEARCHING_FOR_RIDER: Cancel after 1 hour (no driver accepted)
 * START/ARRIVED: Cancel after 24 hours (ride stuck in progress)
 */
const STALE_RIDE_CONFIG = {
  // Rides searching for rider - cancel after 1 hour
  SEARCHING_TIMEOUT_HOURS: 1,
  // Rides in progress (START/ARRIVED) - cancel after 24 hours
  IN_PROGRESS_TIMEOUT_HOURS: 24,
};

/**
 * Auto-cancel job that runs periodically to check for stale rides
 * and automatically cancels them based on configured timeouts
 */
export const runAutoCancelRideJob = async () => {
  try {
    const now = new Date();
    let totalCancelled = 0;
    
    console.log('🔄 Auto-cancel ride job: Starting...');
    
    // ============================================
    // 1. Cancel SEARCHING_FOR_RIDER rides older than 1 hour
    // ============================================
    const searchingTimeout = new Date(now.getTime() - (STALE_RIDE_CONFIG.SEARCHING_TIMEOUT_HOURS * 60 * 60 * 1000));
    
    const staleSearchingRides = await Ride.find({
      status: 'SEARCHING_FOR_RIDER',
      createdAt: { $lte: searchingTimeout }
    }).populate('customer', 'firstName lastName phone');
    
    if (staleSearchingRides.length > 0) {
      console.log(`⏰ Found ${staleSearchingRides.length} SEARCHING rides older than ${STALE_RIDE_CONFIG.SEARCHING_TIMEOUT_HOURS} hour(s)`);
      
      for (const ride of staleSearchingRides) {
        const ageMinutes = Math.round((now - new Date(ride.createdAt)) / (1000 * 60));
        console.log(`🚫 Auto-cancelling SEARCHING ride ${ride._id} (age: ${ageMinutes} minutes)`);
        
        ride.status = 'CANCELLED';
        ride.cancelledBy = null; // System cancelled
        ride.cancelledAt = now;
        
        // Add a note in tripLogs if it exists
        if (!ride.tripLogs) {
          ride.tripLogs = {};
        }
        ride.tripLogs.autoCancelledReason = `Auto-cancelled: No driver accepted within ${STALE_RIDE_CONFIG.SEARCHING_TIMEOUT_HOURS} hour(s)`;
        ride.tripLogs.autoCancelledAt = now;
        
        await ride.save();
        totalCancelled++;
        
        console.log(`✅ Ride ${ride._id} auto-cancelled (was searching for ${ageMinutes} minutes)`);
      }
    }
    
    // ============================================
    // 2. Cancel START/ARRIVED rides older than 24 hours
    // ============================================
    const inProgressTimeout = new Date(now.getTime() - (STALE_RIDE_CONFIG.IN_PROGRESS_TIMEOUT_HOURS * 60 * 60 * 1000));
    
    const staleInProgressRides = await Ride.find({
      status: { $in: ['START', 'ARRIVED'] },
      createdAt: { $lte: inProgressTimeout }
    }).populate('customer', 'firstName lastName phone')
      .populate('rider', 'firstName lastName phone');
    
    if (staleInProgressRides.length > 0) {
      console.log(`⏰ Found ${staleInProgressRides.length} IN-PROGRESS rides older than ${STALE_RIDE_CONFIG.IN_PROGRESS_TIMEOUT_HOURS} hour(s)`);
      
      for (const ride of staleInProgressRides) {
        const ageHours = Math.round((now - new Date(ride.createdAt)) / (1000 * 60 * 60));
        console.log(`🚫 Auto-cancelling ${ride.status} ride ${ride._id} (age: ${ageHours} hours)`);
        
        ride.status = 'CANCELLED';
        ride.cancelledBy = null; // System cancelled
        ride.cancelledAt = now;
        
        // Add a note in tripLogs if it exists
        if (!ride.tripLogs) {
          ride.tripLogs = {};
        }
        ride.tripLogs.autoCancelledReason = `Auto-cancelled: Ride stuck in ${ride.status} for over ${STALE_RIDE_CONFIG.IN_PROGRESS_TIMEOUT_HOURS} hours`;
        ride.tripLogs.autoCancelledAt = now;
        
        await ride.save();
        totalCancelled++;
        
        console.log(`✅ Ride ${ride._id} auto-cancelled (was in ${ride.status} for ${ageHours} hours)`);
      }
    }
    
    // ============================================
    // 3. Also handle TIMEOUT rides that are very old (clean up)
    // Convert old TIMEOUT rides to CANCELLED after 24 hours
    // ============================================
    const timeoutCleanupDate = new Date(now.getTime() - (24 * 60 * 60 * 1000));
    
    const oldTimeoutRides = await Ride.find({
      status: 'TIMEOUT',
      createdAt: { $lte: timeoutCleanupDate }
    });
    
    if (oldTimeoutRides.length > 0) {
      console.log(`🧹 Found ${oldTimeoutRides.length} old TIMEOUT rides to clean up`);
      
      for (const ride of oldTimeoutRides) {
        ride.status = 'CANCELLED';
        ride.cancelledAt = now;
        
        if (!ride.tripLogs) {
          ride.tripLogs = {};
        }
        ride.tripLogs.autoCancelledReason = 'Auto-cancelled: Converted from TIMEOUT status after 24 hours';
        ride.tripLogs.autoCancelledAt = now;
        
        await ride.save();
        totalCancelled++;
        
        console.log(`🧹 Converted TIMEOUT ride ${ride._id} to CANCELLED`);
      }
    }
    
    // Summary
    if (totalCancelled > 0) {
      console.log(`⏰ Auto-cancel ride job completed: ${totalCancelled} ride(s) auto-cancelled`);
    } else {
      console.log('⏰ Auto-cancel ride job: No stale rides found');
    }
    
    return {
      totalCancelled,
      searchingCancelled: staleSearchingRides.length,
      inProgressCancelled: staleInProgressRides.length,
      timeoutCleaned: oldTimeoutRides.length,
    };
  } catch (error) {
    console.error('❌ Error in auto-cancel ride job:', error);
    throw error;
  }
};

/**
 * Initialize the auto-cancel ride job to run periodically
 * @param {number} intervalMinutes - How often to run the job (default: 15 minutes)
 */
export const initAutoCancelRideJob = (intervalMinutes = 15) => {
  console.log(`🚀 Initializing auto-cancel ride job (runs every ${intervalMinutes} minutes)`);
  console.log(`   - SEARCHING rides: Cancel after ${STALE_RIDE_CONFIG.SEARCHING_TIMEOUT_HOURS} hour(s)`);
  console.log(`   - IN-PROGRESS rides: Cancel after ${STALE_RIDE_CONFIG.IN_PROGRESS_TIMEOUT_HOURS} hour(s)`);
  
  // Run immediately on startup
  runAutoCancelRideJob();
  
  // Schedule to run periodically
  const intervalMs = intervalMinutes * 60 * 1000;
  setInterval(runAutoCancelRideJob, intervalMs);
  
  console.log(`✅ Auto-cancel ride job initialized successfully`);
};

/**
 * Get stale ride statistics (for admin dashboard)
 */
export const getStaleRideStats = async () => {
  const now = new Date();
  
  const searchingTimeout = new Date(now.getTime() - (STALE_RIDE_CONFIG.SEARCHING_TIMEOUT_HOURS * 60 * 60 * 1000));
  const inProgressTimeout = new Date(now.getTime() - (STALE_RIDE_CONFIG.IN_PROGRESS_TIMEOUT_HOURS * 60 * 60 * 1000));
  
  const staleSearching = await Ride.countDocuments({
    status: 'SEARCHING_FOR_RIDER',
    createdAt: { $lte: searchingTimeout }
  });
  
  const staleInProgress = await Ride.countDocuments({
    status: { $in: ['START', 'ARRIVED'] },
    createdAt: { $lte: inProgressTimeout }
  });
  
  const pendingTimeout = await Ride.countDocuments({
    status: 'TIMEOUT'
  });
  
  return {
    staleSearching,
    staleInProgress,
    pendingTimeout,
    totalStale: staleSearching + staleInProgress + pendingTimeout,
    config: STALE_RIDE_CONFIG,
  };
};
