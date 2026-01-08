import Ride from "../models/Ride.js";
import CheckpointSnapshot from "../models/CheckpointSnapshot.js";
import { BadRequestError, NotFoundError } from "../errors/index.js";
import { StatusCodes } from "http-status-codes";
// COMMENTED OUT: Payment/Fare - Driver handles pricing manually
import {
  calculateDistance,
  // calculateFare,
  generateOTP,
  MAX_DISTANCE_KM,
} from "../utils/mapUtils.js";
import { broadcastNewRideRequest, broadcastRideAccepted } from "./sockets.js";
import {
  createAcceptedCheckpoint,
  createPickupCheckpoint,
  createDropoffCheckpoint,
} from "../utils/checkpointUtils.js";

// Route deviation threshold (percentage)
const ROUTE_DEVIATION_THRESHOLD = 20; // Flag if route is 20% longer than estimated


export const acceptRide = async (req, res) => {
  const riderId = req.user.id;
  const { rideId } = req.params;

  if (!rideId) {
    throw new BadRequestError("Ride ID is required");
  }

  try {
    let ride = await Ride.findById(rideId).populate("customer", "firstName lastName phone");

    if (!ride) {
      throw new NotFoundError("Ride not found");
    }

    if (ride.status !== "SEARCHING_FOR_RIDER") {
      throw new BadRequestError("Ride is no longer available for assignment");
    }

    // Get rider details to check vehicle type
    const User = (await import('../models/User.js')).default;
    const rider = await User.findById(riderId);
    
    if (!rider) {
      throw new NotFoundError("Rider not found");
    }

    // Check if rider's vehicle type matches the ride's requested vehicle type
    if (rider.vehicleType !== ride.vehicle) {
      console.log(`❌ Vehicle type mismatch: Rider has ${rider.vehicleType}, but ride requires ${ride.vehicle}`);
      throw new BadRequestError(`This ride requires a ${ride.vehicle}. Your vehicle type is ${rider.vehicleType}. Please update your profile to match the ride requirements.`);
    }

    console.log(`✅ Vehicle type match: Rider ${riderId} with ${rider.vehicleType} accepting ${ride.vehicle} ride`);

    // ============================================
    // Check MAX_DISTANCE if enabled (optional validation)
    // Note: This is a server-side safety check. The main filtering happens in socket broadcasts.
    // ============================================
    if (MAX_DISTANCE_KM && rider.location && ride.pickup) {
      const distance = calculateDistance(
        rider.location.latitude,
        rider.location.longitude,
        ride.pickup.latitude,
        ride.pickup.longitude
      );
      
      if (distance > MAX_DISTANCE_KM) {
        console.log(`❌ Distance check failed: Rider is ${distance.toFixed(2)}km away (max: ${MAX_DISTANCE_KM}km)`);
        throw new BadRequestError(`This ride is too far away (${distance.toFixed(1)}km). Maximum distance is ${MAX_DISTANCE_KM}km.`);
      }
      
      console.log(`✅ Distance check passed: Rider is ${distance.toFixed(2)}km away (within ${MAX_DISTANCE_KM}km limit)`);
    }
    // ============================================

    ride.rider = riderId;
    ride.status = "START";
    
    // ============================================
    // TRIP LOG: Record accept time and start time
    // ============================================
    if (!ride.tripLogs) {
      ride.tripLogs = {};
    }
    ride.tripLogs.acceptTime = new Date();
    ride.tripLogs.startTime = new Date();
    console.log(`📊 Trip Log: Ride ${rideId} accepted at ${ride.tripLogs.acceptTime}`);
    // ============================================
    
    // ============================================
    // RIDER LOCATION: Store rider's location for distance calculation
    // ============================================
    const riderLocationFromBody = req.body.location;
    if (riderLocationFromBody && riderLocationFromBody.latitude && riderLocationFromBody.longitude) {
      ride.riderLocation = {
        latitude: riderLocationFromBody.latitude,
        longitude: riderLocationFromBody.longitude,
        heading: riderLocationFromBody.heading || null,
        updatedAt: new Date(),
      };
      console.log(`📍 Rider location stored: ${riderLocationFromBody.latitude}, ${riderLocationFromBody.longitude}`);
    }
    // ============================================
    
    await ride.save();

    // ============================================
    // CHECKPOINT SNAPSHOT: Record ACCEPTED checkpoint
    // ============================================
    try {
      // Get rider's current location from request body or use pickup as fallback
      const riderLocation = req.body.location || {
        latitude: ride.pickup.latitude,
        longitude: ride.pickup.longitude,
      };
      
      await createAcceptedCheckpoint(
        rideId,
        riderId,
        ride.customer._id || ride.customer,
        riderLocation,
        ride.pickup.address
      );
      console.log(`📍 Checkpoint: ACCEPTED snapshot created for ride ${rideId}`);
    } catch (checkpointError) {
      console.error(`⚠️ Failed to create ACCEPTED checkpoint:`, checkpointError);
      // Don't fail the ride acceptance if checkpoint creation fails
    }
    // ============================================

    ride = await ride.populate("rider", "firstName lastName phone vehicleType");

    // Broadcast to the specific ride room
    if (req.io) {
      console.log(`Broadcasting ride acceptance for ride ${rideId}`);
      console.log(`Ride status: ${ride.status}, OTP: ${ride.otp}`);
      console.log(`Customer ID: ${ride.customer}, Rider ID: ${riderId}`);
      
      // Send updated ride data to the ride room
      req.io.to(`ride_${rideId}`).emit("rideUpdate", ride);
      req.io.to(`ride_${rideId}`).emit("rideAccepted", ride);
      
      // Also try to find and directly notify the customer
      const customerSocket = [...req.io.sockets.sockets.values()].find(
        socket => socket.user?.id === ride.customer.toString()
      );
      if (customerSocket) {
        console.log(`Found customer socket, directly notifying customer ${ride.customer}`);
        customerSocket.emit("rideUpdate", ride);
        customerSocket.emit("rideAccepted", ride);
        customerSocket.emit("rideData", ride); // Also send as rideData to force update
      } else {
        console.log(`Customer socket not found for customer ${ride.customer}`);
      }
      
      // Send ride data with OTP to the rider who accepted
      const riderSocket = [...req.io.sockets.sockets.values()].find(
        socket => socket.user?.id === riderId
      );
      if (riderSocket) {
        console.log(`Found rider socket, notifying rider ${riderId}`);
        riderSocket.emit("rideAccepted", ride);
      } else {
        console.log(`Rider socket not found for rider ${riderId}`);
      }
      
      // Broadcast to all on-duty riders that this ride is no longer available
      broadcastRideAccepted(req.io, rideId);
      
      console.log(`Ride ${rideId} acceptance broadcast completed`);
    }

    res.status(StatusCodes.OK).json({
      message: "Ride accepted successfully",
      ride,
    });
  } catch (error) {
    console.error("Error accepting ride:", error);
    throw new BadRequestError("Failed to accept ride");
  }
};

