import express from 'express';
import {
  getAllCheckpoints,
  getRideCheckpoints,
  getCheckpointStatistics,
  getRecentCheckpoints,
  createManualOngoingCheckpoint,
  getRiderCheckpointSummary,
  exportCheckpoints,
} from '../controllers/checkpointSnapshot.js';

const router = express.Router();

// ============================================
// CHECKPOINT SNAPSHOT ROUTES
// ============================================

// Get all checkpoints with filtering and pagination (admin)
router.get('/', getAllCheckpoints);

// Get checkpoint statistics for analytics (admin)
router.get('/stats', getCheckpointStatistics);

// Get recent checkpoints for live monitoring (admin)
router.get('/recent', getRecentCheckpoints);

// Export checkpoints to CSV (admin)
router.get('/export', exportCheckpoints);

// Get checkpoints for a specific ride with route reconstruction
router.get('/ride/:rideId', getRideCheckpoints);

// Get checkpoint summary for a specific rider
router.get('/rider/:riderId', getRiderCheckpointSummary);

// Create an ONGOING checkpoint manually (rider only, during active ride)
router.post('/ongoing/:rideId', createManualOngoingCheckpoint);

export default router;
