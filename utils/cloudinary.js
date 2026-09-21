import { v2 as cloudinary } from 'cloudinary';

let configured = false;

export function isCloudinaryConfigured() {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET
  );
}

export function getCloudinary() {
  if (!isCloudinaryConfigured()) {
    const err = new Error(
      'Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.'
    );
    err.status = 503;
    throw err;
  }
  if (!configured) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true,
    });
    configured = true;
  }
  return cloudinary;
}

/**
 * Upload an image buffer to Cloudinary and return the secure HTTPS URL.
 * @param {{ preserveTransparency?: boolean }} opts — print logos/signatures keep PNG (no auto format).
 */
export async function uploadImageBuffer(
  buffer,
  { folder, publicId, resourceType = 'image', preserveTransparency = false } = {}
) {
  const client = getCloudinary();
  return new Promise((resolve, reject) => {
    const transformation = preserveTransparency
      ? [{ quality: 'auto', format: 'png' }]
      : [{ quality: 'auto', fetch_format: 'auto' }];
    const stream = client.uploader.upload_stream(
      {
        folder,
        public_id: publicId,
        overwrite: true,
        resource_type: resourceType,
        unique_filename: false,
        transformation,
      },
      (error, result) => {
        if (error) {
          const err = new Error(error.message || 'Cloudinary upload failed.');
          err.status = 502;
          reject(err);
          return;
        }
        resolve(result);
      }
    );
    stream.end(buffer);
  });
}