export const updateRideStatus = async (req, res) => {
  const { rideId } = req.params;
  const { status } = req.body;

  if (!rideId || !status) {
    throw new BadRequestError("Ride ID and status are required");
  }

  try {
    let ride = await Ride.findById(rideId).populate("customer", "firstName lastName phone").populate("rider", "firstName lastName phone vehicleType");

    if (!ride) {
      throw new NotFoundError("Ride not found");
    }

    if (!["START", "ARRIVED", "COMPLETED"].includes(status)) {
      throw new BadRequestError("Invalid ride status");
    }
    
    // CRITICAL: Never allow changing status of a COMPLETED ride
    if (ride.status === "COMPLETED") {
      console.log(`🔒 Protected: Ride ${rideId} is already COMPLETED - status change to ${status} rejected`);
      
      // Return the ride without changing it
      return res.status(StatusCodes.OK).json({
        message: `Ride is already completed and cannot be changed`,
        ride,
      });
    }
    
    // Log the status change with detailed information
    console.log(`📝 Ride ${rideId} status change: ${ride.status} → ${status}`);
    console.log(`📍 Ride details: Customer=${ride.customer._id}, Rider=${ride.rider?._id || 'None'}, OTP=${ride.otp}`);
    
    // Update the status
    ride.status = status;
    
    // ============================================
    // TRIP LOG: Record timestamps for each status change
    // ============================================
    if (!ride.tripLogs) {
      ride.tripLogs = {};
    }
    
    if (status === "ARRIVED") {
      // Driver arrived at pickup location - record pickup time
      ride.tripLogs.pickupTime = new Date();
      console.log(`📊 Trip Log: Ride ${rideId} pickup at ${ride.tripLogs.pickupTime}`);
    } else if (status === "COMPLETED") {
      // Trip completed - record dropoff and end time
      ride.tripLogs.dropoffTime = new Date();
      ride.tripLogs.endTime = new Date();
      // Store final distance
      ride.finalDistance = ride.distance;
      console.log(`📊 Trip Log: Ride ${rideId} completed at ${ride.tripLogs.endTime}, final distance: ${ride.finalDistance}km`);
      
      // ============================================
      // ROUTE LOGS: Calculate distances on completion
      // ============================================
      try {
        // Initialize routeLogs if not exists
        if (!ride.routeLogs) {
          ride.routeLogs = {
            estimatedDistance: ride.distance,
            actualDistance: null,
            routeDistance: null,
            deviationPercentage: null,
            hasSignificantDeviation: false,
          };
        }
        
        // 1. Actual Distance: Direct path from pickup to dropoff
        const actualDistance = calculateDistance(
          ride.pickup.latitude,
          ride.pickup.longitude,
          ride.drop.latitude,
          ride.drop.longitude
        );
        ride.routeLogs.actualDistance = actualDistance;
        
        // 2. Route Distance: Calculate from GPS checkpoints (driver's actual path)
        const routeDistance = await CheckpointSnapshot.calculateTotalDistance(rideId);
        ride.routeLogs.routeDistance = routeDistance;
        
        // 3. Calculate deviation percentage
        const estimatedDistance = ride.routeLogs.estimatedDistance || ride.distance;
        if (estimatedDistance > 0 && routeDistance > 0) {
          const deviation = ((routeDistance - estimatedDistance) / estimatedDistance) * 100;
          ride.routeLogs.deviationPercentage = Math.round(deviation * 100) / 100; // Round to 2 decimal places
          ride.routeLogs.hasSignificantDeviation = deviation > ROUTE_DEVIATION_THRESHOLD;
          
          if (ride.routeLogs.hasSignificantDeviation) {
            console.log(`⚠️ Route Deviation Alert: Ride ${rideId} has ${deviation.toFixed(1)}% deviation (threshold: ${ROUTE_DEVIATION_THRESHOLD}%)`);
          }
        }
        
        console.log(`🛣️ Route Logs: Ride ${rideId} - Estimated: ${estimatedDistance.toFixed(2)}km, Actual: ${actualDistance.toFixed(2)}km, Route: ${routeDistance.toFixed(2)}km`);
      } catch (routeLogError) {
        console.error(`⚠️ Failed to calculate route logs for ride ${rideId}:`, routeLogError);
        // Don't fail the status update if route log calculation fails
      }
      // ============================================
    }
    // ============================================
    
    // ============================================
    // AUTO-UPDATE PASSENGER STATUSES
    // ============================================
    if (ride.passengers && ride.passengers.length > 0) {
      if (status === "ARRIVED") {
        // When driver arrives, all WAITING passengers become ONBOARD
        let updatedCount = 0;
        ride.passengers.forEach(passenger => {
          if (passenger.status === "WAITING") {
            passenger.status = "ONBOARD";
            if (!passenger.boardedAt) {
              passenger.boardedAt = new Date();
            }
            updatedCount++;
          }
        });
        if (updatedCount > 0) {
          console.log(`👥 Auto-updated ${updatedCount} passengers to ONBOARD (ride ARRIVED)`);
        }
      } else if (status === "COMPLETED") {
        // When ride completes, all ONBOARD passengers become DROPPED
        let updatedCount = 0;
        ride.passengers.forEach(passenger => {
          if (passenger.status === "ONBOARD" || passenger.status === "WAITING") {
            passenger.status = "DROPPED";
            updatedCount++;
          }
        });
        if (updatedCount > 0) {
          console.log(`👥 Auto-updated ${updatedCount} passengers to DROPPED (ride COMPLETED)`);
        }
      }
    }
    // ============================================
    
    await ride.save();
    
    // Log confirmation of successful update
    console.log(`✅ Ride ${rideId} status successfully updated to ${status}`);

    // ============================================
    // CHECKPOINT SNAPSHOT: Record status-based checkpoints
    // ============================================
    try {
      // Get location from request body or use appropriate location based on status
      const location = req.body.location || (status === "ARRIVED" ? {
        latitude: ride.pickup.latitude,
        longitude: ride.pickup.longitude,
      } : {
        latitude: ride.drop.latitude,
        longitude: ride.drop.longitude,
      });
      
      const riderId = ride.rider._id || ride.rider;
      const customerId = ride.customer._id || ride.customer;
      
      if (status === "ARRIVED") {
        // PICKUP checkpoint - driver reached pickup location
        await createPickupCheckpoint(
          rideId,
          riderId,
          customerId,
          location,
          ride.pickup.address
        );
        console.log(`📍 Checkpoint: PICKUP snapshot created for ride ${rideId}`);
      } else if (status === "COMPLETED") {
        // DROPOFF checkpoint - trip completed
        await createDropoffCheckpoint(
          rideId,
          riderId,
          customerId,
          location,
          ride.drop.address
        );
        console.log(`📍 Checkpoint: DROPOFF snapshot created for ride ${rideId}`);
      }
    } catch (checkpointError) {
      console.error(`⚠️ Failed to create checkpoint for status ${status}:`, checkpointError);
      // Don't fail the status update if checkpoint creation fails
    }
    // ============================================

    // Broadcast to ride room
    if (req.io) {
      console.log(`Broadcasting ride status update: ${status} for ride ${rideId}`);
      req.io.to(`ride_${rideId}`).emit("rideUpdate", ride);
      
      // Broadcast passenger status updates if any passengers were auto-updated
      if (ride.passengers && ride.passengers.length > 0 && (status === "ARRIVED" || status === "COMPLETED")) {
        req.io.to(`ride_${rideId}`).emit("passengerUpdate", ride);
        console.log(`👥 Broadcasting passenger status updates for ride ${rideId}`);
        
        // Notify each passenger individually about their status change
        ride.passengers.forEach(passenger => {
          const passengerSocket = [...req.io.sockets.sockets.values()].find(
            socket => socket.user?.id === passenger.userId.toString()
          );
          if (passengerSocket) {
            passengerSocket.emit("yourStatusUpdated", {
              status: passenger.status,
              ride: ride
            });
            console.log(`👤 Notified passenger ${passenger.firstName} of status: ${passenger.status}`);
          }
        });
      }
      
      // Also directly notify the customer
      const customerSocket = [...req.io.sockets.sockets.values()].find(
        socket => socket.user?.id === ride.customer._id.toString()
      );
      if (customerSocket) {
        console.log(`Directly notifying customer ${ride.customer._id} about status update`);
        customerSocket.emit("rideUpdate", ride);
        customerSocket.emit("rideData", ride);
      }
      
      // If completed, send completion event and remove from riders' lists
      if (status === "COMPLETED") {
        req.io.to(`ride_${rideId}`).emit("rideCompleted", ride);
        if (customerSocket) {
          customerSocket.emit("rideCompleted", ride);
        }
        
        // Remove from all on-duty riders' lists (in case it's still showing)
        req.io.to("onDuty").emit("rideCompleted", { 
          _id: rideId,
          rideId: rideId,
          ride: ride
        });
        
        console.log(`🎉 Ride ${rideId} completed - removed from all riders' lists`);
      }
    }

    res.status(StatusCodes.OK).json({
      message: `Ride status updated to ${status}`,
      ride,
    });
  } catch (error) {
    console.error("Error updating ride status:", error);
    throw new BadRequestError("Failed to update ride status");
  }
};

