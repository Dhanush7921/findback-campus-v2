/** Downscale and re-encode an image client-side (strips EXIF/GPS metadata as a side-effect). */
export async function compressImage(file: File, maxSide = 1600, quality = 0.82): Promise<{ mime: string; dataBase64: string; previewUrl: string; bytes: number }> {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type) && !/\.(jpe?g|png|webp|heic)$/i.test(file.name)) {
    throw new Error('Please choose a JPEG, PNG or WebP image.');
  }
  if (file.size > 15 * 1024 * 1024) throw new Error('That image is too large (max 15 MB before compression).');
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error('This image format could not be read. Try a JPEG or PNG.'); });
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not process image'))), 'image/jpeg', quality));
  if (blob.size > 3 * 1024 * 1024) throw new Error('Image is still over 3 MB after compression. Try a smaller photo.');
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { mime: 'image/jpeg', dataBase64: btoa(bin), previewUrl: URL.createObjectURL(blob), bytes: blob.size };
}
