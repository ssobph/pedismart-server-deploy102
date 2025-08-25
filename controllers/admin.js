import User from '../models/User.js';
import { StatusCodes } from 'http-status-codes';
import { BadRequestError, NotFoundError } from '../errors/index.js';

// Get all users
export const getAllUsers = async (req, res) => {
  try {
    // Support filtering by role, status, sex, etc.
    const { role, status, search, sex, userRole, vehicleType, hasDocuments } = req.query;
    const queryObject = {};
    
    // Handle role filter
    if (role) {
      queryObject.role = role;
    }
    
    // Handle status filter
    if (status) {
      queryObject.status = status;
    }
    
    // Handle sex filter
    if (sex) {
      queryObject.sex = sex;
    }
    
    // Handle userRole filter (for customers)
    if (userRole) {
      queryObject.userRole = userRole;
    }
    
    // Handle vehicleType filter (for riders)
    if (vehicleType) {
      queryObject.vehicleType = vehicleType;
    }
    
    // Handle document filter
    if (hasDocuments === 'true') {
      queryObject.$or = [
        { photo: { $exists: true, $ne: null } },
        { schoolIdDocument: { $exists: true, $ne: null } },
        { staffFacultyIdDocument: { $exists: true, $ne: null } },
        { driverLicense: { $exists: true, $ne: null } },
        { cor: { $exists: true, $ne: null } }
      ];
    } else if (hasDocuments === 'false') {
      queryObject.$and = [
        { photo: { $in: [null, undefined, ''] } },
        { schoolIdDocument: { $in: [null, undefined, ''] } },
        { staffFacultyIdDocument: { $in: [null, undefined, ''] } },
        { driverLicense: { $in: [null, undefined, ''] } },
        { cor: { $in: [null, undefined, ''] } }
      ];
    }
    
    // Handle search filter
    if (search) {
      // If we already have $or or $and, we need to use $and to combine with search
      const searchCondition = {
        $or: [
          { firstName: { $regex: search, $options: 'i' } },
          { lastName: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
          { phone: { $regex: search, $options: 'i' } }
        ]
      };
      
      if (queryObject.$or || queryObject.$and) {
        // Create an $and condition if it doesn't exist
        queryObject.$and = queryObject.$and || [];
        // Add the search condition to the $and array
        queryObject.$and.push(searchCondition);
        
        // If we have an $or condition but not in $and, move it to $and
        if (queryObject.$or && !queryObject.$and.includes(queryObject.$or)) {
          queryObject.$and.push({ $or: queryObject.$or });
          delete queryObject.$or;
        }
      } else {
        // Simple case: just add the $or for search
        queryObject.$or = searchCondition.$or;
      }
    }
    
    console.log('Fetching users with query:', JSON.stringify(queryObject, null, 2));
    
    // Exclude admin users from the results
    if (queryObject.$and) {
      queryObject.$and.push({ role: { $ne: 'admin' } });
    } else {
      queryObject.role = { $ne: 'admin' };
    }
    
    const users = await User.find(queryObject).select('-password').sort({ createdAt: -1 });
    
    console.log(`Found ${users.length} users`);
    
    res.status(StatusCodes.OK).json({
      count: users.length,
      users
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ 
      message: 'Error fetching users',
      error: error.message
    });
  }
};

// Get user by ID
export const getUserById = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id).select('-password');
    
    if (!user) {
      throw new NotFoundError(`No user found with id ${id}`);
    }
    
    res.status(StatusCodes.OK).json({ user });
  } catch (error) {
    console.error(`Error fetching user ${req.params.id}:`, error);
    
    if (error.name === 'NotFoundError') {
      res.status(StatusCodes.NOT_FOUND).json({ message: error.message });
      return;
    }
    
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ 
      message: 'Error fetching user',
      error: error.message
    });
  }
};

// Approve user
export const approveUser = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id);
    
    if (!user) {
      throw new NotFoundError(`No user found with id ${id}`);
    }
    
    user.status = "approved";
    await user.save();
    
    const updatedUser = await User.findById(id).select('-password');
    
    res.status(StatusCodes.OK).json({
      message: 'User approved successfully',
      user: updatedUser
    });
  } catch (error) {
    console.error(`Error approving user ${req.params.id}:`, error);
    
    if (error.name === 'NotFoundError') {
      res.status(StatusCodes.NOT_FOUND).json({ message: error.message });
      return;
    }
    
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ 
      message: 'Error approving user',
      error: error.message
    });
  }
};

// Disapprove user
export const disapproveUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const user = await User.findById(id);
    
    if (!user) {
      throw new NotFoundError(`No user found with id ${id}`);
    }
    
    user.status = "disapproved";
    user.disapprovalReason = reason || 'No reason provided';
    await user.save();
    
    const updatedUser = await User.findById(id).select('-password');
    
    res.status(StatusCodes.OK).json({
      message: 'User disapproved successfully',
      user: updatedUser
    });
  } catch (error) {
    console.error(`Error disapproving user ${req.params.id}:`, error);
    
    if (error.name === 'NotFoundError') {
      res.status(StatusCodes.NOT_FOUND).json({ message: error.message });
      return;
    }
    
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ 
      message: 'Error disapproving user',
      error: error.message
    });
  }
};

