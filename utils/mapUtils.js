// ============================================
// MAX DISTANCE FEATURE (Easy to enable/disable)
// ============================================
// Set to 1 to enable 1KM max distance filtering
// Riders beyond this distance from passenger pickup won't see the ride
// Set to null to disable: export const MAX_DISTANCE_KM = null;
export const MAX_DISTANCE_KM = 1;
// ============================================

export const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// COMMENTED OUT: Payment/Fare - Driver handles pricing manually
// export const calculateFare = (distance) => {
//   const rateStructure = {
//     // "Single Motorcycle": { minimumRate: 15, perKmRate: 2.5 }, // Commented out: Only using Tricycle
//     "Tricycle": { minimumRate: 20, perKmRate: 2.8 },
//     // "Cab": { minimumRate: 30, perKmRate: 3 }, // Commented out: Only using Tricycle
//   };
//
//   const fareCalculation = (minimumRate, perKmRate) => {
//     const calculatedFare = distance * perKmRate;
//     return Math.max(calculatedFare, minimumRate);
//   };
//
//   return {
//     // "Single Motorcycle": fareCalculation(
//     //   rateStructure["Single Motorcycle"].minimumRate,
//     //   rateStructure["Single Motorcycle"].perKmRate
//     // ), // Commented out: Only using Tricycle
//     "Tricycle": fareCalculation(
//       rateStructure["Tricycle"].minimumRate,
//       rateStructure["Tricycle"].perKmRate
//     ),
//     // "Cab": fareCalculation(
//     //   rateStructure["Cab"].minimumRate,
//     //   rateStructure["Cab"].perKmRate
//     // ), // Commented out: Only using Tricycle
//   };
// };

export const generateOTP = () => {
  return Math.floor(1000 + Math.random() * 9000).toString();
};
