const DEFAULT_MAX_SIZE = 1920;
const DEFAULT_QUALITY = 0.82;

export async function optimizeImageToWebp(file, options = {}) {
  if (!file || !String(file.type || '').startsWith('image/')) {
    throw new Error('Arquivo de imagem invalido.');
  }

  const originalSize = Number(file.size || 0);
  const fallback = {
    blob: file,
    fileName: file.name || 'image',
    mimeType: file.type || 'application/octet-stream',
    width: 0,
    height: 0,
    originalSize,
    optimizedSize: originalSize,
    compressionRatio: 1,
    previewUrl: URL.createObjectURL(file),
    converted: false,
  };

  if (typeof document === 'undefined' || typeof createImageBitmap === 'undefined') {
    return fallback;
  }

  const image = await createImageBitmap(file).catch(() => null);
  if (!image) return fallback;

  const maxSize = Number(options.maxSize || DEFAULT_MAX_SIZE);
  const quality = Number(options.quality || DEFAULT_QUALITY);
  const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return fallback;

  context.drawImage(image, 0, 0, width, height);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality));
  image.close?.();

  if (!blob || blob.type !== 'image/webp') return fallback;

  const optimizedSize = Number(blob.size || 0);
  return {
    blob,
    fileName: webpFileName(file.name || 'image'),
    mimeType: 'image/webp',
    width,
    height,
    originalSize,
    optimizedSize,
    compressionRatio: originalSize ? optimizedSize / originalSize : 1,
    previewUrl: URL.createObjectURL(blob),
    converted: true,
  };
}

function webpFileName(name) {
  const base = String(name || 'image').replace(/\.[^.]+$/, '') || 'image';
  return `${base}.webp`;
}
