import geolib from "geolib";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Ride from "../models/Ride.js";
import Rating from "../models/Rating.js";

const onDutyRiders = new Map();

const handleSocketConnection = (io) => {
  io.use(async (socket, next) => {
    try {
      console.log(`🔐 Socket auth attempt from ${socket.id}`);
      
      // Get token from headers
      const token = socket.handshake.headers.access_token;
      if (!token) {
        console.log(`❌ Socket auth failed: No token provided`);
        return next(new Error("Authentication invalid: No token"));
      }
      
      console.log(`🔍 Verifying token: ${token.substring(0, 15)}...`);
      
      // Verify token
      const payload = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
      console.log(`✅ Token verified for user: ${payload.id}, role: ${payload.role}`);
      
      // Find user in database
      const user = await User.findById(payload.id);
      if (!user) {
        console.log(`❌ User not found: ${payload.id}`);
        return next(new Error("Authentication invalid: User not found"));
      }
      
      console.log(`👤 User authenticated: ${user.firstName} ${user.lastName} (${user.role})`);
      
      // Attach user to socket
      socket.user = { id: payload.id, role: user.role };
      next();
    } catch (error) {
      console.error(`⚠️ Socket Auth Error for ${socket.id}:`, error.message);
      next(new Error(`Authentication invalid: ${error.message}`));
    }
  });

  io.on("connection", (socket) => {
    const user = socket.user;
    console.log(`User Joined: ${user.id} (${user.role})`);

    if (user.role === "rider") {
      socket.on("goOnDuty", async (coords) => {
        // Get rider's vehicle type from database
        const riderInfo = await User.findById(user.id).select("vehicleType firstName lastName");
        
        console.log(`🚗 Rider ${user.id} (${riderInfo?.firstName} ${riderInfo?.lastName}) going on duty with coords:`, coords);
        console.log(`🚗 Rider ${user.id} vehicle type:`, riderInfo?.vehicleType);
        
        onDutyRiders.set(user.id, { 
          socketId: socket.id, 
          coords,
          riderId: user.id,
          vehicleType: riderInfo?.vehicleType || "Tricycle", // Store vehicle type
          name: `${riderInfo?.firstName || ''} ${riderInfo?.lastName || ''}`
        });
        
        // Join the onDuty room
        socket.join("onDuty");
        console.log(`✅ Rider ${user.id} is now on duty with vehicle: ${riderInfo?.vehicleType || "Tricycle"}`);
        console.log(`👥 Total on-duty riders: ${onDutyRiders.size}`);
        
        // Immediately send all searching rides to the newly on-duty rider
        try {
          const searchingRides = await Ride.find({ 
            status: "SEARCHING_FOR_RIDER" 
          }).populate("customer", "firstName lastName phone");
          
          console.log(`📤 Sending ${searchingRides.length} searching rides to newly on-duty rider ${user.id}`);
          
          // Force a small delay to ensure socket is ready (helps with race conditions)
          setTimeout(() => {
            // Send all rides at once
            socket.emit("allSearchingRides", searchingRides);
            
            // Also send individual ride notifications to ensure they're received
            if (searchingRides.length > 0) {
              console.log(`📝 Sending individual ride notifications for ${searchingRides.length} rides`);
              searchingRides.forEach(ride => {
                socket.emit("newRideRequest", ride);
              });
              
              // Log the ride IDs
              const rideIds = searchingRides.map(r => r._id.toString());
              console.log(`📝 Ride IDs: ${rideIds.join(', ')}`);
            }
            
            // Confirm successful send
            console.log(`✅ Successfully sent rides to newly on-duty rider ${user.id}`);
          }, 500); // Small delay to ensure socket is ready
        } catch (error) {
          console.error("❌ Error sending rides to newly on-duty rider:", error);
        }
        
        updateNearbyriders();
      });

      socket.on("goOffDuty", () => {
        onDutyRiders.delete(user.id);
        socket.leave("onDuty");
        console.log(`rider ${user.id} is now off duty.`);
        updateNearbyriders();
      });

      socket.on("updateLocation", (coords) => {
        if (onDutyRiders.has(user.id)) {
          onDutyRiders.get(user.id).coords = coords;
          console.log(`rider ${user.id} updated location.`);
          updateNearbyriders();
          socket.to(`rider_${user.id}`).emit("riderLocationUpdate", {
            riderId: user.id,
            coords,
          });
        }
      });

      // Handle request for all searching rides (city-wide)
      socket.on("requestAllSearchingRides", async () => {
        try {
          console.log(`🔍 Rider ${user.id} requesting all searching rides`);
          
          // Get rider's vehicle type from database or onDutyRiders map
          const riderInfo = onDutyRiders.get(user.id) || {};
          const vehicleType = riderInfo.vehicleType || "Single Motorcycle";
          console.log(`🚗 Rider ${user.id} vehicle type: ${vehicleType}`);
          
          // Find all rides with SEARCHING_FOR_RIDER status
          const searchingRides = await Ride.find({ 
            status: "SEARCHING_FOR_RIDER" 
          }).populate("customer", "firstName lastName phone");
          
          console.log(`📋 Found ${searchingRides.length} searching rides for rider ${user.id}`);
          
          // Send all rides to the rider
          console.log(`📤 Emitting ${searchingRides.length} rides to rider ${user.id}`);
          
          // Force a small delay to ensure socket is ready (helps with race conditions)
          setTimeout(() => {
            socket.emit("allSearchingRides", searchingRides);
            
            // Log success message
            console.log(`✅ Successfully sent ${searchingRides.length} rides to rider ${user.id}`);
            
            // Log the ride IDs for debugging
            if (searchingRides.length > 0) {
              const rideIds = searchingRides.map(r => r._id.toString());
              console.log(`📝 Ride IDs: ${rideIds.join(', ')}`);
              
              // Log more details about each ride
              searchingRides.forEach(ride => {
                console.log(`📍 Ride ${ride._id}: ${ride.pickup?.address} to ${ride.drop?.address}, Vehicle: ${ride.vehicle}, Fare: ${ride.fare}`);
              });
              
              // Also send individual ride notifications to ensure they're received
              searchingRides.forEach(ride => {
                socket.emit("newRideRequest", ride);
              });
            } else {
              console.log(`🚧 No searching rides found to send to rider ${user.id}`);
            }
          }, 100); // Small delay to ensure socket is ready
        } catch (error) {
          console.error(`❌ Error fetching searching rides for rider ${user.id}:`, error);
          socket.emit("allSearchingRides", []);
        }
      });
    }

    if (user.role === "customer") {
      socket.on("subscribeToZone", (customerCoords) => {
        console.log(`Customer ${user.id} subscribing to zone with coords:`, customerCoords);
        socket.user.coords = customerCoords;
        sendNearbyRiders(socket, customerCoords);
      });

      socket.on("getDriverDetails", async ({ riderId }) => {
        try {
          if (!riderId) {
            return socket.emit("error", { message: "Driver ID is required" });
          }
          
          const driver = await User.findById(riderId).select("firstName lastName phone licenseId _id");
          
          if (!driver) {
            return socket.emit("error", { message: "Driver not found" });
          }
          
          // Get driver's ratings
          const ratings = await Rating.find({ rider: riderId });
          
          // Calculate average rating
          const totalRatings = ratings.length;
          const sumRatings = ratings.reduce((sum, rating) => sum + rating.rating, 0);
          const averageRating = totalRatings > 0 ? (sumRatings / totalRatings).toFixed(1) : "0.0";
          
          // Get vehicle type from onDuty data or database
          const driverDetails = await User.findById(riderId).select("vehicleType");
          const vehicleType = onDutyRiders.get(riderId)?.vehicleType || driverDetails?.vehicleType || "Tricycle";
          
          // Send driver details back to the customer
          socket.emit("driverDetailsResponse", {
            _id: driver._id,
            firstName: driver.firstName,
            lastName: driver.lastName,
            phone: driver.phone,
            licenseId: driver.licenseId,
            averageRating: averageRating,
            totalRatings: totalRatings,
            vehicleType: vehicleType
          });
          
          console.log(`Sent driver ${riderId} details to customer ${user.id}`);
        } catch (error) {
          console.error("Error fetching driver details:", error);
          socket.emit("error", { message: "Error fetching driver details" });
        }
      });

      socket.on("searchrider", async (rideId) => {
        try {
          const ride = await Ride.findById(rideId).populate("customer rider");
          if (!ride) return socket.emit("error", { message: "Ride not found" });

          const { latitude: pickupLat, longitude: pickupLon } = ride.pickup;

          let retries = 0;
          let rideAccepted = false;
          let canceled = false;
          const MAX_RETRIES = 20;

          const retrySearch = async () => {
            if (canceled) return;
            
            // Check if ride has been completed in the meantime
            const currentRide = await Ride.findById(rideId);
            if (currentRide && currentRide.status === "COMPLETED") {
              console.log(`🔒 Ride ${rideId} is now COMPLETED - stopping retry interval`);
              clearInterval(retryInterval);
              return;
            }
            
            retries++;

            const riders = sendNearbyRiders(socket, { latitude: pickupLat, longitude: pickupLon }, ride);
            if (riders.length > 0 || retries >= MAX_RETRIES) {
              clearInterval(retryInterval);
              if (!rideAccepted && retries >= MAX_RETRIES) {
                // ✅ FIXED: Update status to TIMEOUT instead of deleting, but protect COMPLETED rides
                const timeoutRide = await Ride.findById(rideId);
                if (timeoutRide) {
                  // CRITICAL: Never change a COMPLETED ride's status
                  if (timeoutRide.status === "COMPLETED") {
                    console.log(`🔒 Ride ${rideId} is COMPLETED - protected from status change to TIMEOUT`);
                  } else {
                    timeoutRide.status = "TIMEOUT";
                    await timeoutRide.save();
                    console.log(`🕐 Ride ${rideId} timed out - status updated to TIMEOUT (NOT DELETED)`);
                  }
                }
                
                // Broadcast ride timeout to all on-duty riders
                io.to("onDuty").emit("rideOfferTimeout", rideId);
                
                socket.emit("error", { message: "No riders found within 5 minutes." });
              }
            }
          };

          const retryInterval = setInterval(retrySearch, 10000);

          socket.on("rideAccepted", () => {
            rideAccepted = true;
            clearInterval(retryInterval);
          });
          
          // Add listener for ride completion to prevent any status changes after completion
          socket.on("rideCompleted", () => {
            console.log(`🔒 Ride ${rideId} completed - ensuring no further status changes`);
            rideAccepted = true;
            clearInterval(retryInterval);
          });

          socket.on("cancelRide", async () => {
            canceled = true;
            clearInterval(retryInterval);
            
            // ✅ FIXED: Update status to CANCELLED instead of deleting, but protect COMPLETED rides
            const cancelRide = await Ride.findById(rideId);
            if (cancelRide) {
              // CRITICAL: Never change a COMPLETED ride's status
              if (cancelRide.status === "COMPLETED") {
                console.log(`🔒 Ride ${rideId} is COMPLETED - protected from status change to CANCELLED`);
              } else {
                cancelRide.status = "CANCELLED";
                await cancelRide.save();
                console.log(`🚫 Customer ${user.id} canceled ride ${rideId} - status updated to CANCELLED (NOT DELETED)`);
              }
            }
            
            socket.emit("rideCanceled", { message: "Ride canceled" });

            // Broadcast ride cancellation to all on-duty riders
            io.to("onDuty").emit("rideOfferCanceled", rideId);

            if (ride.rider) {
              const riderSocket = getRiderSocket(ride.rider._id);
              riderSocket?.emit("rideCanceled", { message: `Customer ${user.id} canceled the ride.` });
            }
          });
        } catch (error) {
          console.error("Error searching for rider:", error);
          socket.emit("error", { message: "Error searching for rider" });
        }
      });
    }

    socket.on("subscribeToriderLocation", (riderId) => {
      const rider = onDutyRiders.get(riderId);
      if (rider) {
        socket.join(`rider_${riderId}`);
        socket.emit("riderLocationUpdate", { riderId, coords: rider.coords });
        console.log(`User ${user.id} subscribed to rider ${riderId}'s location.`);
      }
    });

    socket.on("subscribeRide", async (rideId) => {
      console.log(`User ${user.id} (${user.role}) subscribing to ride ${rideId}`);
      socket.join(`ride_${rideId}`);
      try {
        const rideData = await Ride.findById(rideId).populate("customer rider");
        console.log(`Sending ride data to user ${user.id}: Status=${rideData?.status}, OTP=${rideData?.otp}`);
        socket.emit("rideData", rideData);
      } catch (error) {
        console.error(`Error fetching ride ${rideId}:`, error);
        socket.emit("error", { message: "Failed to receive ride data" });
      }
    });

    socket.on("disconnect", () => {
      if (user.role === "rider") onDutyRiders.delete(user.id);
      console.log(`${user.role} ${user.id} disconnected.`);
    });

    function updateNearbyriders() {
      io.sockets.sockets.forEach((socket) => {
        if (socket.user?.role === "customer") {
          const customerCoords = socket.user.coords;
          if (customerCoords) sendNearbyRiders(socket, customerCoords);
        }
      });
    }

    async function sendNearbyRiders(socket, location, ride = null) {
      try {
        console.log('🔍 Finding riders near location:', location);
        console.log('👥 Total on-duty riders:', onDutyRiders.size);
        
        const nearbyRidersArray = [];
        
        // Process each rider to get complete information
        for (const [riderId, rider] of onDutyRiders.entries()) {
          try {
            // Get rider's info from database
            const riderInfo = await User.findById(riderId).select("firstName lastName photo vehicleType");
            
            // Calculate distance in meters
            const distance = geolib.getDistance(
              { latitude: location.latitude, longitude: location.longitude },
              { latitude: rider.coords.latitude, longitude: rider.coords.longitude }
            );
            
            // Get rider's ratings
            const ratings = await Rating.find({ rider: riderId });
            const totalRatings = ratings.length;
            const averageRating = totalRatings > 0 
              ? ratings.reduce((sum, r) => sum + r.rating, 0) / totalRatings 
              : 0;
            
            const riderData = {
              riderId: rider.riderId,
              coords: rider.coords,
              vehicleType: rider.vehicleType || riderInfo?.vehicleType || "Tricycle",
              name: rider.name || `${riderInfo?.firstName || ''} ${riderInfo?.lastName || ''}`.trim() || `Rider ${riderId.substring(0, 6)}`,
              firstName: riderInfo?.firstName || "",
              lastName: riderInfo?.lastName || "",
              photo: riderInfo?.photo || null,
              distance: distance,
              averageRating: parseFloat(averageRating.toFixed(1)),
              totalRatings: totalRatings,
              heading: rider.coords.heading || 0,
              socketId: rider.socketId
            };
            
            console.log(`📍 Added rider ${riderId} (${riderInfo?.firstName || 'unknown'}) at ${distance.toFixed(0)}m`);
            nearbyRidersArray.push(riderData);
          } catch (error) {
            console.error(`❌ Error processing rider ${riderId}:`, error);
          }
        }
        
        // Sort by distance
        const nearbyriders = nearbyRidersArray
          .filter(rider => rider.distance <= 50000000) // 50,000km for testing
          .sort((a, b) => a.distance - b.distance);
        
        console.log(`📤 Sending ${nearbyriders.length} nearby riders to customer`);
        socket.emit("nearbyriders", nearbyriders);
        
        // If this was triggered by a new ride, notify the riders
        if (ride) {
          nearbyriders.forEach((rider) => {
            if (rider.socketId) {
              io.to(rider.socketId).emit("rideOffer", ride);
            }
          });
        }

        return nearbyriders;
      } catch (error) {
        console.error("Error sending nearby riders:", error);
        return [];
      }
    }

    function getRiderSocket(riderId) {
      const rider = onDutyRiders.get(riderId);
      return rider ? io.sockets.sockets.get(rider.socketId) : null;
    }
  });
};

