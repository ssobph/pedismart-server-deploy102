import express from 'express';
import {
  getAllFareConfigs,
  getFareConfigByVehicle,
  upsertFareConfig,
  deleteFareConfig,
  toggleFareConfigStatus,
  calculateFareEstimate,
  getPublicFareConfigs,
  initializeDefaultFareConfigs,
} from '../controllers/fareConfig.js';
import adminAuthMiddleware from '../middleware/adminAuth.js';

const router = express.Router();

// ============================================
// PUBLIC ROUTES (for mobile app)
// ============================================

// Get all active fare configs (public - for mobile app)
router.get('/public', getPublicFareConfigs);

// Calculate fare estimate (public - for mobile app)
router.post('/calculate', calculateFareEstimate);

// ============================================
// PROTECTED ROUTES (admin only)
// ============================================

// Get all fare configs (including inactive)
router.get('/', adminAuthMiddleware, getAllFareConfigs);

// Get fare config by vehicle type
router.get('/vehicle/:vehicleType', adminAuthMiddleware, getFareConfigByVehicle);

// Create or update fare config
router.post('/', adminAuthMiddleware, upsertFareConfig);

// Toggle fare config active status
router.patch('/:id/toggle', adminAuthMiddleware, toggleFareConfigStatus);

// Delete fare config
router.delete('/:id', adminAuthMiddleware, deleteFareConfig);

// Initialize default fare configs
router.post('/initialize', adminAuthMiddleware, initializeDefaultFareConfigs);

export default router;
