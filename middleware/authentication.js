import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Admin from "../models/Admin.js";
import NotFoundError from "../errors/not-found.js";
import UnauthenticatedError from "../errors/unauthenticated.js";

const auth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer")) {
    throw new UnauthenticatedError("Authentication invalid");
  }
  const token = authHeader.split(" ")[1];
  try {
    const payload = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    
    // Set basic user info from token
    req.user = { 
      id: payload.id,
      userId: payload.id, // Add userId for compatibility with chat controllers
      phone: payload.phone,
      role: payload.role,
      adminRole: payload.adminRole,
      isAdmin: payload.isAdmin
    };
    req.socket = req.io;

    // Try to find user in User model first (handles both regular users and admins)
    const user = await User.findById(payload.id);
    
    if (user) {
      // User found in User model
      req.user.name = user.firstName ? `${user.firstName} ${user.lastName}`.trim() : user.name;
      req.user.email = user.email;
      req.user.role = user.role;
      
      // If user is admin role, set admin flags
      if (user.role === 'admin') {
        req.user.isAdmin = true;
        req.user.adminRole = 'admin';
      }
    } else {
      // Try Admin model as fallback (legacy support)
      const admin = await Admin.findById(payload.id);
      
      if (!admin) {
        throw new NotFoundError("User not found");
      }

      // Add admin-specific info to req.user
      req.user.name = admin.name;
      req.user.username = admin.username;
      req.user.email = admin.email;
      req.user.adminRole = admin.role;
      req.user.isAdmin = true;
    }

    next();
  } catch (error) {
    throw new UnauthenticatedError("Authentication invalid");
  }
};

export default auth;
