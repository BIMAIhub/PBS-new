export const PNG_ASSET_MAX_BYTES = 120_000;
export type PreparedPng = { data: string; width: number; height: number; byteLength: number };
type CanvasFactory = () => HTMLCanvasElement;

function pngBytes(data: string) {
  const prefix = 'data:image/png;base64,';
  if (!data.startsWith(prefix)) throw new Error('This browser could not prepare a PNG image. Try another browser.');
  const value = data.slice(prefix.length);
  return Math.floor(value.length * 3 / 4) - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0);
}

// Keep alpha and proportions, and adapt the dimensions to the actual PNG size.
// PNG ignores the JPEG quality argument; detailed artwork needs fewer pixels.
export function normalizePngAsset(image: CanvasImageSource, width: number, height: number, makeCanvas: CanvasFactory = () => document.createElement('canvas')): PreparedPng {
  if (![width, height].every(value => Number.isFinite(value) && value > 0 && value <= 6000)) throw new Error('Use a PNG up to 6000 pixels on each side.');
  function canvas(w: number, h: number) {
    const result = makeCanvas(); result.width = Math.max(1, Math.round(w)); result.height = Math.max(1, Math.round(h));
    const context = result.getContext('2d');
    if (!context) throw new Error('Image preparation is unavailable in this browser.');
    return { image: result, context };
  }
  const scale = Math.min(1, 720 / Math.max(width, height)), source = canvas(width * scale, height * scale);
  source.context.drawImage(image, 0, 0, source.image.width, source.image.height);
  const pixels = source.context.getImageData(0, 0, source.image.width, source.image.height).data;
  let left = source.image.width, top = source.image.height, right = -1, bottom = -1;
  for (let y = 0; y < source.image.height; y++) for (let x = 0; x < source.image.width; x++) {
    if (pixels[(y * source.image.width + x) * 4 + 3] > 8) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); }
  }
  if (right < 0) throw new Error('The PNG is empty or completely transparent.');
  const cropped = canvas(right - left + 1, bottom - top + 1);
  cropped.context.drawImage(source.image, left, top, cropped.image.width, cropped.image.height, 0, 0, cropped.image.width, cropped.image.height);
  let candidate = cropped.image, edge = Math.max(candidate.width, candidate.height);
  for (;;) {
    const data = candidate.toDataURL('image/png'), byteLength = pngBytes(data);
    if (byteLength <= PNG_ASSET_MAX_BYTES) return { data, width: candidate.width, height: candidate.height, byteLength };
    if (edge <= 128) throw new Error('This PNG could not be prepared. Try another PNG file.');
    edge = Math.max(128, Math.floor(edge * Math.min(.85, Math.max(.5, Math.sqrt(PNG_ASSET_MAX_BYTES / byteLength) * .9))));
    const factor = edge / Math.max(cropped.image.width, cropped.image.height), smaller = canvas(cropped.image.width * factor, cropped.image.height * factor);
    smaller.context.drawImage(cropped.image, 0, 0, smaller.image.width, smaller.image.height);
    candidate = smaller.image;
  }
}

export async function preparePngAsset(file: File): Promise<PreparedPng> {
  if ((file.type && file.type !== 'image/png') || (!file.type && !/\.png$/i.test(file.name)) || file.size > 10 * 1024 ** 2) throw new Error('Choose a PNG image below 10 MB. PBS will resize it automatically.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url;
    try { await image.decode(); } catch { throw new Error('This PNG could not be opened. Choose a valid PNG image.'); }
    return normalizePngAsset(image, image.naturalWidth, image.naturalHeight);
  } finally { URL.revokeObjectURL(url); }
}
