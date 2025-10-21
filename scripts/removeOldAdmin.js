import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import User from '../models/User.js';

const removeOldAdmin = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // Find and delete the old hardcoded admin account
    const oldAdmin = await User.findOne({ email: 'admin@ecoride.com' });
    
    if (oldAdmin) {
      await User.deleteOne({ email: 'admin@ecoride.com' });
      console.log('✅ Removed old hardcoded admin account:');
      console.log(`   Email: admin@ecoride.com`);
      console.log(`   Role: ${oldAdmin.role}`);
      console.log(`   Name: ${oldAdmin.firstName} ${oldAdmin.lastName}`);
    } else {
      console.log('ℹ️  No old admin account found with email: admin@ecoride.com');
    }

    console.log('\n✅ Cleanup complete!\n');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error removing old admin:', error.message);
    process.exit(1);
  }
};

removeOldAdmin();
