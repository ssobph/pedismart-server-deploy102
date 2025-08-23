import express from 'express';
import { createRating, getRiderRatings, getMyRatings, checkRideRating } from '../controllers/rating.js';

const router = express.Router();

// Create or update a rating
router.post('/create', createRating);

// Get ratings for a specific rider
router.get('/rider/:riderId', getRiderRatings);

// Get ratings for the current rider (self)
router.get('/my-ratings', getMyRatings);

// Check if a ride has been rated
router.get('/check/:rideId', checkRideRating);

export default router;
