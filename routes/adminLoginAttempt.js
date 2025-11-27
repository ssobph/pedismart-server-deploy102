import express from 'express';
import {
  getLoginAttempts,
  getLoginStats,
  getAttemptsByEmail,
  unlockEmail,
  exportLoginAttempts,
  clearOldAttempts,
} from '../controllers/adminLoginAttempt.js';
import adminAuthMiddleware from '../middleware/adminAuth.js';

const router = express.Router();

// All routes require admin authentication
router.use(adminAuthMiddleware);

// Get all login attempts with filters
router.get('/', getLoginAttempts);

// Get login statistics
router.get('/stats', getLoginStats);

// Export login attempts as CSV
router.get('/export', exportLoginAttempts);

// Get attempts for a specific email
router.get('/email/:email', getAttemptsByEmail);

// Unlock an email manually (super-admin only)
router.post('/unlock/:email', unlockEmail);

// Clear old login attempts (super-admin only)
router.delete('/cleanup', clearOldAttempts);

export default router;