export const cancelRide = async (req, res) => {
  const { rideId } = req.params;
  const userId = req.user.id;

  if (!rideId) {
    throw new BadRequestError("Ride ID is required");
  }

  try {
    const ride = await Ride.findById(rideId)
      .populate("customer", "firstName lastName phone")
      .populate("rider", "firstName lastName phone");

    if (!ride) {
      throw new NotFoundError("Ride not found");
    }

    // Check if the user is authorized to cancel this ride
    if (ride.customer._id.toString() !== userId && ride.rider?._id.toString() !== userId) {
      throw new BadRequestError("You are not authorized to cancel this ride");
    }

    // CRITICAL: Never allow cancellation of a COMPLETED ride
    if (ride.status === "COMPLETED") {
      console.log(`🔒 Protected: Ride ${rideId} is already COMPLETED - cancellation rejected`);
      return res.status(StatusCodes.BAD_REQUEST).json({
        message: "Ride is already completed and cannot be cancelled",
      });
    }
    
    // Only allow cancellation if ride is still searching or just started
    if (!["SEARCHING_FOR_RIDER", "START", "ARRIVED"].includes(ride.status)) {
      throw new BadRequestError("Ride cannot be cancelled at this stage");
    }

    // Determine who cancelled the ride
    const cancelledBy = ride.customer._id.toString() === userId ? "customer" : "rider";
    const cancellerName = cancelledBy === "customer" 
      ? `${ride.customer.firstName} ${ride.customer.lastName}` 
      : `${ride.rider?.firstName} ${ride.rider?.lastName}`;

    // If rider cancelled, add them to blacklist so they never see this ride again
    if (cancelledBy === "rider") {
      if (!ride.blacklistedRiders) {
        ride.blacklistedRiders = [];
      }
      if (!ride.blacklistedRiders.includes(userId)) {
        ride.blacklistedRiders.push(userId);
        console.log(`🚫 Rider ${userId} added to blacklist for ride ${rideId} - they will not see this ride again`);
      }
      
      // If ride was still searching, reset it so other riders can accept
      if (ride.status === "SEARCHING_FOR_RIDER") {
        ride.rider = null;
        console.log(`♻️ Ride ${rideId} reset to SEARCHING_FOR_RIDER for other riders (excluding blacklisted rider ${userId})`);
      } else {
        // If ride was already accepted (START/ARRIVED), mark as CANCELLED
        ride.status = "CANCELLED";
        ride.cancelledBy = cancelledBy;
        ride.cancelledAt = new Date();
        console.log(`🚫 Ride ${rideId} marked as CANCELLED by rider ${userId}`);
      }
    } else {
      // Customer cancelled - mark ride as CANCELLED
      ride.status = "CANCELLED";
      ride.cancelledBy = cancelledBy;
      ride.cancelledAt = new Date();
      console.log(`🚫 Ride ${rideId} cancelled by customer ${userId}, status updated to CANCELLED`);
    }
    
    await ride.save();

    // Broadcast cancellation to all relevant parties
    if (req.io) {
      console.log(`📢 Broadcasting cancellation for ride ${rideId} to all connected parties`);
      
      // Emit to ride room
      req.io.to(`ride_${rideId}`).emit("rideCanceled", { 
        message: "Ride has been cancelled",
        ride: ride,
        cancelledBy: cancelledBy,
        cancellerName: cancellerName
      });
      
      console.log(`✅ Emitted rideCanceled to ride room: ride_${rideId}`);
      
      // If passenger cancelled after driver accepted, send alert to driver
      if (cancelledBy === "customer" && ride.rider && ride.status !== "SEARCHING_FOR_RIDER") {
        const riderSocket = [...req.io.sockets.sockets.values()].find(
          socket => socket.user?.id === ride.rider._id.toString()
        );
        
        if (riderSocket) {
          console.log(`🚨 Sending cancellation alert to rider ${ride.rider._id}`);
          riderSocket.emit("passengerCancelledRide", {
            rideId: rideId,
            message: `${cancellerName} has cancelled the ride`,
            passengerName: cancellerName,
            ride: ride
          });
        }
      }
      
      // If driver cancelled, send alert to passenger
      if (cancelledBy === "rider" && ride.customer) {
        const customerSocket = [...req.io.sockets.sockets.values()].find(
          socket => socket.user?.id === ride.customer._id.toString()
        );
        
        if (customerSocket) {
          console.log(`🚨 Sending cancellation alert to customer ${ride.customer._id}`);
          customerSocket.emit("riderCancelledRide", {
            rideId: rideId,
            message: `${cancellerName} has cancelled the ride`,
            riderName: cancellerName,
            ride: ride
          });
        }
        
        // If rider cancelled and ride is still SEARCHING (reset for other riders),
        // only remove it from the cancelling rider's screen
        if (ride.status === "SEARCHING_FOR_RIDER") {
          const cancellingRiderSocket = [...req.io.sockets.sockets.values()].find(
            socket => socket.user?.id === userId
          );
          
          if (cancellingRiderSocket) {
            console.log(`🚫 Removing ride ${rideId} from cancelling rider ${userId}'s screen only`);
            cancellingRiderSocket.emit("rideRemovedForYou", rideId);
          }
        } else {
          // If ride was fully cancelled (not reset), remove from all riders
          req.io.to("onDuty").emit("rideOfferCanceled", rideId);
        }
      } else {
        // Customer cancelled or ride fully cancelled - remove from all riders
        console.log(`🚫 Customer cancelled ride ${rideId} - removing from ALL on-duty riders' screens`);
        req.io.to("onDuty").emit("rideOfferCanceled", rideId);
        console.log(`✅ Emitted rideOfferCanceled to onDuty room for ride ${rideId}`);
        
        // Also emit rideCanceled with ride data for additional handling
        req.io.to("onDuty").emit("rideCanceled", {
          rideId: rideId,
          ride: ride,
          cancelledBy: cancelledBy
        });
        console.log(`✅ Emitted rideCanceled to onDuty room for ride ${rideId}`);
      }
      
      console.log(`📢 Broadcasted ride ${rideId} cancellation to all relevant parties`);
    }

    res.status(StatusCodes.OK).json({
      message: "Ride cancelled successfully",
      ride: ride,
      cancelledBy: cancelledBy
    });
  } catch (error) {
    console.error("Error cancelling ride:", error);
    throw new BadRequestError("Failed to cancel ride");
  }
};

