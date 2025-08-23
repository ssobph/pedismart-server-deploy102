import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/User.js';

// Load environment variables
dotenv.config();

// Function to create admin user
const createAdminSimple = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    // Delete any existing admin users to start fresh
    await User.deleteMany({ role: 'admin' });
    console.log('Deleted existing admin users');

    // Create a new admin user with a simple password
    const admin = new User({
      email: 'admin@ecoride.com',
      password: 'admin123456',
      role: 'admin',
      firstName: 'Admin',
      lastName: 'User',
      approved: true
    });

    // Save the user (this will trigger the password hashing)
    await admin.save();
    
    console.log('Admin user created successfully:');
    console.log('Email:', admin.email);
    console.log('Password: admin123456');

    process.exit(0);
  } catch (error) {
    console.error('Error creating admin user:', error);
    process.exit(1);
  }
};

// Run the function
createAdminSimple();
