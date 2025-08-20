// config/storage.js - Production configuration with proper error handling
const { Storage } = require('@google-cloud/storage');
const path = require('path');
const fs = require('fs');

let storage = null;
let bucket = null;
let useLocalStorage = false;

// Function to setup local storage
function setupLocalStorage() {
  const uploadsDir = path.join(__dirname, '..', 'uploads');
  
  // Create main uploads directory
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  
  // Create subdirectories for different storage types
  const folders = ['analysis-only', 'ai-training', 'temp'];
  folders.forEach(folder => {
    const folderPath = path.join(uploadsDir, folder);
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }
  });
  
  console.log('📁 Using local storage at:', uploadsDir);
  useLocalStorage = true;
}

// Try to initialize Google Cloud Storage
try {
  // Check if GCS credentials are provided
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || 
      process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON === '' ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON === '{}' ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON === 'your-credentials-here') {
    
    console.log('ℹ️ Google Cloud Storage credentials not configured');
    console.log('ℹ️ Using local file storage instead');
    setupLocalStorage();
  } else {
    try {
      // Try to parse the credentials
      const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
      
      // Validate required fields
      if (!credentials.type || !credentials.project_id || !credentials.private_key) {
        throw new Error('Invalid Google Cloud credentials structure');
      }
      
      // Check for bucket name
      const bucketName = process.env.GOOGLE_CLOUD_BUCKET_NAME;
      if (!bucketName || bucketName === 'your-bucket-name') {
        console.log('⚠️ GOOGLE_CLOUD_BUCKET_NAME not properly configured');
        console.log('ℹ️ Using local file storage instead');
        setupLocalStorage();
      } else {
        // Initialize Google Cloud Storage
        storage = new Storage({
          projectId: process.env.GOOGLE_CLOUD_PROJECT_ID || credentials.project_id,
          credentials: credentials
        });
        
        bucket = storage.bucket(bucketName);
        
        // Test the connection
        bucket.exists()
          .then(([exists]) => {
            if (exists) {
              console.log('✅ Google Cloud Storage configured successfully');
              console.log(`📦 Using bucket: ${bucketName}`);
            } else {
              console.warn(`⚠️ Bucket ${bucketName} does not exist`);
              console.log('ℹ️ Falling back to local storage');
              setupLocalStorage();
            }
          })
          .catch(err => {
            console.warn('⚠️ Could not verify GCS bucket:', err.message);
            console.log('ℹ️ Falling back to local storage');
            setupLocalStorage();
          });
      }
    } catch (parseError) {
      console.error('⚠️ Error parsing Google Cloud credentials:', parseError.message);
      console.log('ℹ️ Using local file storage instead');
      console.log('💡 Tip: Make sure GOOGLE_APPLICATION_CREDENTIALS_JSON contains valid JSON');
      setupLocalStorage();
    }
  }
} catch (error) {
  console.error('⚠️ Unexpected error in storage configuration:', error.message);
  setupLocalStorage();
}

// If nothing was configured, use local storage
if (!storage && !useLocalStorage) {
  setupLocalStorage();
}

// Storage folders configuration
const FOLDERS = {
  ANALYSIS_ONLY: 'analysis-only/', // Videos deleted after 30 days
  AI_TRAINING: 'ai-training/',     // Videos kept for AI training
  TEMP: 'temp/'                    // Temporary files
};

module.exports = { 
  storage, 
  bucket, 
  FOLDERS,
  useLocalStorage 
};