export const getMyRides = async (req, res) => {
  const userId = req.user.id;
  const { status } = req.query;

  try {
    const query = {
      $or: [
        { customer: userId }, 
        { rider: userId },
        { "passengers.userId": userId } // Include rides where user is a passenger
      ],
    };

    if (status) {
      query.status = status;
    }

    const rides = await Ride.find(query)
      .populate("customer", "firstName lastName phone email")
      .populate("rider", "firstName lastName phone email vehicleType")
      .populate("passengers.userId", "firstName lastName phone email") // Populate passenger details
      .sort({ createdAt: -1 });

    res.status(StatusCodes.OK).json({
      message: "Rides retrieved successfully",
      count: rides.length,
      rides,
    });
  } catch (error) {
    console.error("Error retrieving rides:", error);
    throw new BadRequestError("Failed to retrieve rides");
  }
};

export const getSearchingRides = async (req, res) => {
  try {
    const riderId = req.user.id;
    
    // Get rider's vehicle type from database (for logging purposes)
    const User = (await import('../models/User.js')).default;
    const rider = await User.findById(riderId).select('vehicleType');
    const riderVehicleType = rider?.vehicleType || "Unknown";
    
    // Return ALL searching rides (client will handle visual feedback for mismatched rides)
    // Only rides with SEARCHING_FOR_RIDER status (cancelled/timeout rides have different status)
    const allRides = await Ride.find({ 
      status: "SEARCHING_FOR_RIDER"
    }).populate("customer", "firstName lastName phone");
    
    console.log(`API: Found ${allRides.length} searching rides (ALL vehicle types) for rider ${riderId} (vehicle: ${riderVehicleType})`);
    
    // Log vehicle type breakdown
    if (allRides.length > 0) {
      const vehicleBreakdown = allRides.reduce((acc, ride) => {
        acc[ride.vehicle] = (acc[ride.vehicle] || 0) + 1;
        return acc;
      }, {});
      console.log(`API: Vehicle types: ${JSON.stringify(vehicleBreakdown)}`);
    }
    
    res.status(StatusCodes.OK).json({
      message: "Searching rides retrieved successfully (ALL vehicle types)",
      count: allRides.length,
      rides: allRides,
      riderVehicleType: riderVehicleType,
    });
  } catch (error) {
    console.error("Error retrieving searching rides:", error);
    throw new BadRequestError("Failed to retrieve searching rides");
  }
};

// ============================================
// MULTI-PASSENGER FEATURE - Passenger Management
// ============================================

// Join an existing ride as a passenger
export const joinRide = async (req, res) => {
  const { rideId } = req.params;
  const userId = req.user.id;

  if (!rideId) {
    throw new BadRequestError("Ride ID is required");
  }

  try {
    const ride = await Ride.findById(rideId).populate("customer", "firstName lastName phone");

    if (!ride) {
      throw new NotFoundError("Ride not found");
    }

    // Check if ride is accepting new passengers
    if (!ride.acceptingNewPassengers) {
      throw new BadRequestError("This ride is not accepting new passengers");
    }

    // Check if ride is full
    if (ride.currentPassengerCount >= ride.maxPassengers) {
      throw new BadRequestError("This ride is full (maximum 6 passengers)");
    }

    // Check if user is already in the ride
    const alreadyJoined = ride.passengers.some(p => p.userId.toString() === userId);
    if (alreadyJoined) {
      throw new BadRequestError("You have already joined this ride");
    }

    // Check if ride is in valid status for joining
    if (!["SEARCHING_FOR_RIDER", "START", "ARRIVED"].includes(ride.status)) {
      throw new BadRequestError("Cannot join this ride at this stage");
    }

    // Get user info
    const User = (await import('../models/User.js')).default;
    const user = await User.findById(userId).select('firstName lastName phone email photo');

    // Send join request to rider for approval
    if (req.io && ride.rider) {
      const riderSocket = [...req.io.sockets.sockets.values()].find(
        socket => socket.user?.id === ride.rider.toString()
      );
      
      if (riderSocket) {
        console.log(`📨 Sending join request to rider for ride ${rideId}`);
        
        // Send join request to rider
        riderSocket.emit("passengerJoinRequest", {
          rideId: rideId,
          requestId: `${userId}_${Date.now()}`,
          passenger: {
            userId: userId,
            firstName: user.firstName,
            lastName: user.lastName,
            phone: user.phone,
            email: user.email || '',
            photo: user.photo || null,
          },
          ride: {
            pickup: ride.pickup,
            drop: ride.drop,
            currentPassengerCount: ride.currentPassengerCount,
            maxPassengers: ride.maxPassengers,
          }
        });

        res.status(StatusCodes.OK).json({
          message: "Join request sent to rider. Waiting for approval...",
          status: "PENDING",
          rideId: rideId,
        });
      } else {
        throw new BadRequestError("Rider is not online. Cannot send join request.");
      }
    } else {
      throw new BadRequestError("Rider is not assigned to this ride yet");
    }
  } catch (error) {
    console.error("Error joining ride:", error);
    throw new BadRequestError(error.message || "Failed to join ride");
  }
};

