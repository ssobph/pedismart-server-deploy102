import geolib from "geolib";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Ride from "../models/Ride.js";
import Rating from "../models/Rating.js";
import Chat from "../models/Chat.js";
import Message from "../models/Message.js";
import { calculateDistance, MAX_DISTANCE_KM } from "../utils/mapUtils.js";
import { createOngoingCheckpoint } from "../utils/checkpointUtils.js";

const onDutyRiders = new Map();
// Track last checkpoint time per ride to avoid too frequent updates
const lastCheckpointTime = new Map();

// ============================================
// Helper function to filter rides by distance
// ============================================
const filterRidesByDistance = (rides, riderCoords) => {
  // If MAX_DISTANCE_KM is null or undefined, return all rides (feature disabled)
  if (!MAX_DISTANCE_KM) {
    console.log(`📏 Distance filtering DISABLED - showing all ${rides.length} rides`);
    return rides;
  }

  // If rider coordinates are not available, return all rides
  if (!riderCoords || !riderCoords.latitude || !riderCoords.longitude) {
    console.log(`⚠️ Rider coordinates not available - showing all ${rides.length} rides`);
    return rides;
  }

  const filteredRides = rides.filter(ride => {
    // Check if ride has valid pickup coordinates
    if (!ride.pickup || !ride.pickup.latitude || !ride.pickup.longitude) {
      console.log(`⚠️ Ride ${ride._id} has invalid pickup coordinates`);
      return false;
    }

    // Calculate distance between rider and passenger pickup location
    const distance = calculateDistance(
      riderCoords.latitude,
      riderCoords.longitude,
      ride.pickup.latitude,
      ride.pickup.longitude
    );

    const withinRange = distance <= MAX_DISTANCE_KM;
    
    if (!withinRange) {
      console.log(`📏 Ride ${ride._id} filtered out: ${distance.toFixed(2)}km away (max: ${MAX_DISTANCE_KM}km)`);
    }

    return withinRange;
  });

  console.log(`📏 Distance filtering: ${filteredRides.length}/${rides.length} rides within ${MAX_DISTANCE_KM}km`);
  return filteredRides;
};
// ============================================

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
        
        // Immediately send ALL searching rides to the newly on-duty rider (client will handle visual feedback for mismatched rides)
        try {
          const riderVehicleType = riderInfo?.vehicleType || "Tricycle";
          // Only get rides with SEARCHING_FOR_RIDER status (cancelled/timeout rides have different status)
          // Filter out rides where this rider is blacklisted
          const searchingRides = await Ride.find({ 
            status: "SEARCHING_FOR_RIDER",
            blacklistedRiders: { $ne: user.id } // Exclude rides where rider is blacklisted
          }).populate("customer", "firstName lastName phone");
          
          // ============================================
          // Apply MAX_DISTANCE filter if enabled
          // ============================================
          const filteredRides = filterRidesByDistance(searchingRides, coords);
          // ============================================
          
          console.log(`📤 Sending ${filteredRides.length} searching rides (ALL vehicle types) to newly on-duty rider ${user.id} (vehicle: ${riderVehicleType})`);
          
          // Force a small delay to ensure socket is ready (helps with race conditions)
          setTimeout(() => {
            // Send all rides at once
            socket.emit("allSearchingRides", filteredRides);
            
            // Also send individual ride notifications to ensure they're received
            if (filteredRides.length > 0) {
              console.log(`📝 Sending individual ride notifications for ${filteredRides.length} rides`);
              filteredRides.forEach(ride => {
                socket.emit("newRideRequest", ride);
              });
              
              // Log the ride IDs and vehicle types
              const rideIds = filteredRides.map(r => r._id.toString());
              console.log(`📝 Ride IDs: ${rideIds.join(', ')}`);
              
              // Log vehicle type breakdown
              const vehicleBreakdown = filteredRides.reduce((acc, ride) => {
                acc[ride.vehicle] = (acc[ride.vehicle] || 0) + 1;
                return acc;
              }, {});
              console.log(`🚗 Vehicle types: ${JSON.stringify(vehicleBreakdown)}`);
            } else {
              console.log(`🚧 No searching rides found for newly on-duty rider ${user.id}`);
            }
            
            // Confirm successful send
            console.log(`✅ Successfully sent ${filteredRides.length} rides to newly on-duty rider ${user.id}`);
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

      socket.on("updateLocation", async (coords) => {
        if (onDutyRiders.has(user.id)) {
          onDutyRiders.get(user.id).coords = coords;
          console.log(`rider ${user.id} updated location.`);
          updateNearbyriders();
          socket.to(`rider_${user.id}`).emit("riderLocationUpdate", {
            riderId: user.id,
            coords,
          });

          // ============================================
          // UPDATE RIDER LOCATION IN DATABASE for active rides
          // This ensures customer can see distance even if socket updates are missed
          // ============================================
          if (coords.rideId && coords.latitude && coords.longitude) {
            try {
              await Ride.findByIdAndUpdate(coords.rideId, {
                riderLocation: {
                  latitude: coords.latitude,
                  longitude: coords.longitude,
                  heading: coords.heading || null,
                  updatedAt: new Date(),
                }
              });
              console.log(`📍 Updated rider location in DB for ride ${coords.rideId}`);
            } catch (dbError) {
              console.error(`⚠️ Failed to update rider location in DB:`, dbError);
            }
          }
          // ============================================

          // ============================================
          // CHECKPOINT SNAPSHOT: Create ONGOING checkpoint during active ride
          // Only create checkpoint every 2 minutes to avoid excessive storage
          // ============================================
          if (coords.rideId) {
            const rideId = coords.rideId;
            const now = Date.now();
            const lastTime = lastCheckpointTime.get(rideId) || 0;
            const CHECKPOINT_INTERVAL = 2 * 60 * 1000; // 2 minutes

            if (now - lastTime >= CHECKPOINT_INTERVAL) {
              try {
                // Verify ride is in progress
                const ride = await Ride.findById(rideId);
                if (ride && ['START', 'ARRIVED'].includes(ride.status)) {
                  await createOngoingCheckpoint(
                    rideId,
                    user.id,
                    ride.customer,
                    {
                      latitude: coords.latitude,
                      longitude: coords.longitude,
                      heading: coords.heading,
                      speed: coords.speed,
                    },
                    null // Address will be null for ongoing checkpoints
                  );
                  lastCheckpointTime.set(rideId, now);
                  console.log(`📍 Checkpoint: ONGOING snapshot created for ride ${rideId}`);
                }
              } catch (checkpointError) {
                console.error(`⚠️ Failed to create ONGOING checkpoint:`, checkpointError);
              }
            }
          }
          // ============================================
        }
      });

      // Handle request for all searching rides (city-wide)
      socket.on("requestAllSearchingRides", async () => {
        try {
          console.log(`🔍 Rider ${user.id} requesting all searching rides`);
          
          // Get rider's vehicle type from database (only Tricycle is active)
          const User = (await import('../models/User.js')).default;
          const riderUser = await User.findById(user.id).select('vehicleType');
          const vehicleType = riderUser?.vehicleType || "Tricycle"; // Default to Tricycle instead of Single Motorcycle
          console.log(`🚗 Rider ${user.id} vehicle type: ${vehicleType}`);
          
          // Find ALL rides with SEARCHING_FOR_RIDER status (NO vehicle filter - client will handle visual feedback)
          // Only rides with SEARCHING_FOR_RIDER status (cancelled/timeout rides have different status)
          // Filter out rides where this rider is blacklisted
          const searchingRides = await Ride.find({ 
            status: "SEARCHING_FOR_RIDER",
            blacklistedRiders: { $ne: user.id } // Exclude rides where rider is blacklisted
          }).populate("customer", "firstName lastName phone");
          
          console.log(`📋 Found ${searchingRides.length} searching rides (ALL vehicle types) for rider ${user.id}`);
          
          // ============================================
          // Apply MAX_DISTANCE filter if enabled
          // ============================================
          const riderData = onDutyRiders.get(user.id);
          const riderCoords = riderData?.coords;
          const filteredRides = filterRidesByDistance(searchingRides, riderCoords);
          // ============================================
          
          // Send all rides to the rider
          console.log(`📤 Emitting ${filteredRides.length} rides to rider ${user.id}`);
          
          // Force a small delay to ensure socket is ready (helps with race conditions)
          setTimeout(() => {
            socket.emit("allSearchingRides", filteredRides);
            
            // Log success message
            console.log(`✅ Successfully sent ${filteredRides.length} rides to rider ${user.id}`);
            
            // Log the ride IDs for debugging
            if (filteredRides.length > 0) {
              const rideIds = filteredRides.map(r => r._id.toString());
              console.log(`📝 Ride IDs: ${rideIds.join(', ')}`);
              
              // Log vehicle type breakdown
              const vehicleBreakdown = filteredRides.reduce((acc, ride) => {
                acc[ride.vehicle] = (acc[ride.vehicle] || 0) + 1;
                return acc;
              }, {});
              console.log(`🚗 Vehicle types: ${JSON.stringify(vehicleBreakdown)}`);
              
              // Log more details about each ride
              filteredRides.forEach(ride => {
                console.log(`📍 Ride ${ride._id}: ${ride.pickup?.address} to ${ride.drop?.address}, Vehicle: ${ride.vehicle}, Fare: ${ride.fare}`);
              });
            } else {
              console.log(`🚧 No searching rides found for rider ${user.id}`);
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
          const MAX_RETRIES = 60; // Increased from 20 to 60 (10 minutes instead of 3.3 minutes)

          const retrySearch = async () => {
            if (canceled) return;
            
            // CRITICAL: Check ride status in database before every retry
            const currentRide = await Ride.findById(rideId);
            
            // If ride doesn't exist or has been accepted/completed, stop the interval
            if (!currentRide) {
              console.log(`🔒 Ride ${rideId} no longer exists - stopping retry interval`);
              clearInterval(retryInterval);
              return;
            }
            
            // If ride status is anything other than SEARCHING_FOR_RIDER, stop the interval
            if (currentRide.status !== "SEARCHING_FOR_RIDER") {
              console.log(`🔒 Ride ${rideId} status is ${currentRide.status} (not SEARCHING) - stopping retry interval`);
              clearInterval(retryInterval);
              rideAccepted = true; // Mark as accepted to prevent timeout
              return;
            }
            
            retries++;
            console.log(`🔄 Retry ${retries}/${MAX_RETRIES} for ride ${rideId}`);

            const riders = sendNearbyRiders(socket, { latitude: pickupLat, longitude: pickupLon }, ride);
            if (riders.length > 0 || retries >= MAX_RETRIES) {
              clearInterval(retryInterval);
              if (!rideAccepted && retries >= MAX_RETRIES) {
                // Double-check ride status before timing out
                const finalCheck = await Ride.findById(rideId);
                if (!finalCheck || finalCheck.status !== "SEARCHING_FOR_RIDER") {
                  console.log(`🔒 Ride ${rideId} was accepted during final check - NOT timing out`);
                  return;
                }
                // ✅ FIXED: Update status to TIMEOUT instead of deleting, but ONLY if still SEARCHING
                const timeoutRide = await Ride.findById(rideId);
                if (timeoutRide) {
                  // CRITICAL: Only timeout if ride is still SEARCHING_FOR_RIDER
                  if (timeoutRide.status !== "SEARCHING_FOR_RIDER") {
                    console.log(`🔒 Ride ${rideId} status is ${timeoutRide.status} - NOT timing out (ride was accepted/completed)`);
                  } else {
                    // Ride is still searching after max retries - mark as TIMEOUT
                    timeoutRide.status = "TIMEOUT";
                    await timeoutRide.save();
                    console.log(`🕐 Ride ${rideId} timed out after ${MAX_RETRIES} retries - status updated to TIMEOUT`);
                    
                    // Broadcast ride timeout to all on-duty riders
                    io.to("onDuty").emit("rideOfferTimeout", rideId);
                    
                    // Also emit rideCanceled to ensure removal from all lists
                    io.to("onDuty").emit("rideCanceled", { 
                      ride: timeoutRide,
                      rideId: rideId,
                      cancelledBy: "system",
                      cancellerName: "System (Timeout)"
                    });
                  }
                }
                
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
            const cancelRide = await Ride.findById(rideId)
              .populate("customer", "firstName lastName phone")
              .populate("rider", "firstName lastName phone");
            
            if (cancelRide) {
              // CRITICAL: Never change a COMPLETED ride's status
              if (cancelRide.status === "COMPLETED") {
                console.log(`🔒 Ride ${rideId} is COMPLETED - protected from status change to CANCELLED`);
              } else {
                const cancellerName = `${cancelRide.customer.firstName} ${cancelRide.customer.lastName}`;
                
                cancelRide.status = "CANCELLED";
                cancelRide.cancelledBy = "customer";
                cancelRide.cancelledAt = new Date();
                await cancelRide.save();
                console.log(`🚫 Customer ${user.id} canceled ride ${rideId} - status updated to CANCELLED (NOT DELETED)`);
                
                // Broadcast to ride room with cancellation details
                io.to(`ride_${rideId}`).emit("rideCanceled", { 
                  message: "Ride has been cancelled",
                  ride: cancelRide,
                  cancelledBy: "customer",
                  cancellerName: cancellerName
                });
                
                // If rider was assigned, send alert
                if (cancelRide.rider) {
                  const riderSocket = getRiderSocket(cancelRide.rider._id);
                  if (riderSocket) {
                    console.log(`🚨 Sending cancellation alert to rider ${cancelRide.rider._id}`);
                    riderSocket.emit("passengerCancelledRide", {
                      rideId: rideId,
                      message: `${cancellerName} has cancelled the ride`,
                      passengerName: cancellerName,
                      ride: cancelRide
                    });
                  }
                }
                
                // Remove from ALL on-duty riders' screens immediately
                console.log(`🚫 Customer cancelled ride ${rideId} via socket - removing from ALL on-duty riders' screens`);
                io.to("onDuty").emit("rideOfferCanceled", rideId);
                console.log(`✅ Emitted rideOfferCanceled to onDuty room for ride ${rideId}`);
                
                // Also emit rideCanceled with full data for comprehensive handling
                io.to("onDuty").emit("rideCanceled", {
                  rideId: rideId,
                  ride: cancelRide,
                  cancelledBy: "customer",
                  cancellerName: cancellerName
                });
                console.log(`✅ Emitted rideCanceled to onDuty room for ride ${rideId}`);
                console.log(`📢 Successfully removed ride ${rideId} from all on-duty riders' screens`);
              }
            }
            
            socket.emit("rideCanceled", { message: "Ride canceled", ride: cancelRide });
          });
        } catch (error) {
          console.error("Error searching for rider:", error);
          socket.emit("error", { message: "Error searching for rider" });
        }
      });
    }

    socket.on("subscribeToriderLocation", async (riderId) => {
      socket.join(`rider_${riderId}`);
      console.log(`User ${user.id} subscribed to rider ${riderId}'s location.`);
      
      // First try to get rider location from onDutyRiders map (real-time)
      const rider = onDutyRiders.get(riderId);
      if (rider && rider.coords) {
        socket.emit("riderLocationUpdate", { riderId, coords: rider.coords });
        console.log(`📍 Sent real-time rider location from memory for rider ${riderId}`);
        return;
      }
      
      // Fallback: Try to get rider location from the active ride in database
      try {
        const activeRide = await Ride.findOne({
          rider: riderId,
          status: { $in: ['START', 'ARRIVED'] }
        }).select('riderLocation');
        
        if (activeRide && activeRide.riderLocation && activeRide.riderLocation.latitude) {
          socket.emit("riderLocationUpdate", { 
            riderId, 
            coords: {
              latitude: activeRide.riderLocation.latitude,
              longitude: activeRide.riderLocation.longitude,
              heading: activeRide.riderLocation.heading || 0,
            }
          });
          console.log(`📍 Sent rider location from database for rider ${riderId}`);
        } else {
          console.log(`⚠️ No rider location available for rider ${riderId}`);
        }
      } catch (error) {
        console.error(`❌ Error fetching rider location from database:`, error);
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

    socket.on("leaveRide", (rideId) => {
      console.log(`🚪 User ${user.id} (${user.role}) leaving ride room ${rideId}`);
      socket.leave(`ride_${rideId}`);
      console.log(`✅ User ${user.id} successfully left ride room ${rideId}`);
    });

    // ============ CHAT SOCKET EVENTS ============
    
    // Join a chat room
    socket.on("joinChat", (chatId) => {
      console.log(`💬 User ${user.id} (${user.role}) joining chat room ${chatId}`);
      socket.join(`chat_${chatId}`);
      console.log(`✅ User ${user.id} joined chat room ${chatId}`);
    });

    // Leave a chat room
    socket.on("leaveChat", (chatId) => {
      console.log(`💬 User ${user.id} (${user.role}) leaving chat room ${chatId}`);
      socket.leave(`chat_${chatId}`);
      console.log(`✅ User ${user.id} left chat room ${chatId}`);
    });

    // Send a message in real-time
    socket.on("sendMessage", async (data) => {
      try {
        const { chatId, content } = data;
        console.log(`💬 User ${user.id} sending message in chat ${chatId}`);

        // Verify user is participant in this chat
        const chat = await Chat.findOne({
          _id: chatId,
          "participants.userId": user.id,
        });

        if (!chat) {
          socket.emit("error", { message: "Chat not found or access denied" });
          return;
        }

        // Create message
        const message = await Message.create({
          chatId,
          sender: {
            userId: user.id,
            role: user.role,
          },
          content: content.trim(),
          messageType: "text",
        });

        // Update chat's last message
        chat.lastMessage = message._id;
        chat.lastMessageTime = message.createdAt;

        // Increment unread count for the other participant
        const otherParticipantRole = user.role === "customer" ? "rider" : "customer";
        chat.unreadCount[otherParticipantRole] += 1;

        await chat.save();

        // Populate message
        const populatedMessage = await Message.findById(message._id).populate(
          "sender.userId",
          "firstName lastName photo"
        );

        // Broadcast message to all users in the chat room
        io.to(`chat_${chatId}`).emit("newMessage", populatedMessage);

        // Also send to both participants directly (fallback)
        for (const participant of chat.participants) {
          const participantSockets = await io.in(`user_${participant.userId}`).fetchSockets();
          participantSockets.forEach(sock => {
            sock.emit("newMessage", populatedMessage);
          });
        }

        // Send unread count update to the recipient (other participant)
        const otherParticipant = chat.participants.find(p => p.userId.toString() !== user.id);
        if (otherParticipant) {
          // Calculate total unread count for the recipient across all their chats
          const recipientChats = await Chat.find({
            "participants.userId": otherParticipant.userId,
          });
          
          const totalUnread = recipientChats.reduce((sum, c) => {
            return sum + (c.unreadCount[otherParticipant.role] || 0);
          }, 0);

          // Emit unread count update to recipient's personal room
          io.to(`user_${otherParticipant.userId}`).emit("unreadCountUpdate", {
            unreadCount: totalUnread,
            chatId: chatId,
          });
          
          console.log(`🔔 Sent unread count update to user ${otherParticipant.userId}: ${totalUnread} unread messages`);
        }

        console.log(`✅ Message sent in chat ${chatId}: ${message._id}`);
      } catch (error) {
        console.error(`❌ Error sending message:`, error);
        socket.emit("error", { message: "Failed to send message" });
      }
    });

    // Broadcast image message after upload (called from REST API)
    socket.on("broadcastImageMessage", async (data) => {
      try {
        const { messageId, chatId } = data;
        console.log(`📸 Broadcasting image message ${messageId} in chat ${chatId}`);

        // Get the populated message
        const populatedMessage = await Message.findById(messageId).populate(
          "sender.userId",
          "firstName lastName photo"
        );

        if (!populatedMessage) {
          console.error(`❌ Message ${messageId} not found`);
          return;
        }

        // Get chat for unread count update
        const chat = await Chat.findById(chatId);
        if (!chat) {
          console.error(`❌ Chat ${chatId} not found`);
          return;
        }

        // Broadcast message to all users in the chat room
        io.to(`chat_${chatId}`).emit("newMessage", populatedMessage);

        // Also send to both participants directly (fallback)
        for (const participant of chat.participants) {
          const participantSockets = await io.in(`user_${participant.userId}`).fetchSockets();
          participantSockets.forEach(sock => {
            sock.emit("newMessage", populatedMessage);
          });
        }

        // Send unread count update to the recipient (other participant)
        const senderId = populatedMessage.sender.userId._id.toString();
        const otherParticipant = chat.participants.find(p => p.userId.toString() !== senderId);
        
        if (otherParticipant) {
          // Calculate total unread count for the recipient across all their chats
          const recipientChats = await Chat.find({
            "participants.userId": otherParticipant.userId,
          });
          
          const totalUnread = recipientChats.reduce((sum, c) => {
            return sum + (c.unreadCount[otherParticipant.role] || 0);
          }, 0);

          // Emit unread count update to recipient's personal room
          io.to(`user_${otherParticipant.userId}`).emit("unreadCountUpdate", {
            unreadCount: totalUnread,
            chatId: chatId,
          });
          
          console.log(`🔔 Sent unread count update to user ${otherParticipant.userId}: ${totalUnread} unread messages`);
        }

        console.log(`✅ Image message broadcasted in chat ${chatId}`);
      } catch (error) {
        console.error(`❌ Error broadcasting image message:`, error);
      }
    });

    // User is typing indicator
    socket.on("typing", (data) => {
      const { chatId, isTyping } = data;
      console.log(`⌨️ User ${user.id} ${isTyping ? 'started' : 'stopped'} typing in chat ${chatId}`);
      
      // Broadcast to other users in the chat
      socket.to(`chat_${chatId}`).emit("userTyping", {
        userId: user.id,
        role: user.role,
        isTyping,
      });
    });

    // Mark messages as read in real-time
    socket.on("markAsRead", async (data) => {
      try {
        const { chatId } = data;
        console.log(`💬 User ${user.id} marking messages as read in chat ${chatId}`);

        const chat = await Chat.findOne({
          _id: chatId,
          "participants.userId": user.id,
        });

        if (!chat) {
          socket.emit("error", { message: "Chat not found" });
          return;
        }

        // Get unread messages
        const unreadMessages = await Message.find({
          chatId,
          "sender.userId": { $ne: user.id },
          "readBy.userId": { $ne: user.id },
          isDeleted: false,
        });

        // Mark messages as read
        for (const message of unreadMessages) {
          message.readBy.push({
            userId: user.id,
            readAt: new Date(),
          });
          await message.save();
        }

        // Reset unread count
        chat.unreadCount[user.role] = 0;
        await chat.save();

        // Notify other participants
        socket.to(`chat_${chatId}`).emit("messagesRead", {
          chatId,
          userId: user.id,
          count: unreadMessages.length,
        });

        // Calculate and send updated unread count to current user
        const userChats = await Chat.find({
          "participants.userId": user.id,
        });
        
        const totalUnread = userChats.reduce((sum, c) => {
          return sum + (c.unreadCount[user.role] || 0);
        }, 0);

        // Emit unread count update to current user's personal room
        io.to(`user_${user.id}`).emit("unreadCountUpdate", {
          unreadCount: totalUnread,
          chatId: chatId,
        });
        
        console.log(`🔔 Sent unread count update to user ${user.id}: ${totalUnread} unread messages`);
        console.log(`✅ Marked ${unreadMessages.length} messages as read in chat ${chatId}`);
      } catch (error) {
        console.error(`❌ Error marking messages as read:`, error);
        socket.emit("error", { message: "Failed to mark messages as read" });
      }
    });

    // Get online status
    socket.on("checkOnlineStatus", async (data) => {
      const { userId } = data;
      const userSockets = await io.in(`user_${userId}`).fetchSockets();
      const isOnline = userSockets.length > 0;
      
      socket.emit("onlineStatus", {
        userId,
        isOnline,
      });
    });

    // Join user's personal room for direct messaging
    socket.join(`user_${user.id}`);
    console.log(`👤 User ${user.id} joined personal room`);

    // Fetch messages for a chat via socket
    socket.on("fetchMessages", async (data) => {
      try {
        const { chatId, page = 1, limit = 50 } = data;
        console.log(`💬 Socket: Fetching messages for chat ${chatId}, page ${page}`);

        // Verify user is participant in this chat
        const chat = await Chat.findOne({
          _id: chatId,
          "participants.userId": user.id,
        });

        if (!chat) {
          socket.emit("messagesError", { message: "Chat not found or you don't have access" });
          return;
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const messages = await Message.find({
          chatId,
          isDeleted: false,
        })
          .populate("sender.userId", "firstName lastName photo")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit));

        const totalMessages = await Message.countDocuments({
          chatId,
          isDeleted: false,
        });

        console.log(`✅ Socket: Found ${messages.length} messages (total: ${totalMessages})`);

        socket.emit("messagesFetched", {
          messages: messages.reverse(), // Reverse to show oldest first
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: totalMessages,
            hasMore: skip + messages.length < totalMessages,
          },
        });
      } catch (error) {
        console.error(`❌ Socket: Error fetching messages:`, error);
        socket.emit("messagesError", { message: "Failed to fetch messages", error: error.message });
      }
    });

    // Mark messages as read via socket
    socket.on("markMessagesRead", async (data) => {
      try {
        const { chatId } = data;
        console.log(`💬 Socket: User ${user.id} marking messages as read in chat ${chatId}`);

        const chat = await Chat.findOne({
          _id: chatId,
          "participants.userId": user.id,
        });

        if (!chat) {
          socket.emit("markReadError", { message: "Chat not found" });
          return;
        }

        // Get unread messages
        const unreadMessages = await Message.find({
          chatId,
          "sender.userId": { $ne: user.id },
          "readBy.userId": { $ne: user.id },
          isDeleted: false,
        });

        // Mark messages as read
        for (const message of unreadMessages) {
          message.readBy.push({
            userId: user.id,
            readAt: new Date(),
          });
          await message.save();
        }

        // Reset unread count
        chat.unreadCount[user.role] = 0;
        await chat.save();

        // Notify other participants
        socket.to(`chat_${chatId}`).emit("messagesRead", {
          chatId,
          userId: user.id,
          count: unreadMessages.length,
        });

        socket.emit("markReadSuccess", {
          chatId,
          count: unreadMessages.length,
        });

        // Calculate and send updated unread count to current user
        const userChats = await Chat.find({
          "participants.userId": user.id,
        });
        
        const totalUnread = userChats.reduce((sum, c) => {
          return sum + (c.unreadCount[user.role] || 0);
        }, 0);

        // Emit unread count update to current user's personal room
        io.to(`user_${user.id}`).emit("unreadCountUpdate", {
          unreadCount: totalUnread,
          chatId: chatId,
        });
        
        console.log(`🔔 Socket: Sent unread count update to user ${user.id}: ${totalUnread} unread messages`);
        console.log(`✅ Socket: Marked ${unreadMessages.length} messages as read in chat ${chatId}`);
      } catch (error) {
        console.error(`❌ Socket: Error marking messages as read:`, error);
        socket.emit("markReadError", { message: "Failed to mark messages as read", error: error.message });
      }
    });

    // Get or create chat via socket
    socket.on("getOrCreateChat", async (data) => {
      try {
        const { otherUserId, otherUserRole } = data;
        const currentUserId = user.id;
        const currentUserRole = user.role;

        console.log(`💬 Socket: Getting/Creating chat between ${currentUserId} (${currentUserRole}) and ${otherUserId} (${otherUserRole})`);

        // Validate that user is not trying to chat with themselves
        if (currentUserId === otherUserId) {
          console.log(`❌ Socket: User trying to chat with themselves`);
          socket.emit("chatError", { message: "Cannot create chat with yourself" });
          return;
        }

        // Check if chat already exists
        let chat = await Chat.findOne({
          "participants.userId": { $all: [currentUserId, otherUserId] },
        })
          .populate("participants.userId", "firstName lastName photo role vehicleType")
          .populate({
            path: "lastMessage",
            select: "content createdAt sender",
          });

        if (chat) {
          console.log(`✅ Socket: Found existing chat: ${chat._id}`);
          console.log(`📋 Socket: Chat participants:`, chat.participants.map(p => ({
            userId: p.userId?._id,
            name: `${p.userId?.firstName} ${p.userId?.lastName}`,
            role: p.role
          })));
          socket.emit("chatCreated", { chat });
          return;
        }

        // Create new chat
        console.log(`🆕 Socket: Creating new chat with participants:`, [
          { userId: currentUserId, role: currentUserRole },
          { userId: otherUserId, role: otherUserRole }
        ]);
        
        chat = await Chat.create({
          participants: [
            { userId: currentUserId, role: currentUserRole },
            { userId: otherUserId, role: otherUserRole },
          ],
        });

        console.log(`💾 Socket: Chat created in DB with ID: ${chat._id}`);

        // Verify chat was saved by querying it back
        const verifyChat = await Chat.findById(chat._id);
        console.log(`🔍 Socket: Verification - Chat exists in DB:`, !!verifyChat);
        console.log(`🔍 Socket: Verification - Participants:`, verifyChat?.participants);

        // Populate the newly created chat
        chat = await Chat.findById(chat._id)
          .populate("participants.userId", "firstName lastName photo role vehicleType")
          .populate("lastMessage");

        console.log(`✅ Socket: Created new chat: ${chat._id}`);
        console.log(`📋 Socket: New chat participants:`, chat.participants.map(p => ({
          userId: p.userId?._id,
          name: `${p.userId?.firstName} ${p.userId?.lastName}`,
          role: p.role
        })));
        
        // Verify both users can find this chat
        const currentUserChats = await Chat.find({ "participants.userId": currentUserId });
        const otherUserChats = await Chat.find({ "participants.userId": otherUserId });
        console.log(`🔍 Socket: Current user (${currentUserId}) has ${currentUserChats.length} chats`);
        console.log(`🔍 Socket: Other user (${otherUserId}) has ${otherUserChats.length} chats`);
        
        socket.emit("chatCreated", { chat });
      } catch (error) {
        console.error(`❌ Socket: Error creating chat:`, error);
        console.error(`❌ Socket: Error stack:`, error.stack);
        socket.emit("chatError", { message: "Failed to create chat", error: error.message });
      }
    });

    // ============ END CHAT SOCKET EVENTS ============

    // ============ MULTI-PASSENGER SOCKET EVENTS ============
    
    // Approve passenger join request (rider only)
    socket.on("approveJoinRequest", async (data) => {
      try {
        const { rideId, passengerId } = data;
        const riderId = user.id;

        console.log(`✅ Socket: Rider ${riderId} approving passenger ${passengerId} for ride ${rideId}`);

        // Verify user is a rider
        if (user.role !== "rider") {
          socket.emit("joinRequestError", { message: "Only riders can approve join requests" });
          return;
        }

        // Find the ride
        const ride = await Ride.findById(rideId).populate("customer rider passengers.userId");
        
        if (!ride) {
          socket.emit("joinRequestError", { message: "Ride not found" });
          return;
        }

        // Verify the rider owns this ride
        if (ride.rider._id.toString() !== riderId) {
          socket.emit("joinRequestError", { message: "You are not the rider for this ride" });
          return;
        }

        // Check if ride is full
        if (ride.currentPassengerCount >= ride.maxPassengers) {
          socket.emit("joinRequestError", { message: "Ride is full" });
          return;
        }

        // Check if passenger is already in the ride
        const alreadyInRide = ride.passengers.some(p => p.userId._id.toString() === passengerId);
        if (alreadyInRide) {
          socket.emit("joinRequestError", { message: "Passenger is already in this ride" });
          return;
        }

        // Fetch passenger details
        const passengerUser = await User.findById(passengerId).select("firstName lastName phone");
        if (!passengerUser) {
          socket.emit("joinRequestError", { message: "Passenger user not found" });
          return;
        }

        // Add passenger to the ride with all required fields
        ride.passengers.push({
          userId: passengerId,
          firstName: passengerUser.firstName,
          lastName: passengerUser.lastName,
          phone: passengerUser.phone,
          status: "WAITING",
          joinedAt: new Date()
        });
        ride.currentPassengerCount = ride.passengers.length;
        await ride.save();

        // Populate the updated ride
        const updatedRide = await Ride.findById(rideId)
          .populate("customer rider passengers.userId");

        console.log(`✅ Socket: Passenger ${passengerId} approved and added to ride ${rideId}`);

        // Notify the passenger that they were approved
        io.to(`user_${passengerId}`).emit("joinRequestApproved", {
          rideId: rideId,
          ride: updatedRide,
          message: "Your request to join the ride has been approved!"
        });

        // Notify the rider
        socket.emit("joinRequestApproveSuccess", {
          rideId: rideId,
          passengerId: passengerId,
          ride: updatedRide,
          message: "Passenger approved successfully"
        });

        // Broadcast passenger update to all users in the ride room
        io.to(`ride_${rideId}`).emit("passengerUpdate", updatedRide);

        // Notify all passengers in the ride about the new passenger
        io.to(`ride_${rideId}`).emit("newPassengerJoined", {
          passenger: passengerUser,
          ride: updatedRide
        });

      } catch (error) {
        console.error(`❌ Socket: Error approving join request:`, error);
        socket.emit("joinRequestError", { message: "Failed to approve join request", error: error.message });
      }
    });

    // Decline passenger join request (rider only)
    socket.on("declineJoinRequest", async (data) => {
      try {
        const { rideId, passengerId } = data;
        const riderId = user.id;

        console.log(`❌ Socket: Rider ${riderId} declining passenger ${passengerId} for ride ${rideId}`);

        // Verify user is a rider
        if (user.role !== "rider") {
          socket.emit("joinRequestError", { message: "Only riders can decline join requests" });
          return;
        }

        // Find the ride
        const ride = await Ride.findById(rideId).populate("customer rider");
        
        if (!ride) {
          socket.emit("joinRequestError", { message: "Ride not found" });
          return;
        }

        // Verify the rider owns this ride
        if (ride.rider._id.toString() !== riderId) {
          socket.emit("joinRequestError", { message: "You are not the rider for this ride" });
          return;
        }

        console.log(`✅ Socket: Join request declined for passenger ${passengerId}`);

        // Notify the passenger that their request was declined
        io.to(`user_${passengerId}`).emit("joinRequestDeclined", {
          rideId: rideId,
          message: "Your request to join the ride has been declined"
        });

        // Notify the rider
        socket.emit("joinRequestDeclineSuccess", {
          rideId: rideId,
          passengerId: passengerId,
          message: "Join request declined"
        });

      } catch (error) {
        console.error(`❌ Socket: Error declining join request:`, error);
        socket.emit("joinRequestError", { message: "Failed to decline join request", error: error.message });
      }
    });

    // Update passenger status (rider only)
    socket.on("updatePassengerStatus", async (data) => {
      try {
        const { rideId, passengerId, status } = data;
        const riderId = user.id;

        console.log(`🔄 Socket: Rider ${riderId} updating passenger ${passengerId} status to ${status} for ride ${rideId}`);

        // Verify user is a rider
        if (user.role !== "rider") {
          socket.emit("passengerStatusError", { message: "Only riders can update passenger status" });
          return;
        }

        // Find the ride
        const ride = await Ride.findById(rideId).populate("customer rider passengers.userId");
        
        if (!ride) {
          socket.emit("passengerStatusError", { message: "Ride not found" });
          return;
        }

        // Verify the rider owns this ride
        if (ride.rider._id.toString() !== riderId) {
          socket.emit("passengerStatusError", { message: "You are not the rider for this ride" });
          return;
        }

        // Find and update the passenger
        const passenger = ride.passengers.find(p => p.userId._id.toString() === passengerId);
        if (!passenger) {
          socket.emit("passengerStatusError", { message: "Passenger not found in this ride" });
          return;
        }

        passenger.status = status;
        if (status === "ONBOARD" && !passenger.boardedAt) {
          passenger.boardedAt = new Date();
        }
        await ride.save();

        // Populate the updated ride
        const updatedRide = await Ride.findById(rideId)
          .populate("customer rider passengers.userId");

        console.log(`✅ Socket: Passenger ${passengerId} status updated to ${status}`);

        // Notify the rider
        socket.emit("passengerStatusUpdateSuccess", {
          rideId: rideId,
          passengerId: passengerId,
          status: status,
          ride: updatedRide
        });

        // Broadcast passenger update to all users in the ride room
        io.to(`ride_${rideId}`).emit("passengerUpdate", updatedRide);

        // Notify the specific passenger about their status change
        const passengerSocket = [...io.sockets.sockets.values()].find(
          s => s.user?.id === passengerId
        );
        if (passengerSocket) {
          passengerSocket.emit("yourStatusUpdated", {
            status: status,
            ride: updatedRide
          });
          console.log(`👤 Socket: Notified passenger ${passengerId} of status change to ${status}`);
        }

      } catch (error) {
        console.error(`❌ Socket: Error updating passenger status:`, error);
        socket.emit("passengerStatusError", { message: "Failed to update passenger status", error: error.message });
      }
    });

    // Remove passenger from ride (rider only)
    socket.on("removePassenger", async (data) => {
      try {
        const { rideId, passengerId } = data;
        const riderId = user.id;

        console.log(`🗑️ Socket: Rider ${riderId} removing passenger ${passengerId} from ride ${rideId}`);

        // Verify user is a rider
        if (user.role !== "rider") {
          socket.emit("removePassengerError", { message: "Only riders can remove passengers" });
          return;
        }

        // Find the ride
        const ride = await Ride.findById(rideId).populate("customer rider passengers.userId");
        
        if (!ride) {
          socket.emit("removePassengerError", { message: "Ride not found" });
          return;
        }

        // Verify the rider owns this ride
        if (ride.rider._id.toString() !== riderId) {
          socket.emit("removePassengerError", { message: "You are not the rider for this ride" });
          return;
        }

        // Remove the passenger
        ride.passengers = ride.passengers.filter(p => p.userId._id.toString() !== passengerId);
        ride.currentPassengerCount = ride.passengers.length;
        await ride.save();

        // Populate the updated ride
        const updatedRide = await Ride.findById(rideId)
          .populate("customer rider passengers.userId");

        console.log(`✅ Socket: Passenger ${passengerId} removed from ride`);

        // Notify the passenger they were removed
        io.to(`user_${passengerId}`).emit("removedFromRide", {
          rideId: rideId,
          message: "You have been removed from the ride"
        });

        // Notify the rider
        socket.emit("removePassengerSuccess", {
          rideId: rideId,
          passengerId: passengerId,
          ride: updatedRide
        });

        // Broadcast passenger update to all users in the ride room
        io.to(`ride_${rideId}`).emit("passengerUpdate", updatedRide);

      } catch (error) {
        console.error(`❌ Socket: Error removing passenger:`, error);
        socket.emit("removePassengerError", { message: "Failed to remove passenger", error: error.message });
      }
    });

    // Toggle accepting new passengers (rider only)
    socket.on("toggleAcceptingPassengers", async (data) => {
      try {
        const { rideId } = data;
        const riderId = user.id;

        console.log(`🔄 Socket: Rider ${riderId} toggling accepting passengers for ride ${rideId}`);

        // Verify user is a rider
        if (user.role !== "rider") {
          socket.emit("toggleAcceptingError", { message: "Only riders can toggle accepting passengers" });
          return;
        }

        // Find the ride
        const ride = await Ride.findById(rideId).populate("customer rider passengers.userId");
        
        if (!ride) {
          socket.emit("toggleAcceptingError", { message: "Ride not found" });
          return;
        }

        // Verify the rider owns this ride
        if (ride.rider._id.toString() !== riderId) {
          socket.emit("toggleAcceptingError", { message: "You are not the rider for this ride" });
          return;
        }

        // Toggle the accepting status
        ride.acceptingNewPassengers = !ride.acceptingNewPassengers;
        await ride.save();

        console.log(`✅ Socket: Accepting passengers toggled to ${ride.acceptingNewPassengers}`);

        // Notify the rider
        socket.emit("toggleAcceptingSuccess", {
          rideId: rideId,
          acceptingNewPassengers: ride.acceptingNewPassengers,
          message: ride.acceptingNewPassengers 
            ? "Now accepting new passengers" 
            : "No longer accepting new passengers"
        });

        // Broadcast update to all users in the ride room
        io.to(`ride_${rideId}`).emit("passengerUpdate", ride);

      } catch (error) {
        console.error(`❌ Socket: Error toggling accepting passengers:`, error);
        socket.emit("toggleAcceptingError", { message: "Failed to toggle accepting passengers", error: error.message });
      }
    });

    // ============ END MULTI-PASSENGER SOCKET EVENTS ============

    // ============ ERROR HANDLING ============
    socket.on("error", (error) => {
      console.error(`❌ Socket error for ${user.role} ${user.id}:`, error.message);
    });

    socket.on("disconnect", (reason) => {
      try {
        if (user.role === "rider") onDutyRiders.delete(user.id);
        console.log(`${user.role} ${user.id} disconnected. Reason: ${reason}`);
      } catch (error) {
        console.error(`❌ Error during disconnect cleanup for ${user.id}:`, error.message);
      }
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

// Function to broadcast new ride requests to ALL on-duty riders (client will handle visual feedback for mismatched rides)
export const broadcastNewRideRequest = async (io, rideData) => {
  try {
    console.log(`🚨 Broadcasting new ride request ${rideData._id} to ALL on-duty riders`);
    
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
    
    // Check if ride has blacklisted riders
    const blacklistedRiderIds = populatedRide.blacklistedRiders || [];
    console.log(`🚫 Blacklisted riders for this ride: ${blacklistedRiderIds.length > 0 ? blacklistedRiderIds.join(', ') : 'None'}`);
    
    // Send to each on-duty rider individually, excluding blacklisted ones
    let sentCount = 0;
    let distanceFilteredCount = 0;
    for (const [riderId, riderData] of onDutyRiders.entries()) {
      // Skip if rider is blacklisted for this ride
      if (blacklistedRiderIds.some(id => id.toString() === riderId)) {
        console.log(`⏭️ Skipping rider ${riderId} - blacklisted for this ride`);
        continue;
      }
      
      // ============================================
      // Apply MAX_DISTANCE filter if enabled
      // ============================================
      if (MAX_DISTANCE_KM && riderData.coords && populatedRide.pickup) {
        const distance = calculateDistance(
          riderData.coords.latitude,
          riderData.coords.longitude,
          populatedRide.pickup.latitude,
          populatedRide.pickup.longitude
        );
        
        if (distance > MAX_DISTANCE_KM) {
          console.log(`📏 Skipping rider ${riderId} - ${distance.toFixed(2)}km away (max: ${MAX_DISTANCE_KM}km)`);
          distanceFilteredCount++;
          continue;
        }
      }
      // ============================================
      
      // Send to this specific rider
      const riderSocket = io.sockets.sockets.get(riderData.socketId);
      if (riderSocket) {
        riderSocket.emit("newRideRequest", populatedRide);
        sentCount++;
      }
    }
    
    console.log(`💬 Broadcasted ride ${rideData._id} (${populatedRide.vehicle}) to ${sentCount}/${onDutyRiders.size} on-duty riders (${blacklistedRiderIds.length} blacklisted, ${distanceFilteredCount} too far)`);
    
    // Send updated list of ALL searching rides to each rider (filtered by their blacklist and distance)
    for (const [riderId, riderData] of onDutyRiders.entries()) {
      const riderSocket = io.sockets.sockets.get(riderData.socketId);
      if (riderSocket) {
        // Get rides excluding those where this rider is blacklisted
        const ridesForRider = await Ride.find({ 
          status: "SEARCHING_FOR_RIDER",
          blacklistedRiders: { $ne: riderId }
        }).populate("customer", "firstName lastName phone");
        
        // ============================================
        // Apply MAX_DISTANCE filter if enabled
        // ============================================
        const filteredRidesForRider = filterRidesByDistance(ridesForRider, riderData.coords);
        // ============================================
        
        riderSocket.emit("allSearchingRides", filteredRidesForRider);
      }
    }
    
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
