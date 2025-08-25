import geolib from "geolib";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Ride from "../models/Ride.js";
import Rating from "../models/Rating.js";

const onDutyRiders = new Map();

const handleSocketConnection = (io) => {
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.headers.access_token;
      if (!token) return next(new Error("Authentication invalid: No token"));

      const payload = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
      const user = await User.findById(payload.id);
      if (!user) return next(new Error("Authentication invalid: User not found"));

      socket.user = { id: payload.id, role: user.role };
      next();
    } catch (error) {
      console.error("Socket Auth Error:", error);
      next(new Error("Authentication invalid: Token verification failed"));
    }
  });

  io.on("connection", (socket) => {
    const user = socket.user;
    console.log(`User Joined: ${user.id} (${user.role})`);

    if (user.role === "rider") {
      socket.on("goOnDuty", async (coords) => {
        // Get rider's vehicle type from database
        const riderInfo = await User.findById(user.id).select("vehicleType");
        
        console.log(`Rider ${user.id} going on duty with coords:`, coords);
        console.log(`Rider ${user.id} vehicle type:`, riderInfo?.vehicleType);
        
        onDutyRiders.set(user.id, { 
          socketId: socket.id, 
          coords,
          riderId: user.id,
          vehicleType: riderInfo?.vehicleType || "Tricycle" // Store vehicle type
        });
        socket.join("onDuty");
        console.log(`rider ${user.id} is now on duty with vehicle: ${riderInfo?.vehicleType || "Tricycle"}.`);
        console.log(`Total on-duty riders: ${onDutyRiders.size}`);
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
            retries++;

            const riders = sendNearbyRiders(socket, { latitude: pickupLat, longitude: pickupLon }, ride);
            if (riders.length > 0 || retries >= MAX_RETRIES) {
              clearInterval(retryInterval);
              if (!rideAccepted && retries >= MAX_RETRIES) {
                await Ride.findByIdAndDelete(rideId);
                socket.emit("error", { message: "No riders found within 5 minutes." });
              }
            }
          };

          const retryInterval = setInterval(retrySearch, 10000);

          socket.on("rideAccepted", () => {
            rideAccepted = true;
            clearInterval(retryInterval);
          });

          socket.on("cancelRide", async () => {
            canceled = true;
            clearInterval(retryInterval);
            await Ride.findByIdAndDelete(rideId);
            socket.emit("rideCanceled", { message: "Ride canceled" });

            if (ride.rider) {
              const riderSocket = getRiderSocket(ride.rider._id);
              riderSocket?.emit("rideCanceled", { message: `Customer ${user.id} canceled the ride.` });
            }
            console.log(`Customer ${user.id} canceled ride ${rideId}`);
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
      socket.join(`ride_${rideId}`);
      try {
        const rideData = await Ride.findById(rideId).populate("customer rider");
        socket.emit("rideData", rideData);
      } catch (error) {
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
        console.log('sendNearbyRiders called with location:', location);
        console.log('onDutyRiders size:', onDutyRiders.size);
        console.log('onDutyRiders entries:', Array.from(onDutyRiders.entries()));
        
        const nearbyRidersArray = Array.from(onDutyRiders.entries()).map(
          async ([riderId, riderData]) => {
            // Get basic rider info from database for each nearby rider
            const riderInfo = await User.findById(riderId).select(
              "firstName lastName vehicleType"
            );
            
            const distance = geolib.getDistance(riderData.coords, location);
            console.log(`Rider ${riderId} distance: ${distance}m`);
            
            return {
              ...riderData,
              riderId,
              distance: distance,
              vehicleType: riderData.vehicleType || riderInfo?.vehicleType || "Tricycle", // Use stored vehicleType first
            };
          }
        );

        const resolvedRiders = await Promise.all(nearbyRidersArray);
        console.log('Resolved riders before filtering:', resolvedRiders);
        
        const nearbyriders = resolvedRiders
          .filter((rider) => rider.distance <= 60000)
          .sort((a, b) => a.distance - b.distance);

        console.log('Nearby riders after filtering:', nearbyriders);
        socket.emit("nearbyriders", nearbyriders);

        if (ride) {
          nearbyriders.forEach((rider) => {
            io.to(rider.socketId).emit("rideOffer", ride);
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

export default handleSocketConnection;