// Approve passenger join request (rider only)
export const approvePassengerJoinRequest = async (req, res) => {
  const { rideId } = req.params;
  const { passengerId } = req.body;
  const riderId = req.user.id;

  if (!rideId || !passengerId) {
    throw new BadRequestError("Ride ID and passenger ID are required");
  }

  try {
    const ride = await Ride.findById(rideId)
      .populate("customer", "firstName lastName phone")
      .populate("rider", "firstName lastName phone vehicleType");

    if (!ride) {
      throw new NotFoundError("Ride not found");
    }

    // Verify that the requester is the assigned rider
    if (!ride.rider || ride.rider._id.toString() !== riderId) {
      throw new BadRequestError("Only the assigned rider can approve join requests");
    }

    // Check if ride is full
    if (ride.currentPassengerCount >= ride.maxPassengers) {
      throw new BadRequestError("This ride is full");
    }

    // Check if user is already in the ride
    const alreadyJoined = ride.passengers.some(p => p.userId.toString() === passengerId);
    if (alreadyJoined) {
      throw new BadRequestError("Passenger has already joined this ride");
    }

    // Get passenger info
    const User = (await import('../models/User.js')).default;
    const user = await User.findById(passengerId).select('firstName lastName phone');

    if (!user) {
      throw new NotFoundError("Passenger not found");
    }

    // Add passenger to ride
    ride.passengers.push({
      userId: passengerId,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      status: ride.status === "ARRIVED" ? "ONBOARD" : "WAITING",
      isOriginalBooker: false,
      joinedAt: new Date(),
    });

    ride.currentPassengerCount = ride.passengers.length;
    await ride.save();

    console.log(`✅ Rider approved: Passenger ${user.firstName} ${user.lastName} joined ride ${rideId}`);

    // Broadcast passenger update
    if (req.io) {
      const updatedRide = await Ride.findById(rideId)
        .populate("customer", "firstName lastName phone")
        .populate("rider", "firstName lastName phone vehicleType");
      
      req.io.to(`ride_${rideId}`).emit("passengerUpdate", updatedRide);
      
      // Notify the passenger that they were approved
      const passengerSocket = [...req.io.sockets.sockets.values()].find(
        socket => socket.user?.id === passengerId
      );
      if (passengerSocket) {
        passengerSocket.emit("joinRequestApproved", {
          rideId: rideId,
          ride: updatedRide,
          message: "Your join request was approved!"
        });
      }
    }

    res.status(StatusCodes.OK).json({
      message: "Passenger join request approved",
      ride,
    });
  } catch (error) {
    console.error("Error approving join request:", error);
    throw new BadRequestError(error.message || "Failed to approve join request");
  }
};

// Decline passenger join request (rider only)
export const declinePassengerJoinRequest = async (req, res) => {
  const { rideId } = req.params;
  const { passengerId } = req.body;
  const riderId = req.user.id;

  if (!rideId || !passengerId) {
    throw new BadRequestError("Ride ID and passenger ID are required");
  }

  try {
    const ride = await Ride.findById(rideId);

    if (!ride) {
      throw new NotFoundError("Ride not found");
    }

    // Verify that the requester is the assigned rider
    if (!ride.rider || ride.rider.toString() !== riderId) {
      throw new BadRequestError("Only the assigned rider can decline join requests");
    }

    console.log(`❌ Rider declined: Passenger join request for ride ${rideId}`);

    // Notify the passenger that they were declined
    if (req.io) {
      const passengerSocket = [...req.io.sockets.sockets.values()].find(
        socket => socket.user?.id === passengerId
      );
      if (passengerSocket) {
        passengerSocket.emit("joinRequestDeclined", {
          rideId: rideId,
          message: "Your join request was declined by the rider"
        });
      }
    }

    res.status(StatusCodes.OK).json({
      message: "Passenger join request declined",
    });
  } catch (error) {
    console.error("Error declining join request:", error);
    throw new BadRequestError(error.message || "Failed to decline join request");
  }
};

// Update passenger status (for rider to mark passengers as onboard/dropped)
export const updatePassengerStatus = async (req, res) => {
  const { rideId, passengerId } = req.params;
  const { status } = req.body;
  const riderId = req.user.id;

  if (!rideId || !passengerId || !status) {
    throw new BadRequestError("Ride ID, passenger ID, and status are required");
  }

  if (!["WAITING", "ONBOARD", "DROPPED"].includes(status)) {
    throw new BadRequestError("Invalid passenger status");
  }

  try {
    const ride = await Ride.findById(rideId)
      .populate("customer", "firstName lastName phone")
      .populate("rider", "firstName lastName phone vehicleType");

    if (!ride) {
      throw new NotFoundError("Ride not found");
    }

    // Verify that the requester is the assigned rider
    if (!ride.rider || ride.rider._id.toString() !== riderId) {
      throw new BadRequestError("Only the assigned rider can update passenger status");
    }

    // Find and update passenger
    const passenger = ride.passengers.find(p => p.userId.toString() === passengerId);
    if (!passenger) {
      throw new NotFoundError("Passenger not found in this ride");
    }

    passenger.status = status;
    if (status === "ONBOARD" && !passenger.boardedAt) {
      passenger.boardedAt = new Date();
    }

    await ride.save();

    console.log(`👤 Passenger ${passenger.firstName} ${passenger.lastName} status updated to ${status} in ride ${rideId}`);

    // Broadcast passenger update to all connected clients
    if (req.io) {
      const updatedRide = await Ride.findById(rideId)
        .populate("customer", "firstName lastName phone")
        .populate("rider", "firstName lastName phone vehicleType");
      
      req.io.to(`ride_${rideId}`).emit("passengerUpdate", updatedRide);
      
      // Notify the specific passenger
      const passengerSocket = [...req.io.sockets.sockets.values()].find(
        socket => socket.user?.id === passengerId
      );
      if (passengerSocket) {
        passengerSocket.emit("yourStatusUpdated", {
          status,
          ride: updatedRide
        });
      }
    }

    res.status(StatusCodes.OK).json({
      message: `Passenger status updated to ${status}`,
      ride,
    });
  } catch (error) {
    console.error("Error updating passenger status:", error);
    throw new BadRequestError(error.message || "Failed to update passenger status");
  }
};