// Function to broadcast new ride requests to all on-duty riders
export const broadcastNewRideRequest = async (io, rideData) => {
  try {
    console.log(`🚨 Broadcasting new ride request ${rideData._id} to all on-duty riders`);
    
    // Populate the ride data with customer info
    const populatedRide = await Ride.findById(rideData._id).populate("customer", "firstName lastName phone");
    
    if (!populatedRide) {
      console.error(`❌ Cannot broadcast ride ${rideData._id}: Ride not found or was deleted`);
      return;
    }
    
    // Log ride details
    console.log(`📍 Ride details: ${populatedRide.pickup?.address} to ${populatedRide.drop?.address}`);
    console.log(`💰 Fare: ${populatedRide.fare}, Vehicle: ${populatedRide.vehicle}`);
    console.log(`📱 Customer: ${populatedRide.customer?.firstName} ${populatedRide.customer?.lastName}`);
    
    // Broadcast to all riders in the "onDuty" room
    io.to("onDuty").emit("newRideRequest", populatedRide);
    
    // Also update the full list of searching rides for all riders
    const allSearchingRides = await Ride.find({ 
      status: "SEARCHING_FOR_RIDER" 
    }).populate("customer", "firstName lastName phone");
    
    console.log(`📋 Broadcasting updated list of ${allSearchingRides.length} searching rides`);
    io.to("onDuty").emit("allSearchingRides", allSearchingRides);
    
    // Log the number of riders who received the broadcast
    console.log(`💬 Broadcasted ride ${rideData._id} to ${onDutyRiders.size} on-duty riders`);
    
    // Log all on-duty rider IDs
    if (onDutyRiders.size > 0) {
      const riderIds = Array.from(onDutyRiders.keys());
      console.log(`👥 On-duty riders: ${riderIds.join(', ')}`);
    }
  } catch (error) {
    console.error(`❌ Error broadcasting new ride request ${rideData?._id}:`, error);
  }
};

// Function to broadcast ride cancellations
export const broadcastRideCancellation = (io, rideId, reason = "canceled") => {
  console.log(`Broadcasting ride ${reason}: ${rideId}`);
  
  if (reason === "timeout") {
    io.to("onDuty").emit("rideOfferTimeout", rideId);
  } else {
    io.to("onDuty").emit("rideOfferCanceled", rideId);
  }
};

// Function to broadcast ride acceptance
export const broadcastRideAccepted = (io, rideId) => {
  console.log(`Broadcasting ride accepted: ${rideId}`);
  io.to("onDuty").emit("rideAccepted", rideId);
};

export default handleSocketConnection;