// Update user
export const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      firstName, 
      middleName, 
      lastName, 
      email, 
      phone, 
      role, 
      sex, 
      schoolId, 
      licenseId, 
      approved,
      vehicleType,
      userRole
    } = req.body;
    
    const user = await User.findById(id);
    
    if (!user) {
      throw new NotFoundError(`No user found with id ${id}`);
    }
    
    // Update fields if provided
    if (firstName !== undefined) user.firstName = firstName;
    if (middleName !== undefined) user.middleName = middleName;
    if (lastName !== undefined) user.lastName = lastName;
    if (phone !== undefined) user.phone = phone;
    if (schoolId !== undefined) user.schoolId = schoolId;
    if (licenseId !== undefined) user.licenseId = licenseId;
    if (sex !== undefined) user.sex = sex;
    if (approved !== undefined) user.approved = approved;
    if (vehicleType !== undefined) user.vehicleType = vehicleType;
    if (userRole !== undefined) user.userRole = userRole;
    
    // Add logging to debug vehicleType update
    console.log('Update request body:', req.body);
    console.log('VehicleType from request:', vehicleType);
    console.log('User vehicleType before save:', user.vehicleType);
    
    // Email update requires special handling to check for duplicates
    if (email !== undefined && email !== user.email) {
      const existingUser = await User.findOne({ email, _id: { $ne: id } });
      if (existingUser) {
        throw new BadRequestError('Email already in use');
      }
      user.email = email;
    }
    
    // Role change requires validation
    if (role !== undefined && role !== user.role) {
      if (!['customer', 'rider'].includes(role)) {
        throw new BadRequestError('Invalid role. Must be customer or rider');
      }
      user.role = role;
    }
    
    await user.save();
    
    const updatedUser = await User.findById(id).select('-password');
    console.log('User vehicleType after save:', updatedUser.vehicleType);
    
    res.status(StatusCodes.OK).json({
      message: 'User updated successfully',
      user: updatedUser
    });
  } catch (error) {
    console.error(`Error updating user ${req.params.id}:`, error);
    
    if (error.name === 'NotFoundError') {
      res.status(StatusCodes.NOT_FOUND).json({ message: error.message });
      return;
    }
    
    if (error.name === 'BadRequestError') {
      res.status(StatusCodes.BAD_REQUEST).json({ message: error.message });
      return;
    }
    
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ 
      message: 'Error updating user',
      error: error.message
    });
  }
};

// Add penalty comment to user
export const addPenaltyComment = async (req, res) => {
  try {
    const { id } = req.params;
    const { penaltyComment, penaltyLiftDate } = req.body;
    
    if (!penaltyComment || penaltyComment.trim() === '') {
      throw new BadRequestError('Penalty comment is required');
    }
    
    if (!penaltyLiftDate) {
      throw new BadRequestError('Penalty lift date is required');
    }
    
    const user = await User.findById(id);
    
    if (!user) {
      throw new NotFoundError(`No user found with id ${id}`);
    }
    
    // Check if user is disapproved
    if (user.status !== 'disapproved') {
      throw new BadRequestError('User must be disapproved before adding a penalty');
    }
    
    user.penaltyComment = penaltyComment;
    user.penaltyLiftDate = new Date(penaltyLiftDate);
    await user.save();
    
    const updatedUser = await User.findById(id).select('-password');
    
    res.status(StatusCodes.OK).json({
      message: 'Penalty added successfully',
      user: updatedUser
    });
  } catch (error) {
    console.error(`Error adding penalty comment to user ${req.params.id}:`, error);
    
    if (error.name === 'NotFoundError') {
      res.status(StatusCodes.NOT_FOUND).json({ message: error.message });
      return;
    }
    
    if (error.name === 'BadRequestError') {
      res.status(StatusCodes.BAD_REQUEST).json({ message: error.message });
      return;
    }
    
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ 
      message: 'Error adding penalty comment',
      error: error.message
    });
  }
};

// Delete user
export const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id);
    
    if (!user) {
      throw new NotFoundError(`No user found with id ${id}`);
    }
    
    await User.findByIdAndDelete(id);
    
    res.status(StatusCodes.OK).json({
      message: 'User deleted successfully',
      userId: id
    });
  } catch (error) {
    console.error(`Error deleting user ${req.params.id}:`, error);
    
    if (error.name === 'NotFoundError') {
      res.status(StatusCodes.NOT_FOUND).json({ message: error.message });
      return;
    }
    
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ 
      message: 'Error deleting user',
      error: error.message
    });
  }
};
