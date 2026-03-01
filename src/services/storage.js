import { nanoid } from 'nanoid';
import { supabase } from './supabase.js';

const BUCKET = 'receipts';

/**
 * Upload a base64-encoded image to Supabase Storage.
 * @param {string} base64Data - base64 string (no data URI prefix)
 * @param {string} mimeType   - e.g. 'image/jpeg'
 * @returns {string} public URL of the uploaded image
 */
export async function saveImage(base64Data, mimeType) {
  const ext      = (mimeType.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
  const filename = `${Date.now()}-${nanoid(8)}.${ext}`;
  const buffer   = Buffer.from(base64Data, 'base64');

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(filename, buffer, {
      contentType: mimeType,
      upsert: false,
    });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(filename);
  return data.publicUrl;
}

/**
 * Delete an image from Supabase Storage by its public URL.
 * Silently ignores errors (non-critical).
 * @param {string} publicUrl
 */
export async function deleteImage(publicUrl) {
  try {
    if (!publicUrl) return;
    const url      = new URL(publicUrl);
    const pathParts = url.pathname.split(`/object/public/${BUCKET}/`);
    const filename  = pathParts[1];
    if (filename) {
      await supabase.storage.from(BUCKET).remove([filename]);
    }
  } catch {
    // non-critical, ignore
  }
}

// No-op for cloud mode — no local dirs to create
export function ensureUploadsDir() {}
