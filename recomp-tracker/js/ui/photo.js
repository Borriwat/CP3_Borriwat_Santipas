// Getting a photo ready to send: decode it, shrink it, and re-encode it as JPEG.
// Shrinking keeps the upload small and the cost low, and drawing it onto a canvas
// drops the hidden data in a phone photo (location, camera details).

export const MAX_EDGE = 1280; // longest side, in pixels; plenty to recognise food and judge portions
export const JPEG_QUALITY = 0.85;
const MAX_FILE_BYTES = 40 * 1024 * 1024;

const loadImage = (url) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('decode'));
    img.src = url;
  });

// Returns { base64, mediaType, width, height, previewUrl } or throws an Error
// whose message is safe to show.
export async function prepareImage(file) {
  if (!file || !/^image\//.test(file.type || 'image/')) throw new Error('That does not look like a photo.');
  if (file.size > MAX_FILE_BYTES) throw new Error('That photo is too large.');
  const source = URL.createObjectURL(file);
  try {
    let img;
    try {
      img = await loadImage(source);
    } catch {
      throw new Error('This photo could not be read. Try taking a new one in the app, or pick a different photo.');
    }
    // The browser applies the photo's rotation when it draws, so portrait photos stay upright.
    const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // transparent PNGs would otherwise turn black
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    if (!base64) throw new Error('This photo could not be prepared.');
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', JPEG_QUALITY));
    return { base64, mediaType: 'image/jpeg', width, height, previewUrl: blob ? URL.createObjectURL(blob) : '' };
  } finally {
    URL.revokeObjectURL(source);
  }
}

export const releasePreview = (url) => {
  if (url) URL.revokeObjectURL(url);
};
