import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/User.js';

// Load environment variables
dotenv.config();

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected for migration'))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

const migrateLicenseIds = async () => {
  try {
    // Find all riders who have a schoolId but no licenseId
    const riders = await User.find({ 
      role: 'rider', 
      schoolId: { $exists: true, $ne: null },
      licenseId: { $exists: false }
    });

    console.log(`Found ${riders.length} riders to migrate`);

    // Update each rider to move schoolId value to licenseId
    for (const rider of riders) {
      rider.licenseId = rider.schoolId;
      await rider.save();
      console.log(`Migrated rider: ${rider._id} - ${rider.email}`);
    }

    console.log('Migration completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
};

// Run the migration
migrateLicenseIds();
