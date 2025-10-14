import User from '../models/User.js';

/**
 * Auto-approval job that runs periodically to check for users with expired rejection deadlines
 * and automatically approves them if the deadline has passed
 */
export const runAutoApprovalJob = async () => {
  try {
    const currentDate = new Date();
    
    // Find all disapproved users with rejection deadlines that have passed
    const usersToAutoApprove = await User.find({
      status: 'disapproved',
      rejectionDeadline: { $exists: true, $ne: null, $lte: currentDate }
    });
    
    if (usersToAutoApprove.length === 0) {
      console.log('⏰ Auto-approval job: No users to auto-approve');
      return;
    }
    
    console.log(`⏰ Auto-approval job: Found ${usersToAutoApprove.length} user(s) to auto-approve`);
    
    // Auto-approve each user
    for (const user of usersToAutoApprove) {
      console.log(`✅ Auto-approving user ${user._id} (${user.email}) - deadline passed: ${user.rejectionDeadline}`);
      
      user.status = 'approved';
      user.disapprovalReason = '';
      user.rejectionDeadline = null;
      user.penaltyComment = '';
      user.penaltyLiftDate = null;
      
      await user.save();
      
      console.log(`✅ User ${user._id} auto-approved successfully`);
    }
    
    console.log(`⏰ Auto-approval job completed: ${usersToAutoApprove.length} user(s) auto-approved`);
  } catch (error) {
    console.error('❌ Error in auto-approval job:', error);
  }
};

/**
 * Initialize the auto-approval job to run every hour
 * @param {number} intervalMinutes - How often to run the job (default: 60 minutes)
 */
export const initAutoApprovalJob = (intervalMinutes = 60) => {
  console.log(`🚀 Initializing auto-approval job (runs every ${intervalMinutes} minutes)`);
  
  // Run immediately on startup
  runAutoApprovalJob();
  
  // Schedule to run periodically
  const intervalMs = intervalMinutes * 60 * 1000;
  setInterval(runAutoApprovalJob, intervalMs);
  
  console.log(`✅ Auto-approval job initialized successfully`);
};
