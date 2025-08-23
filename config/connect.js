import mongoose from "mongoose";

const connectDB = async (url) => {
  try {
    console.log("Attempting to connect to MongoDB...");
    console.log(`MongoDB URI: ${url.substring(0, 15)}...`); // Only show the beginning for security
    
    const conn = await mongoose.connect(url);
    
    console.log(`MongoDB Connected Successfully!`);
    console.log(`Host: ${conn.connection.host}`);
    console.log(`Database Name: ${conn.connection.name}`);
    console.log(`Connection State: ${conn.connection.readyState === 1 ? 'Connected' : 'Disconnected'}`);
    
    return conn;
  } catch (error) {
    console.error("MongoDB Connection Error:", error.message);
    process.exit(1);
  }
};

export default connectDB;
