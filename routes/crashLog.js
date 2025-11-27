import express from 'express';
import {
  submitCrashReport,
  getCrashLogs,
  getCrashStats,
  getCrashLogById,
  updateCrashStatus,
  getSimilarCrashes,
  exportCrashLogs,
  deleteOldCrashLogs
} from '../controllers/crashLog.js';
import authenticateUser from '../middleware/authentication.js';

const router = express.Router();

// Public route - submit crash report (no auth required, crash may happen before login)
router.post('/submit', submitCrashReport);

// Protected routes (admin only)
router.get('/', authenticateUser, getCrashLogs);
router.get('/stats', authenticateUser, getCrashStats);
router.get('/export', authenticateUser, exportCrashLogs);
router.get('/:id', authenticateUser, getCrashLogById);
router.get('/:id/similar', authenticateUser, getSimilarCrashes);
router.patch('/:id/status', authenticateUser, updateCrashStatus);
router.delete('/cleanup', authenticateUser, deleteOldCrashLogs);

export default router;