// Remove a passenger from ride
export const removePassenger = async (req, res) => {
  const { rideId, passengerId } = req.params;
  const requesterId = req.user.id;

  if (!rideId || !passengerId) {
    throw new BadRequestError("Ride ID and passenger ID are required");
  }

  try {
    const ride = await Ride.findById(rideId)
      .populate("customer", "firstName lastName phone")
      .populate("rider", "firstName lastName phone vehicleType");

    if (!ride) {
      throw new NotFoundError("Ride not found");
    }

    // Check authorization: either the passenger themselves or the rider can remove
    const isRider = ride.rider && ride.rider._id.toString() === requesterId;
    const isPassenger = passengerId === requesterId;

    if (!isRider && !isPassenger) {
      throw new BadRequestError("You are not authorized to remove this passenger");
    }

    // Find passenger
    const passengerIndex = ride.passengers.findIndex(p => p.userId.toString() === passengerId);
    if (passengerIndex === -1) {
      throw new NotFoundError("Passenger not found in this ride");
    }

    const passenger = ride.passengers[passengerIndex];

    // Don't allow removing the original booker if they're the only passenger
    if (passenger.isOriginalBooker && ride.passengers.length === 1) {
      throw new BadRequestError("Cannot remove the original booker when they are the only passenger. Cancel the ride instead.");
    }

    // Remove passenger
    ride.passengers.splice(passengerIndex, 1);
    ride.currentPassengerCount = ride.passengers.length;
    await ride.save();

    console.log(`👋 Passenger ${passenger.firstName} ${passenger.lastName} removed from ride ${rideId}. Remaining passengers: ${ride.currentPassengerCount}`);

    // Broadcast passenger update to all connected clients
    if (req.io) {
      const updatedRide = await Ride.findById(rideId)
        .populate("customer", "firstName lastName phone")
        .populate("rider", "firstName lastName phone vehicleType");
      
      req.io.to(`ride_${rideId}`).emit("passengerUpdate", updatedRide);
      
      // Notify the removed passenger
      const passengerSocket = [...req.io.sockets.sockets.values()].find(
        socket => socket.user?.id === passengerId
      );
      if (passengerSocket) {
        passengerSocket.emit("removedFromRide", {
          rideId,
          message: isPassenger ? "You have left the ride" : "You have been removed from the ride"
        });
      }
    }

    res.status(StatusCodes.OK).json({
      message: "Passenger removed successfully",
      ride,
    });
  } catch (error) {
    console.error("Error removing passenger:", error);
    throw new BadRequestError(error.message || "Failed to remove passenger");
  }
};

// Get available rides that can accept new passengers
export const getAvailableRidesForJoining = async (req, res) => {
  const userId = req.user.id;

  try {
    // Find rides that are:
    // 1. In progress (START or ARRIVED status)
    // 2. Accepting new passengers
    // 3. Not full
    // 4. User is not already in
    const availableRides = await Ride.find({
      status: { $in: ["SEARCHING_FOR_RIDER", "START", "ARRIVED"] },
      acceptingNewPassengers: true,
      currentPassengerCount: { $lt: 6 },
      "passengers.userId": { $ne: userId }
    })
    .populate("customer", "firstName lastName phone")
    .populate("rider", "firstName lastName phone vehicleType")
    .sort({ createdAt: -1 });

    console.log(`🔍 Found ${availableRides.length} available rides for user ${userId} to join`);

    res.status(StatusCodes.OK).json({
      message: "Available rides retrieved successfully",
      count: availableRides.length,
      rides: availableRides,
    });
  } catch (error) {
    console.error("Error retrieving available rides:", error);
    throw new BadRequestError("Failed to retrieve available rides");
  }
};

// Toggle accepting new passengers (for rider)
export const toggleAcceptingPassengers = async (req, res) => {
  const { rideId } = req.params;
  const riderId = req.user.id;

  if (!rideId) {
    throw new BadRequestError("Ride ID is required");
  }

  try {
    const ride = await Ride.findById(rideId)
      .populate("customer", "firstName lastName phone")
      .populate("rider", "firstName lastName phone vehicleType");

    if (!ride) {
      throw new NotFoundError("Ride not found");
    }

    // Verify that the requester is the assigned rider
    if (!ride.rider || ride.rider._id.toString() !== riderId) {
      throw new BadRequestError("Only the assigned rider can toggle passenger acceptance");
    }

    ride.acceptingNewPassengers = !ride.acceptingNewPassengers;
    await ride.save();

    console.log(`🚦 Ride ${rideId} ${ride.acceptingNewPassengers ? 'now accepting' : 'stopped accepting'} new passengers`);

    // Broadcast update
    if (req.io) {
      const updatedRide = await Ride.findById(rideId)
        .populate("customer", "firstName lastName phone")
        .populate("rider", "firstName lastName phone vehicleType");
      
      req.io.to(`ride_${rideId}`).emit("passengerUpdate", updatedRide);
    }

    res.status(StatusCodes.OK).json({
      message: `Ride is ${ride.acceptingNewPassengers ? 'now accepting' : 'no longer accepting'} new passengers`,
      acceptingNewPassengers: ride.acceptingNewPassengers,
      ride,
    });
  } catch (error) {
    console.error("Error toggling passenger acceptance:", error);
    throw new BadRequestError(error.message || "Failed to toggle passenger acceptance");
  }
};

// ============================================
// EARLY STOP FEATURE - Complete ride before reaching drop-off
// ============================================

