import cloudinary from 'cloudinary';
import multer from 'multer';
import { CloudinaryStorage } from 'multer-storage-cloudinary';

// Check if Cloudinary environment variables are set
const requiredEnvVars = ['CLOUDINARY_API_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_SECRET_KEY'];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  console.error(`Missing required Cloudinary environment variables: ${missingEnvVars.join(', ')}`);
  console.error('Document uploads will not work correctly without these variables set.');
}

// Hard-code Cloudinary configuration from .env file
// These values are taken directly from your .env file
const cloudName = 'dqjrmcagt';
const apiKey = '369516174895262';
const apiSecret = 'rHEA47fQ0PwcovW57fssoRKeIKI';

console.log('Cloudinary Configuration (hardcoded):', {
  cloudName: cloudName || 'Not set',
  apiKey: apiKey ? 'Set (hidden)' : 'Not set',
  apiSecret: apiSecret ? 'Set (hidden)' : 'Not set'
});

cloudinary.v2.config({
  cloud_name: cloudName,
  api_key: apiKey,
  api_secret: apiSecret,
});

// Configure multer storage for Cloudinary
let storage;
try {
  console.log('Setting up CloudinaryStorage...');
  storage = new CloudinaryStorage({
    cloudinary: cloudinary.v2,
    params: async (req, file) => {
      // Determine folder based on the route
      const folder = req.path.includes('/chat/') ? 'pedismart/chat_images' : 'pedismart-documents';
      
      return {
        folder: folder,
        allowed_formats: ['jpg', 'jpeg', 'png', 'pdf', 'gif', 'webp'],
        transformation: [
          { width: 1200, height: 1200, crop: 'limit', quality: 'auto' }
        ],
        public_id: `${folder.split('/')[1]}_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        timeout: 60000, // 60 seconds timeout
      };
    },
  });
  console.log('CloudinaryStorage setup successful');
} catch (error) {
  console.error('Error setting up CloudinaryStorage:', error);
  // Fallback to local storage if Cloudinary setup fails
  storage = multer.memoryStorage();
  console.log('Using fallback memory storage for uploads');
}

// Create multer upload middleware
export const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    // Check file type - allow images and PDFs
    if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only image files (JPG, JPEG, PNG, GIF, WEBP) and PDF files are allowed'), false);
    }
  }
});

// Function to delete image from Cloudinary
export const deleteFromCloudinary = async (publicId) => {
  try {
    const result = await cloudinary.v2.uploader.destroy(publicId);
    return result;
  } catch (error) {
    console.error('Error deleting from Cloudinary:', error);
    throw error;
  }
};

export default cloudinary;
