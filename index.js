const { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const REGION = process.env.AWS_REGION || 'us-east-1';
const BUCKET_NAME = process.env.BUCKET_NAME;
const s3Client = new S3Client({ region: REGION });

exports.handler = async (event) => {
  try {
    if (!event.body) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing request body." })
      };
    }
    
    if (event.httpMethod === "OPTIONS") {
      return {
          statusCode: 200,
          body: JSON.stringify({})
      };
    }

    const { action, fileContent, fileName, prefix } = JSON.parse(event.body);

    if (!action) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing action in request body." })
      };
    }

    if (action === "upload") {
      if (!fileContent || !fileName) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: "Missing fileContent or fileName." })
        };
      }

      // Upload the file to S3
      const putParams = {
        Bucket: BUCKET_NAME,
        Key: fileName,
        Body: Buffer.from(fileContent, "base64")
      };
      await s3Client.send(new PutObjectCommand(putParams));

      // Generate a presigned URL for the uploaded file
      const getCommand = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: fileName
      });
      const presignedUrl = await getSignedUrl(s3Client, getCommand, { expiresIn: 24 * 60 * 60 });

      return {
        statusCode: 200,
        body: JSON.stringify({
          message: "File uploaded successfully.",
          fileKey: fileName,
          presignedUrl
        })
      };
    }

    if (action === "get_presigned_url") {
      if (!fileName) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: "Missing fileName for presigned URL." })
        };
      }

      const getCommand = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: fileName
      });
      const presignedUrl = await getSignedUrl(s3Client, getCommand, { expiresIn: 24 * 60 * 60 });

      return {
        statusCode: 200,
        body: JSON.stringify({
          message: "Presigned URL generated.",
          fileKey: fileName,
          presignedUrl
        })
      };
    }

    if (action === "list_files") {
      // Optional: Use a prefix to filter the list (or set it to an empty string)
      const listPrefix = prefix || '';

      let isTruncated = true;
      let continuationToken = undefined;
      const files = [];

      while (isTruncated) {
        const listParams = {
          Bucket: BUCKET_NAME,
          Prefix: listPrefix,
          ContinuationToken: continuationToken
        };

        const data = await s3Client.send(new ListObjectsV2Command(listParams));
        if (data.Contents) {
          files.push(...data.Contents.map(item => item.Key));
        }

        isTruncated = data.IsTruncated;
        continuationToken = data.NextContinuationToken;
      }

      return {
        statusCode: 200,
        body: JSON.stringify({
          message: "Files retrieved successfully.",
          files
        })
      };
    }

    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Invalid action specified." })
    };

  } catch (error) {
    console.error("Error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal Server Error", details: error.message })
    };
  }
};
