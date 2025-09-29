import mongoose from 'mongoose';
import User from '../models/User.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const fixMissingNames = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // Find users with missing firstName or lastName
    const usersWithMissingNames = await User.find({
      $or: [
        { firstName: { $in: [null, '', undefined] } },
        { lastName: { $in: [null, '', undefined] } }
      ]
    });

    console.log(`🔍 Found ${usersWithMissingNames.length} users with missing names`);

    let updatedCount = 0;

    for (const user of usersWithMissingNames) {
      let updated = false;
      const updates = {};

      // If firstName is missing, try to extract from email
      if (!user.firstName || user.firstName.trim() === '') {
        const emailUsername = user.email.split('@')[0];
        const nameParts = emailUsername.split(/[._-]/);
        
        if (nameParts.length > 0) {
          updates.firstName = nameParts[0].charAt(0).toUpperCase() + nameParts[0].slice(1).toLowerCase();
          updated = true;
        }
      }

      // If lastName is missing and we have multiple parts from email
      if (!user.lastName || user.lastName.trim() === '') {
        const emailUsername = user.email.split('@')[0];
        const nameParts = emailUsername.split(/[._-]/);
        
        if (nameParts.length > 1) {
          updates.lastName = nameParts[1].charAt(0).toUpperCase() + nameParts[1].slice(1).toLowerCase();
          updated = true;
        } else {
          // Fallback to role-based last name
          updates.lastName = user.role === 'rider' ? 'Rider' : 'Customer';
          updated = true;
        }
      }

      if (updated) {
        await User.findByIdAndUpdate(user._id, updates);
        console.log(`✅ Updated user ${user.email}: ${updates.firstName || user.firstName} ${updates.lastName || user.lastName}`);
        updatedCount++;
      }
    }

    console.log(`🎉 Successfully updated ${updatedCount} users with missing names`);
    
    // Verify the updates
    const remainingUsersWithMissingNames = await User.find({
      $or: [
        { firstName: { $in: [null, '', undefined] } },
        { lastName: { $in: [null, '', undefined] } }
      ]
    });

    console.log(`📊 Users still with missing names: ${remainingUsersWithMissingNames.length}`);

    if (remainingUsersWithMissingNames.length > 0) {
      console.log('Remaining users with missing names:');
      remainingUsersWithMissingNames.forEach(user => {
        console.log(`- ${user.email}: firstName="${user.firstName}", lastName="${user.lastName}"`);
      });
    }

  } catch (error) {
    console.error('❌ Error fixing missing names:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
};

// Run the script
fixMissingNames();