// Request early stop (customer requests to stop before drop-off)
export const requestEarlyStop = async (req, res) => {
  const { rideId } = req.params;
  const { location, reason } = req.body;
  const userId = req.user.id;

  if (!rideId) {
    throw new BadRequestError("Ride ID is required");
  }

  if (!location || !location.latitude || !location.longitude) {
    throw new BadRequestError("Current location is required for early stop");
  }

  try {
    const ride = await Ride.findById(rideId)
      .populate("customer", "firstName lastName phone")
      .populate("rider", "firstName lastName phone vehicleType");

    if (!ride) {
      throw new NotFoundError("Ride not found");
    }

    // Only allow early stop during ARRIVED status (ride in progress)
    if (ride.status !== "ARRIVED") {
      throw new BadRequestError("Early stop can only be requested during an active ride (ARRIVED status)");
    }

    // Check if user is authorized (must be customer or rider)
    const isCustomer = ride.customer._id.toString() === userId;
    const isRider = ride.rider && ride.rider._id.toString() === userId;
    
    if (!isCustomer && !isRider) {
      throw new BadRequestError("You are not authorized to request early stop for this ride");
    }

    const requestedBy = isCustomer ? "customer" : "rider";

    // Get address for the early stop location using reverse geocoding
    let earlyStopAddress = `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`;
    try {
      const { getCleanAddress } = await import('../utils/geocodingUtils.js');
      earlyStopAddress = await getCleanAddress(location.latitude, location.longitude);
    } catch (geocodeError) {
      console.log(`⚠️ Could not geocode early stop location: ${geocodeError.message}`);
    }

    // Update ride with early stop information
    ride.earlyStop = {
      completedEarly: true,
      location: {
        latitude: location.latitude,
        longitude: location.longitude,
      },
      address: earlyStopAddress,
      requestedBy: requestedBy,
      requestedAt: new Date(),
      reason: reason || null,
    };

    // Calculate the actual distance traveled (from pickup to early stop location)
    const actualDistanceTraveled = calculateDistance(
      ride.pickup.latitude,
      ride.pickup.longitude,
      location.latitude,
      location.longitude
    );

    // Update route logs with actual distance
    if (!ride.routeLogs) {
      ride.routeLogs = {};
    }
    ride.routeLogs.actualDistance = actualDistanceTraveled;

    // Mark ride as completed
    ride.status = "COMPLETED";
    
    // Update trip logs
    if (!ride.tripLogs) {
      ride.tripLogs = {};
    }
    ride.tripLogs.dropoffTime = new Date();
    ride.tripLogs.endTime = new Date();
    ride.finalDistance = actualDistanceTraveled;

    // Update all passengers to DROPPED
    if (ride.passengers && ride.passengers.length > 0) {
      ride.passengers.forEach(passenger => {
        if (passenger.status === "ONBOARD" || passenger.status === "WAITING") {
          passenger.status = "DROPPED";
        }
      });
    }

    await ride.save();

    console.log(`🛑 Early stop completed for ride ${rideId}`);
    console.log(`   Requested by: ${requestedBy}`);
    console.log(`   Location: ${earlyStopAddress}`);
    console.log(`   Distance traveled: ${actualDistanceTraveled.toFixed(2)} km`);
    console.log(`   Original distance: ${ride.distance.toFixed(2)} km`);

    // Create dropoff checkpoint at early stop location
    try {
      await createDropoffCheckpoint(
        rideId,
        ride.rider._id,
        ride.customer._id,
        location,
        earlyStopAddress
      );
      console.log(`📍 Checkpoint: DROPOFF (early stop) snapshot created for ride ${rideId}`);
    } catch (checkpointError) {
      console.error(`⚠️ Failed to create early stop checkpoint:`, checkpointError);
    }

    // Broadcast ride completion to all parties
    if (req.io) {
      console.log(`📢 Broadcasting early stop completion for ride ${rideId}`);
      
      req.io.to(`ride_${rideId}`).emit("rideUpdate", ride);
      req.io.to(`ride_${rideId}`).emit("rideCompleted", ride);
      req.io.to(`ride_${rideId}`).emit("earlyStopCompleted", {
        ride,
        earlyStop: ride.earlyStop,
        message: `Ride completed early at ${earlyStopAddress}`,
      });

      // Notify each passenger individually
      ride.passengers.forEach(passenger => {
        const passengerSocket = [...req.io.sockets.sockets.values()].find(
          socket => socket.user?.id === passenger.userId.toString()
        );
        if (passengerSocket) {
          passengerSocket.emit("yourStatusUpdated", {
            status: "DROPPED",
            ride: ride,
            earlyStop: true,
          });
          console.log(`👤 Notified passenger ${passenger.firstName} of early stop completion`);
        }
      });

      // Remove from all on-duty riders' lists
      req.io.to("onDuty").emit("rideCompleted", {
        _id: rideId,
        rideId: rideId,
        ride: ride,
      });
    }

    res.status(StatusCodes.OK).json({
      message: "Ride completed early successfully",
      ride,
      earlyStop: ride.earlyStop,
      actualDistanceTraveled: actualDistanceTraveled.toFixed(2),
      originalDistance: ride.distance.toFixed(2),
    });
  } catch (error) {
    console.error("Error processing early stop:", error);
    throw new BadRequestError(error.message || "Failed to process early stop request");
  }
};

// Confirm or decline early stop request (for rider to confirm customer's request)
export const respondToEarlyStopRequest = async (req, res) => {
  const { rideId } = req.params;
  const { action, location } = req.body; // action: 'confirm' or 'decline'
  const riderId = req.user.id;

  if (!rideId || !action) {
    throw new BadRequestError("Ride ID and action are required");
  }

  if (!['confirm', 'decline'].includes(action)) {
    throw new BadRequestError("Action must be 'confirm' or 'decline'");
  }

  try {
    const ride = await Ride.findById(rideId)
      .populate("customer", "firstName lastName phone")
      .populate("rider", "firstName lastName phone vehicleType");

    if (!ride) {
      throw new NotFoundError("Ride not found");
    }

    // Verify requester is the rider
    if (!ride.rider || ride.rider._id.toString() !== riderId) {
      throw new BadRequestError("Only the assigned rider can respond to early stop requests");
    }

    if (action === 'confirm') {
      // Use the provided location or rider's current location
      const stopLocation = location || req.body.riderLocation;
      
      if (!stopLocation || !stopLocation.latitude || !stopLocation.longitude) {
        throw new BadRequestError("Location is required to confirm early stop");
      }

      // Process the early stop (same logic as requestEarlyStop)
      let earlyStopAddress = `${stopLocation.latitude.toFixed(6)}, ${stopLocation.longitude.toFixed(6)}`;
      try {
        const { getCleanAddress } = await import('../utils/geocodingUtils.js');
        earlyStopAddress = await getCleanAddress(stopLocation.latitude, stopLocation.longitude);
      } catch (geocodeError) {
        console.log(`⚠️ Could not geocode early stop location: ${geocodeError.message}`);
      }

      ride.earlyStop = {
        completedEarly: true,
        location: {
          latitude: stopLocation.latitude,
          longitude: stopLocation.longitude,
        },
        address: earlyStopAddress,
        requestedBy: "customer",
        requestedAt: new Date(),
        reason: "Customer requested early stop",
      };

      const actualDistanceTraveled = calculateDistance(
        ride.pickup.latitude,
        ride.pickup.longitude,
        stopLocation.latitude,
        stopLocation.longitude
      );

      ride.status = "COMPLETED";
      if (!ride.tripLogs) ride.tripLogs = {};
      ride.tripLogs.dropoffTime = new Date();
      ride.tripLogs.endTime = new Date();
      ride.finalDistance = actualDistanceTraveled;

      if (ride.passengers) {
        ride.passengers.forEach(p => {
          if (p.status === "ONBOARD" || p.status === "WAITING") {
            p.status = "DROPPED";
          }
        });
      }

      await ride.save();

      // Broadcast completion
      if (req.io) {
        req.io.to(`ride_${rideId}`).emit("rideCompleted", ride);
        req.io.to(`ride_${rideId}`).emit("earlyStopConfirmed", { ride, earlyStop: ride.earlyStop });
      }

      res.status(StatusCodes.OK).json({
        message: "Early stop confirmed and ride completed",
        ride,
        earlyStop: ride.earlyStop,
      });
    } else {
      // Decline - notify customer that rider wants to continue
      if (req.io) {
        const customerSocket = [...req.io.sockets.sockets.values()].find(
          socket => socket.user?.id === ride.customer._id.toString()
        );
        if (customerSocket) {
          customerSocket.emit("earlyStopDeclined", {
            rideId,
            message: "The rider has chosen to continue to the original drop-off location",
          });
        }
      }

      res.status(StatusCodes.OK).json({
        message: "Early stop request declined. Continuing to original drop-off.",
        ride,
      });
    }
  } catch (error) {
    console.error("Error responding to early stop:", error);
    throw new BadRequestError(error.message || "Failed to respond to early stop request");
  }
};

