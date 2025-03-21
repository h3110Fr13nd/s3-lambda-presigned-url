const { S3Client, PutObjectCommand, ListBucketsCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

// Set your bucket name here or pass it as an environment variable
const BUCKET_NAME = process.env.BUCKET_NAME || 'your-bucket-name';

// Default expiration time for presigned URLs (24 hours)
const URL_EXPIRATION_SECONDS = 24 * 60 * 60;

// Initialize S3 client
const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

exports.handler = async (event, context) => {
  try {
    console.log('Event:', JSON.stringify(event, null, 2));
    console.log('Using bucket:', BUCKET_NAME);
    console.log('Region:', process.env.AWS_REGION || 'us-east-1');
    
    // Verify AWS credentials and S3 access
    try {
      console.log('Checking S3 connectivity...');
      const listBucketsCommand = new ListBucketsCommand({});
      const listBucketsResponse = await s3Client.send(listBucketsCommand);
      console.log('Available buckets:', listBucketsResponse.Buckets.map(b => b.Name).join(', '));
      
      if (!listBucketsResponse.Buckets.some(b => b.Name === BUCKET_NAME)) {
        console.warn(`Warning: Bucket ${BUCKET_NAME} not found in available buckets`);
      }
    } catch (connErr) {
      console.error('Error connecting to S3:', connErr);
    }
    
    let requestData;
    
    // Handle both direct Lambda invocation and API Gateway events
    if (event.body) {
      // API Gateway invocation (event.body is a string)
      requestData = JSON.parse(typeof event.body === 'string' ? event.body : '{}');
    } else {
      // Direct Lambda invocation (event itself contains the data)
      requestData = event;
    }
    
    const { action, key, contentType, base64Content } = requestData;
    console.log('Action:', action);
    console.log('Key:', key);
    
    // Proceed with the action handling
    switch (action) {
      case 'upload':
        // Validate required parameters for upload
        if (!key || !contentType || !base64Content) {
          return formatResponse(400, { 
            message: 'Missing required parameters. Please provide key, contentType, and base64Content.' 
          });
        }
        
        // Process base64 content - handle data URL format if provided
        let processedBase64 = base64Content;
        if (base64Content.startsWith('data:')) {
          processedBase64 = base64Content.split(',')[1];
        }
        
        console.log('Content Type:', contentType);
        console.log('Base64 length:', processedBase64.length);
        
        try {
          // Upload file to S3
          console.log('Attempting to upload to S3...');
          const uploadResult = await uploadToS3(key, contentType, processedBase64);
          console.log('Upload result:', JSON.stringify(uploadResult, null, 2));
          
          // Generate presigned URL for the uploaded file
          console.log('Generating presigned URL...');
          const presignedUrl = await generatePresignedUrl(key);
          console.log('Generated URL:', presignedUrl);
          
          return formatResponse(200, { 
            message: 'File uploaded successfully',
            key: key,
            presignedUrl: presignedUrl
          });
        } catch (opErr) {
          console.error('Operation error details:', JSON.stringify(opErr, null, 2));
          throw opErr; // Re-throw to be caught by the outer try/catch
        }
        
      case 'getUrl':
        // Validate required parameters for generating presigned URL
        if (!key) {
          return formatResponse(400, { 
            message: 'Missing required parameter. Please provide key.' 
          });
        }
        
        try {
          // Generate presigned URL for existing file
          console.log('Generating presigned URL for existing object...');
          const url = await generatePresignedUrl(key);
          console.log('Generated URL:', url);
          
          return formatResponse(200, { 
            key: key,
            presignedUrl: url
          });
        } catch (opErr) {
          console.error('Operation error details:', JSON.stringify(opErr, null, 2));
          throw opErr; // Re-throw to be caught by the outer try/catch
        }
        
      default:
        return formatResponse(400, { 
          message: 'Invalid action. Please specify "upload" or "getUrl".' 
        });
    }
  } catch (error) {
    console.error('Error type:', error.constructor.name);
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    
    return formatResponse(500, { 
      message: 'Internal server error',
      error: error.message,
      errorType: error.constructor.name,
      stack: process.env.DEBUG === 'true' ? error.stack : undefined
    });
  }
};

/**
 * Upload a file to S3
 * @param {string} key - The S3 object key
 * @param {string} contentType - The file's MIME type
 * @param {string} base64Content - Base64 encoded file content
 * @returns {Promise} - S3 upload result
 */
async function uploadToS3(key, contentType, base64Content) {
  // Convert base64 to buffer
  const buffer = Buffer.from(base64Content, 'base64');
  
  const putParams = {
    Bucket: BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: contentType
  };
  
  console.log('PutObject params:', JSON.stringify({
    ...putParams,
    Body: `<binary data of length ${buffer.length}>`
  }, null, 2));
  
  const command = new PutObjectCommand(putParams);
  return await s3Client.send(command);
}

/**
 * Generate a presigned URL for an S3 object
 * @param {string} key - The S3 object key
 * @returns {string} - Presigned URL
 */
async function generatePresignedUrl(key) {
  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  
  const getObjectParams = {
    Bucket: BUCKET_NAME,
    Key: key
  };
  
  console.log('GetObject params:', JSON.stringify(getObjectParams, null, 2));
  
  const command = new GetObjectCommand(getObjectParams);
  return await getSignedUrl(s3Client, command, { expiresIn: URL_EXPIRATION_SECONDS });
}

/**
 * Format API Gateway response
 * @param {number} statusCode - HTTP status code
 * @param {object} body - Response body
 * @returns {object} - Formatted response
 */
function formatResponse(statusCode, body) {
  return {
    statusCode: statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*', // For CORS support
      'Access-Control-Allow-Credentials': true
    },
    body: JSON.stringify(body)
  };
}