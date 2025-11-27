import { StatusCodes } from 'http-status-codes';
import FareConfig from '../models/FareConfig.js';
import { BadRequestError, NotFoundError } from '../errors/index.js';

// Get all fare configurations
export const getAllFareConfigs = async (req, res) => {
  try {
    const { includeInactive } = req.query;
    
    const query = includeInactive === 'true' ? {} : { isActive: true };
    const fareConfigs = await FareConfig.find(query)
      .populate('lastUpdatedBy', 'name username')
      .sort({ vehicleType: 1 });
    
    res.status(StatusCodes.OK).json({
      success: true,
      count: fareConfigs.length,
      fareConfigs,
    });
  } catch (error) {
    console.error('Error fetching fare configs:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Failed to fetch fare configurations',
      error: error.message,
    });
  }
};

// Get fare config by vehicle type
export const getFareConfigByVehicle = async (req, res) => {
  try {
    const { vehicleType } = req.params;
    
    const fareConfig = await FareConfig.findOne({ vehicleType, isActive: true })
      .populate('lastUpdatedBy', 'name username');
    
    if (!fareConfig) {
      throw new NotFoundError(`No fare configuration found for ${vehicleType}`);
    }
    
    res.status(StatusCodes.OK).json({
      success: true,
      fareConfig,
    });
  } catch (error) {
    console.error('Error fetching fare config:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Failed to fetch fare configuration',
      error: error.message,
    });
  }
};

// Create or update fare configuration
export const upsertFareConfig = async (req, res) => {
  try {
    const {
      vehicleType,
      baseFare,
      perKmRate,
      minimumFare,
      baseDistanceKm,
      additionalCharges,
      isActive,
      description,
    } = req.body;
    
    if (!vehicleType) {
      throw new BadRequestError('Vehicle type is required');
    }
    
    // Validate vehicle type
    const validVehicleTypes = ['Tricycle', 'Single Motorcycle', 'Cab'];
    if (!validVehicleTypes.includes(vehicleType)) {
      throw new BadRequestError(`Invalid vehicle type. Must be one of: ${validVehicleTypes.join(', ')}`);
    }
    
    // Prepare update data
    const updateData = {
      vehicleType,
      baseFare: baseFare || 20,
      perKmRate: perKmRate || 2.8,
      minimumFare: minimumFare || 20,
      baseDistanceKm: baseDistanceKm || 1,
      additionalCharges: additionalCharges || {},
      isActive: isActive !== undefined ? isActive : true,
      description: description || '',
      lastUpdatedBy: req.admin?._id || req.admin?.id,
      effectiveDate: new Date(),
    };
    
    // Upsert (update if exists, create if not)
    const fareConfig = await FareConfig.findOneAndUpdate(
      { vehicleType },
      updateData,
      { new: true, upsert: true, runValidators: true }
    ).populate('lastUpdatedBy', 'name username');
    
    res.status(StatusCodes.OK).json({
      success: true,
      message: `Fare configuration for ${vehicleType} saved successfully`,
      fareConfig,
    });
  } catch (error) {
    console.error('Error saving fare config:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Failed to save fare configuration',
      error: error.message,
    });
  }
};

// Delete fare configuration
export const deleteFareConfig = async (req, res) => {
  try {
    const { id } = req.params;
    
    const fareConfig = await FareConfig.findByIdAndDelete(id);
    
    if (!fareConfig) {
      throw new NotFoundError('Fare configuration not found');
    }
    
    res.status(StatusCodes.OK).json({
      success: true,
      message: `Fare configuration for ${fareConfig.vehicleType} deleted successfully`,
    });
  } catch (error) {
    console.error('Error deleting fare config:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Failed to delete fare configuration',
      error: error.message,
    });
  }
};

// Toggle fare config active status
export const toggleFareConfigStatus = async (req, res) => {
  try {
    const { id } = req.params;
    
    const fareConfig = await FareConfig.findById(id);
    
    if (!fareConfig) {
      throw new NotFoundError('Fare configuration not found');
    }
    
    fareConfig.isActive = !fareConfig.isActive;
    fareConfig.lastUpdatedBy = req.admin?._id || req.admin?.id;
    await fareConfig.save();
    
    res.status(StatusCodes.OK).json({
      success: true,
      message: `Fare configuration for ${fareConfig.vehicleType} ${fareConfig.isActive ? 'activated' : 'deactivated'}`,
      fareConfig,
    });
  } catch (error) {
    console.error('Error toggling fare config status:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Failed to toggle fare configuration status',
      error: error.message,
    });
  }
};

