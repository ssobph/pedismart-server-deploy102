import axios from 'axios';

// Simple in-memory cache for geocoding results
const geocodeCache = {};
const CACHE_EXPIRATION = 60 * 60 * 1000; // 1 hour

// Round coordinates to reduce API calls for very similar locations
const roundCoordinates = (coord) => {
  return Math.round(coord * 100000) / 100000; // ~1.1 meters precision
};

// Helper function to check if address contains a Plus Code (e.g., "CJ77+PCH" or "FH4F+WRQ")
const containsPlusCode = (address) => {
  if (!address) return false;
  // Plus codes follow pattern: 4-8 characters + "+" + 2-3 characters
  const plusCodePattern = /^[A-Z0-9]{4,8}\+[A-Z0-9]{2,3}/i;
  return plusCodePattern.test(address);
};

// Helper function to remove Plus Code from address
const removePlusCode = (address) => {
  if (!address) return address;
  // Remove Plus Code pattern from the beginning
  return address.replace(/^[A-Z0-9]{4,8}\+[A-Z0-9]{2,3},?\s*/i, '').trim();
};

/**
 * Reverse geocode coordinates to get a human-readable address
 * @param {number} latitude - Latitude coordinate
 * @param {number} longitude - Longitude coordinate
 * @returns {Promise<Object>} - Object containing formatted address and address components
 */
export const reverseGeocode = async (latitude, longitude) => {
  if (!latitude || !longitude) {
    console.log('Invalid coordinates for reverse geocoding');
    return {
      formattedAddress: '',
      street: '',
      barangay: '',
      city: '',
      province: '',
      country: '',
    };
  }

  // Round coordinates to reduce unnecessary API calls
  const roundedLat = roundCoordinates(latitude);
  const roundedLng = roundCoordinates(longitude);
  const cacheKey = `${roundedLat},${roundedLng}`;

  // Check cache first
  const now = Date.now();
  if (geocodeCache[cacheKey] && (now - geocodeCache[cacheKey].timestamp) < CACHE_EXPIRATION) {
    console.log(`Using cached address for: ${roundedLat}, ${roundedLng}`);
    return geocodeCache[cacheKey].data;
  }

  try {
    console.log(`Reverse geocoding for: ${roundedLat}, ${roundedLng}`);
    
    const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.EXPO_PUBLIC_MAP_API_KEY;
    
    if (!apiKey) {
      console.log('No Google Maps API key found');
      return {
        formattedAddress: `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
        street: '',
        barangay: '',
        city: '',
        province: '',
        country: '',
      };
    }

    const response = await axios.get(
      `https://maps.googleapis.com/maps/api/geocode/json`,
      {
        params: {
          latlng: `${latitude},${longitude}`,
          key: apiKey,
          language: 'en',
        },
        timeout: 10000,
      }
    );

    if (response.data.status === 'OK' && response.data.results && response.data.results.length > 0) {
      // Try to find a result without Plus Code first
      let result = response.data.results.find(r => !containsPlusCode(r.formatted_address));
      if (!result) {
        result = response.data.results[0];
      }
      
      const addressComponents = result.address_components || [];
      
      // Extract address components (filter out Plus Codes)
      const getComponent = (types) => {
        const component = addressComponents.find(c => 
          types.some(type => c.types.includes(type)) && !containsPlusCode(c.long_name)
        );
        return component ? component.long_name : '';
      };

      // Get formatted address and remove Plus Code if present
      let formattedAddress = result.formatted_address;
      if (containsPlusCode(formattedAddress)) {
        formattedAddress = removePlusCode(formattedAddress);
      }

      const addressData = {
        formattedAddress: formattedAddress,
        street: getComponent(['street_number', 'route', 'street_address']) || 
                getComponent(['premise', 'subpremise']) ||
                getComponent(['neighborhood']),
        barangay: getComponent(['sublocality_level_1', 'sublocality', 'neighborhood', 'political']),
        city: getComponent(['locality', 'administrative_area_level_2']),
        province: getComponent(['administrative_area_level_1']),
        country: getComponent(['country']),
        // Additional components for Philippines
        streetNumber: getComponent(['street_number']),
        route: getComponent(['route']),
        neighborhood: getComponent(['neighborhood']),
        sublocality: getComponent(['sublocality', 'sublocality_level_1']),
      };

      // Build a clean formatted address for Philippines
      // Format: "Street, Barangay, City, Province"
      const parts = [];
      if (addressData.street || addressData.route) {
        parts.push(addressData.street || addressData.route);
      }
      if (addressData.barangay || addressData.sublocality) {
        parts.push(addressData.barangay || addressData.sublocality);
      }
      if (addressData.city) {
        parts.push(addressData.city);
      }
      if (addressData.province) {
        parts.push(addressData.province);
      }

      // Use parts if available, otherwise use cleaned formatted address
      addressData.cleanAddress = parts.length > 0 ? parts.join(', ') : formattedAddress;

      console.log(`Address found: ${addressData.cleanAddress}`);

      // Cache the result
      geocodeCache[cacheKey] = {
        data: addressData,
        timestamp: now,
      };

      return addressData;
    } else {
      console.log('Geocoding failed:', response.data.status, response.data.error_message || '');
      return {
        formattedAddress: `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
        street: '',
        barangay: '',
        city: '',
        province: '',
        country: '',
        cleanAddress: `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
      };
    }
  } catch (error) {
    console.error('Error during reverse geocoding:', error.message);
    return {
      formattedAddress: `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
      street: '',
      barangay: '',
      city: '',
      province: '',
      country: '',
      cleanAddress: `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
    };
  }
};

/**
 * Get a short, clean address from coordinates
 * @param {number} latitude - Latitude coordinate
 * @param {number} longitude - Longitude coordinate
 * @returns {Promise<string>} - Clean formatted address string
 */
export const getCleanAddress = async (latitude, longitude) => {
  const addressData = await reverseGeocode(latitude, longitude);
  return addressData.cleanAddress || addressData.formattedAddress;
};

/**
 * Calculate distance between two coordinates using Haversine formula
 * @param {number} lat1 - Latitude of first point
 * @param {number} lon1 - Longitude of first point
 * @param {number} lat2 - Latitude of second point
 * @param {number} lon2 - Longitude of second point
 * @returns {number} - Distance in kilometers
 */
export const calculateDistanceKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Earth's radius in km
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

export default {
  reverseGeocode,
  getCleanAddress,
  calculateDistanceKm,
};
