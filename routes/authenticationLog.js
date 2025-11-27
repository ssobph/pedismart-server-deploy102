import express from 'express';
import {
  getAuthenticationLogs,
  getAuthenticationStats,
  getUserAuthenticationLogs,
  getLogsByEmail,
  exportAuthenticationLogs
} from '../controllers/authenticationLog.js';
import authenticateUser from '../middleware/authentication.js';

const router = express.Router();

// All routes require authentication (admin only in practice)
// Get all authentication logs with filters
router.get('/', authenticateUser, getAuthenticationLogs);

// Get authentication statistics
router.get('/stats', authenticateUser, getAuthenticationStats);

// Export authentication logs as CSV
router.get('/export', authenticateUser, exportAuthenticationLogs);

// Get logs for a specific user by user ID
router.get('/user/:userId', authenticateUser, getUserAuthenticationLogs);

// Get logs by email
router.get('/email/:email', authenticateUser, getLogsByEmail);

export default router;