// Calculate fare estimate (public endpoint for mobile app)
export const calculateFareEstimate = async (req, res) => {
  try {
    const { vehicleType, distanceKm, passengerCount, bookingTime } = req.body;
    
    if (!vehicleType || distanceKm === undefined) {
      throw new BadRequestError('Vehicle type and distance are required');
    }
    
    const fareEstimate = await FareConfig.calculateFare(
      vehicleType,
      parseFloat(distanceKm),
      parseInt(passengerCount) || 1,
      bookingTime ? new Date(bookingTime) : new Date()
    );
    
    res.status(StatusCodes.OK).json({
      success: true,
      fareEstimate,
    });
  } catch (error) {
    console.error('Error calculating fare estimate:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Failed to calculate fare estimate',
      error: error.message,
    });
  }
};

// Get all active fare configs for mobile app (public endpoint)
export const getPublicFareConfigs = async (req, res) => {
  try {
    const fareConfigs = await FareConfig.getActiveFareConfigs();
    
    // Return simplified config for mobile app
    const configs = fareConfigs.map(config => ({
      vehicleType: config.vehicleType,
      baseFare: config.baseFare,
      perKmRate: config.perKmRate,
      minimumFare: config.minimumFare,
      baseDistanceKm: config.baseDistanceKm,
      additionalCharges: {
        nightSurchargePercent: config.additionalCharges.nightSurchargePercent,
        nightStartHour: config.additionalCharges.nightStartHour,
        nightEndHour: config.additionalCharges.nightEndHour,
        peakHourSurchargePercent: config.additionalCharges.peakHourSurchargePercent,
        peakStartHour: config.additionalCharges.peakStartHour,
        peakEndHour: config.additionalCharges.peakEndHour,
        perPassengerCharge: config.additionalCharges.perPassengerCharge,
      },
    }));
    
    res.status(StatusCodes.OK).json({
      success: true,
      fareConfigs: configs,
    });
  } catch (error) {
    console.error('Error fetching public fare configs:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Failed to fetch fare configurations',
      error: error.message,
    });
  }
};

// Initialize default fare configs
export const initializeDefaultFareConfigs = async (req, res) => {
  try {
    const defaultConfigs = [
      {
        vehicleType: 'Tricycle',
        baseFare: 20,
        perKmRate: 2.8,
        minimumFare: 20,
        baseDistanceKm: 1,
        additionalCharges: {
          nightSurchargePercent: 10,
          nightStartHour: 22,
          nightEndHour: 5,
          peakHourSurchargePercent: 5,
          peakStartHour: 7,
          peakEndHour: 9,
          perPassengerCharge: 5,
        },
        isActive: true,
        description: 'Default tricycle fare configuration',
      },
      {
        vehicleType: 'Single Motorcycle',
        baseFare: 15,
        perKmRate: 2.5,
        minimumFare: 15,
        baseDistanceKm: 1,
        additionalCharges: {
          nightSurchargePercent: 10,
          nightStartHour: 22,
          nightEndHour: 5,
          peakHourSurchargePercent: 5,
          peakStartHour: 7,
          peakEndHour: 9,
          perPassengerCharge: 0,
        },
        isActive: false,
        description: 'Default motorcycle fare configuration (currently inactive)',
      },
      {
        vehicleType: 'Cab',
        baseFare: 30,
        perKmRate: 3.5,
        minimumFare: 30,
        baseDistanceKm: 1,
        additionalCharges: {
          nightSurchargePercent: 15,
          nightStartHour: 22,
          nightEndHour: 5,
          peakHourSurchargePercent: 10,
          peakStartHour: 7,
          peakEndHour: 9,
          perPassengerCharge: 0,
        },
        isActive: false,
        description: 'Default cab fare configuration (currently inactive)',
      },
    ];
    
    const results = [];
    for (const config of defaultConfigs) {
      const existing = await FareConfig.findOne({ vehicleType: config.vehicleType });
      if (!existing) {
        const newConfig = await FareConfig.create({
          ...config,
          lastUpdatedBy: req.admin?._id || req.admin?.id,
        });
        results.push({ vehicleType: config.vehicleType, status: 'created' });
      } else {
        results.push({ vehicleType: config.vehicleType, status: 'already exists' });
      }
    }
    
    res.status(StatusCodes.OK).json({
      success: true,
      message: 'Default fare configurations initialized',
      results,
    });
  } catch (error) {
    console.error('Error initializing default fare configs:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Failed to initialize default fare configurations',
      error: error.message,
    });
  }
};
