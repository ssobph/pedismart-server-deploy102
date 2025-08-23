import Rating from "../models/Rating.js";
import User from "../models/User.js";
import Ride from "../models/Ride.js";
import { BadRequestError, NotFoundError } from "../errors/index.js";
import { StatusCodes } from "http-status-codes";
import mongoose from "mongoose";

// Create a new rating
export const createRating = async (req, res) => {
  const { rideId, rating, comment } = req.body;
  const customerId = req.user.id;

  if (!rideId || !rating) {
    throw new BadRequestError("Ride ID and rating are required");
  }

  if (rating < 1 || rating > 5) {
    throw new BadRequestError("Rating must be between 1 and 5");
  }

  try {
    // Find the ride to ensure it exists and is completed
    const ride = await Ride.findById(rideId);
    
    if (!ride) {
      throw new NotFoundError("Ride not found");
    }

    if (ride.status !== "COMPLETED") {
      throw new BadRequestError("Cannot rate a ride that is not completed");
    }

    if (ride.customer.toString() !== customerId) {
      throw new BadRequestError("You can only rate rides you have taken");
    }

    if (!ride.rider) {
      throw new BadRequestError("This ride has no rider to rate");
    }

    // Check if rating already exists for this ride by this customer
    const existingRating = await Rating.findOne({
      ride: rideId,
      customer: customerId
    });

    if (existingRating) {
      // Update existing rating
      existingRating.rating = rating;
      existingRating.comment = comment || existingRating.comment;
      await existingRating.save();

      res.status(StatusCodes.OK).json({
        message: "Rating updated successfully",
        rating: existingRating
      });
    } else {
      // Create new rating
      const newRating = new Rating({
        ride: rideId,
        customer: customerId,
        rider: ride.rider,
        rating,
        comment
      });

      await newRating.save();

      res.status(StatusCodes.CREATED).json({
        message: "Rating created successfully",
        rating: newRating
      });
    }
  } catch (error) {
    console.error("Error creating/updating rating:", error);
    throw new BadRequestError("Failed to create/update rating");
  }
};

// Get ratings for a rider
export const getRiderRatings = async (req, res) => {
  const { riderId } = req.params;

  try {
    // First, find all ratings for this rider
    const ratings = await Rating.find({ rider: riderId })
      .populate("customer", "firstName lastName")
      .populate({
        path: "ride",
        select: "vehicle distance fare pickup drop createdAt"
      })
      .sort({ createdAt: -1 });

    // Process ratings to handle null ride data
    const processedRatings = ratings.map(rating => {
      // Convert Mongoose document to plain object
      const ratingObj = rating.toObject();
      
      // If ride is null, provide a default empty object
      if (!ratingObj.ride) {
        ratingObj.ride = {
          vehicle: "Unknown",
          distance: 0,
          fare: 0,
          pickup: { address: "Unknown" },
          drop: { address: "Unknown" },
          createdAt: ratingObj.createdAt
        };
      }
      
      return ratingObj;
    });

    // Calculate average rating
    const totalRatings = ratings.length;
    const sumRatings = ratings.reduce((sum, rating) => sum + rating.rating, 0);
    const averageRating = totalRatings > 0 ? (sumRatings / totalRatings).toFixed(1) : 0;

    res.status(StatusCodes.OK).json({
      message: "Ratings retrieved successfully",
      count: totalRatings,
      averageRating,
      ratings: processedRatings
    });
  } catch (error) {
    console.error("Error retrieving ratings:", error);
    throw new BadRequestError("Failed to retrieve ratings");
  }
};

// Get my ratings (for the current rider)
export const getMyRatings = async (req, res) => {
  const riderId = req.user.id;

  try {
    // First, find all ratings for this rider
    const ratings = await Rating.find({ rider: riderId })
      .populate("customer", "firstName lastName")
      .populate({
        path: "ride",
        select: "vehicle distance fare pickup drop createdAt"
      })
      .sort({ createdAt: -1 });

    // Process ratings to handle null ride data
    const processedRatings = ratings.map(rating => {
      // Convert Mongoose document to plain object
      const ratingObj = rating.toObject();
      
      // If ride is null, provide a default empty object
      if (!ratingObj.ride) {
        ratingObj.ride = {
          vehicle: "Unknown",
          distance: 0,
          fare: 0,
          pickup: { address: "Unknown" },
          drop: { address: "Unknown" },
          createdAt: ratingObj.createdAt
        };
      }
      
      return ratingObj;
    });

    // Calculate average rating
    const totalRatings = ratings.length;
    const sumRatings = ratings.reduce((sum, rating) => sum + rating.rating, 0);
    const averageRating = totalRatings > 0 ? (sumRatings / totalRatings).toFixed(1) : 0;

    res.status(StatusCodes.OK).json({
      message: "Ratings retrieved successfully",
      count: totalRatings,
      averageRating,
      ratings: processedRatings
    });
  } catch (error) {
    console.error("Error retrieving ratings:", error);
    throw new BadRequestError("Failed to retrieve ratings");
  }
};

// Check if a ride has been rated
export const checkRideRating = async (req, res) => {
  const { rideId } = req.params;
  const customerId = req.user.id;

  try {
    const rating = await Rating.findOne({
      ride: rideId,
      customer: customerId
    });

    res.status(StatusCodes.OK).json({
      rated: !!rating,
      rating: rating || null
    });
  } catch (error) {
    console.error("Error checking ride rating:", error);
    throw new BadRequestError("Failed to check ride rating");
  }
};
