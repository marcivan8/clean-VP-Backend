const storageConfig = require('./config/storage');

async function checkCors() {
    try {
        if (!storageConfig.bucket) {
            console.log('GCS Bucket is not configured.');
            return;
        }
        
        const [metadata] = await storageConfig.bucket.getMetadata();
        console.log('Current CORS config for bucket:');
        console.log(JSON.stringify(metadata.cors, null, 2));
    } catch (err) {
        console.error('Error fetching CORS:', err.message);
    }
}

checkCors();
