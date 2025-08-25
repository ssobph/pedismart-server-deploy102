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

export const calculateFare = (distance) => {
  const rateStructure = {
    "Single Motorcycle": { baseFare: 10, perKmRate: 5, minimumFare: 25 },
    "Tricycle": { baseFare: 15, perKmRate: 7, minimumFare: 30 },
    "Cab": { baseFare: 20, perKmRate: 10, minimumFare: 50 },
  };

  const fareCalculation = (baseFare, perKmRate, minimumFare) => {
    const calculatedFare = baseFare + distance * perKmRate;
    return Math.max(calculatedFare, minimumFare);
  };

  return {
    "Single Motorcycle": fareCalculation(
      rateStructure["Single Motorcycle"].baseFare,
      rateStructure["Single Motorcycle"].perKmRate,
      rateStructure["Single Motorcycle"].minimumFare
    ),
    "Tricycle": fareCalculation(
      rateStructure["Tricycle"].baseFare,
      rateStructure["Tricycle"].perKmRate,
      rateStructure["Tricycle"].minimumFare
    ),
    "Cab": fareCalculation(
      rateStructure["Cab"].baseFare,
      rateStructure["Cab"].perKmRate,
      rateStructure["Cab"].minimumFare
    ),
  };
};

export const generateOTP = () => {
  return Math.floor(1000 + Math.random() * 9000).toString();
};
