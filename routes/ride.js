import express from 'express';
import { 
  createRide, 
  updateRideStatus, 
  acceptRide,
  getMyRides, 
  cancelRide, 
  getSearchingRides,
  // Multi-passenger endpoints
  joinRide,
  approvePassengerJoinRequest,
  declinePassengerJoinRequest,
  updatePassengerStatus,
  removePassenger,
  getAvailableRidesForJoining,
  toggleAcceptingPassengers,
  // Early stop endpoints
  requestEarlyStop,
  respondToEarlyStopRequest
} from '../controllers/ride.js';

const router = express.Router();

// The io instance is already attached to req in app.js, so no need for additional middleware

router.post('/create', createRide);
router.patch('/accept/:rideId', acceptRide);
router.patch('/update/:rideId', updateRideStatus);
router.delete('/cancel/:rideId', cancelRide);
router.get('/rides', getMyRides);
router.get('/searching', getSearchingRides);

// ============================================
// MULTI-PASSENGER ROUTES
// ============================================
router.post('/join/:rideId', joinRide);
router.post('/approve-join/:rideId', approvePassengerJoinRequest);
router.post('/decline-join/:rideId', declinePassengerJoinRequest);
router.get('/available-for-joining', getAvailableRidesForJoining);
router.patch('/passenger/:rideId/:passengerId', updatePassengerStatus);
router.delete('/passenger/:rideId/:passengerId', removePassenger);
router.patch('/toggle-accepting/:rideId', toggleAcceptingPassengers);
// ============================================

// ============================================
// EARLY STOP ROUTES
// ============================================
router.post('/early-stop/:rideId', requestEarlyStop);
router.post('/early-stop-response/:rideId', respondToEarlyStopRequest);
// ============================================

export default router;
