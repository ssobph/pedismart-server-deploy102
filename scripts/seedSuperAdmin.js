import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import Admin from '../models/Admin.js';

const seedSuperAdmin = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // Super-admin credentials
    const superAdminData = {
      username: 'superadmin',
      name: 'Super Admin',
      email: 'superadmin@ecoride.com',
      password: 'Ecoride@2025',
      role: 'super-admin',
      isActive: true
    };

    // Check if super-admin already exists
    const existingSuperAdmin = await Admin.findOne({ 
      $or: [
        { username: superAdminData.username },
        { email: superAdminData.email }
      ]
    });
    
    if (existingSuperAdmin) {
      console.log('⚠️  Super-admin already exists:');
      console.log(`   Username: ${existingSuperAdmin.username}`);
      console.log(`   Email: ${existingSuperAdmin.email}`);
      console.log(`   Name: ${existingSuperAdmin.name}`);
      console.log(`   Role: ${existingSuperAdmin.role}`);
      console.log('\n✅ You can login with existing credentials\n');
      process.exit(0);
    }

    // Create super-admin
    const superAdmin = await Admin.create(superAdminData);

    console.log('\n✅ Super-admin created successfully!');
    console.log('\n📋 Account Details:');
    console.log(`   Username: ${superAdmin.username}`);
    console.log(`   Name: ${superAdmin.name}`);
    console.log(`   Email: ${superAdmin.email}`);
    console.log(`   Password: ${superAdminData.password}`);
    console.log(`   Role: ${superAdmin.role}`);
    console.log(`   ID: ${superAdmin._id}`);
    console.log('\n🔐 You can now login with these credentials\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating super-admin:', error.message);
    process.exit(1);
  }
};

seedSuperAdmin();
