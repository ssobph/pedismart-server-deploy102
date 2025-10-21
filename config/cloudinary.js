import { v2 as cloudinary } from 'cloudinary';
import multer from 'multer';
import { CloudinaryStorage } from 'multer-storage-cloudinary';

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_API_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_SECRET_KEY,
});

// Log configuration status
console.log('☁️ Cloudinary Configuration:', {
  cloud_name: process.env.CLOUDINARY_API_NAME ? 'Set ✓' : 'Missing ✗',
  api_key: process.env.CLOUDINARY_API_KEY ? 'Set ✓' : 'Missing ✗',
  api_secret: process.env.CLOUDINARY_SECRET_KEY ? 'Set ✓' : 'Missing ✗',
});

// Configure Multer Storage for Cloudinary - Chat Images
const chatImageStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    return {
      folder: 'ecoride/chat_images',
      allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
      public_id: `chat_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      transformation: [
        { width: 1200, height: 1200, crop: 'limit' },
        { quality: 'auto:good' },
      ],
    };
  },
});

// Multer upload middleware for chat images
export const uploadChatImage = multer({
  storage: chatImageStorage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    // Check file type
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  },
});

export default cloudinary;
