import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import Admin from '../models/Admin.js';

const createSuperAdmin = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // Check if super-admin already exists
    const existingSuperAdmin = await Admin.findOne({ role: 'super-admin' });
    
    if (existingSuperAdmin) {
      console.log('⚠️  Super-admin already exists:');
      console.log(`   Username: ${existingSuperAdmin.username}`);
      console.log(`   Email: ${existingSuperAdmin.email}`);
      console.log(`   Name: ${existingSuperAdmin.name}`);
      
      const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      readline.question('Do you want to create another super-admin? (yes/no): ', async (answer) => {
        if (answer.toLowerCase() !== 'yes') {
          console.log('❌ Cancelled');
          readline.close();
          process.exit(0);
        }
        readline.close();
        await promptAndCreate();
      });
    } else {
      await promptAndCreate();
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
};

const promptAndCreate = async () => {
  const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const question = (query) => new Promise((resolve) => readline.question(query, resolve));

  try {
    console.log('\n📝 Create Super-Admin Account\n');
    
    const username = await question('Username: ');
    const name = await question('Full Name: ');
    const email = await question('Email: ');
    const password = await question('Password: ');

    // Validate inputs
    if (!username || !name || !email || !password) {
      console.log('❌ All fields are required');
      readline.close();
      process.exit(1);
    }

    // Check if username already exists
    const existingUsername = await Admin.findOne({ username });
    if (existingUsername) {
      console.log('❌ Username already exists');
      readline.close();
      process.exit(1);
    }

    // Check if email already exists
    const existingEmail = await Admin.findOne({ email });
    if (existingEmail) {
      console.log('❌ Email already exists');
      readline.close();
      process.exit(1);
    }

    // Create super-admin
    const superAdmin = await Admin.create({
      username,
      name,
      email,
      password,
      role: 'super-admin',
      isActive: true
    });

    console.log('\n✅ Super-admin created successfully!');
    console.log('\n📋 Account Details:');
    console.log(`   Username: ${superAdmin.username}`);
    console.log(`   Name: ${superAdmin.name}`);
    console.log(`   Email: ${superAdmin.email}`);
    console.log(`   Role: ${superAdmin.role}`);
    console.log(`   ID: ${superAdmin._id}`);
    console.log('\n🔐 You can now login with these credentials\n');

    readline.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating super-admin:', error.message);
    readline.close();
    process.exit(1);
  }
};

createSuperAdmin();
