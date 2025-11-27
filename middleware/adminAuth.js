import jwt from 'jsonwebtoken';
import Admin from '../models/Admin.js';

/**
 * Admin authentication middleware
 * Verifies JWT token and checks admin privileges
 */
const adminAuthMiddleware = async (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        success: false, 
        message: 'Authentication required. No token provided.' 
      });
    }

    const token = authHeader.split(' ')[1];

    // Verify token - try ACCESS_TOKEN_SECRET first (used by Admin model), then JWT_SECRET as fallback
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    } catch (accessTokenError) {
      // Try JWT_SECRET as fallback
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    }

    // Check if it's an admin token
    if (!decoded.adminId && !decoded.id) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid token. Admin authentication required.' 
      });
    }

    // Find admin in database
    const adminId = decoded.adminId || decoded.id;
    const admin = await Admin.findById(adminId).select('-password');

    if (!admin) {
      return res.status(401).json({ 
        success: false, 
        message: 'Admin not found.' 
      });
    }

    // Check if admin is active
    if (!admin.isActive) {
      return res.status(403).json({ 
        success: false, 
        message: 'Admin account is deactivated.' 
      });
    }

    // Attach admin to request
    req.admin = admin;
    req.user = {
      id: admin._id,
      role: 'admin',
      adminRole: admin.role,
    };

    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid token.' 
      });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        success: false, 
        message: 'Token expired. Please login again.' 
      });
    }
    
    console.error('Admin auth middleware error:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Authentication error.' 
    });
  }
};

export default adminAuthMiddleware;
