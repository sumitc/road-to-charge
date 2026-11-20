export interface PreparedPhoto {
  dataUrl: string;
  name: string;
}

/** Downscale and compress an image before sending it to the submission API. */
export async function preparePhoto(file: File, maxEdge = 1600): Promise<PreparedPhoto> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is not supported in this browser');
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      result => (result ? resolve(result) : reject(new Error('Could not compress image'))),
      'image/jpeg',
      0.82
    );
  });

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read image'));
    reader.readAsDataURL(blob);
  });

  return { dataUrl, name: file.name || 'photo.jpg' };
}