// ============================================

export const createRide = async (req, res) => {
  const { vehicle, pickup, drop } = req.body;
  const customerId = req.user.id; // Fixed: Use req.user.id instead of req.user

  if (!vehicle || !pickup || !drop) {
    throw new BadRequestError("Vehicle, pickup, and drop locations are required.");
  }

  try {
    // Calculate distance between pickup and drop
    const distance = calculateDistance(
      pickup.latitude,
      pickup.longitude,
      drop.latitude,
      drop.longitude
    );
    
    console.log(`🛣️ Distance calculated: ${distance.toFixed(2)} km`);
    
    // Calculate fare using dynamic fare configuration from database
    let fare = 0;
    let fareBreakdown = null;
    try {
      const FareConfig = (await import('../models/FareConfig.js')).default;
      const fareResult = await FareConfig.calculateFare(vehicle, distance, 1);
      fare = fareResult.totalFare;
      fareBreakdown = fareResult.breakdown;
      console.log(`💰 Fare calculated: ₱${fare} for ${vehicle} (${distance.toFixed(2)} km)`);
    } catch (fareError) {
      console.log(`⚠️ Could not calculate fare, using default: ${fareError.message}`);
      // Fallback to simple calculation if FareConfig fails
      fare = Math.max(20, distance * 2.8);
    }

    // Generate OTP
    const otp = generateOTP(); // Fixed: Use correct function name
    
    console.log(`🔑 Creating ride with OTP: ${otp}`);

    // Get customer info for passengers array
    const User = (await import('../models/User.js')).default;
    const customer = await User.findById(customerId).select('firstName lastName phone');

    const ride = await Ride.create({
      customer: customerId,
      pickup,
      drop,
      vehicle,
      distance,
      fare,
      otp,
      status: "SEARCHING_FOR_RIDER",
      // Initialize passengers array with the original booker
      passengers: [{
        userId: customerId,
        firstName: customer.firstName,
        lastName: customer.lastName,
        phone: customer.phone,
        status: "WAITING",
        isOriginalBooker: true,
        joinedAt: new Date(),
      }],
      currentPassengerCount: 1,
      maxPassengers: 6,
      acceptingNewPassengers: true,
      // ============================================
      // TRIP LOG: Record request time when ride is created
      // ============================================
      tripLogs: {
        requestTime: new Date(),
      },
      // ============================================
      // ROUTE LOGS: Store estimated distance from routing calculation
      // ============================================
      routeLogs: {
        estimatedDistance: distance, // Distance from routing API/calculation
        actualDistance: null, // Will be calculated on completion
        routeDistance: null, // Will be calculated from GPS checkpoints
        deviationPercentage: null,
        hasSignificantDeviation: false,
      },
      // ============================================
    });

    console.log(`✅ Ride created with ID: ${ride._id}, OTP: ${otp}, Initial passenger: ${customer.firstName} ${customer.lastName}`);

    // Populate the ride with customer info
    const populatedRide = await Ride.findById(ride._id).populate("customer", "firstName lastName phone");

    // Broadcast new ride to ALL on-duty riders
    if (req.io) {
      console.log(`🚨 Broadcasting new ride ${ride._id} to all on-duty riders`);
      
      // Get count of on-duty riders
      const onDutyRoom = req.io.sockets.adapter.rooms.get('onDuty');
      const onDutyCount = onDutyRoom ? onDutyRoom.size : 0;
      console.log(`👥 Currently ${onDutyCount} riders on duty`);
      
      // Emit the new ride request to all on-duty riders
      req.io.to("onDuty").emit("newRideRequest", populatedRide);
      console.log(`📢 Emitted 'newRideRequest' event for ride ${ride._id}`);
      
      // Also emit updated list of all searching rides
      const allSearchingRides = await Ride.find({ 
        status: "SEARCHING_FOR_RIDER" 
      }).populate("customer", "firstName lastName phone");
      
      console.log(`📋 Sending updated list of ${allSearchingRides.length} searching rides`);
      req.io.to("onDuty").emit("allSearchingRides", allSearchingRides);
      
      // Log the IDs of all searching rides for debugging
      if (allSearchingRides.length > 0) {
        const rideIds = allSearchingRides.map(r => r._id.toString());
        console.log(`📝 Current searching ride IDs: ${rideIds.join(', ')}`);
      }
      
      // Direct broadcast to each on-duty rider individually as a fallback
      const sockets = await req.io.fetchSockets();
      const riderSockets = sockets.filter(socket => 
        socket.user?.role === 'rider' && 
        socket.rooms.has('onDuty')
      );
      
      console.log(`🔄 Direct broadcasting to ${riderSockets.length} rider sockets`);
      
      riderSockets.forEach(socket => {
        socket.emit("newRideRequest", populatedRide);
        socket.emit("allSearchingRides", allSearchingRides);
        console.log(`📲 Direct emit to rider: ${socket.user?.id}`);
      });
    }

    res
      .status(StatusCodes.CREATED)
      .json({ message: "Ride created successfully", ride: populatedRide });
  } catch (error) {
    console.error("❌ Error creating ride:", error);
    throw new BadRequestError("Failed to create ride");
  }
};
