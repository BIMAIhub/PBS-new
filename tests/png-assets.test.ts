import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCanvas, loadImage, type Canvas } from '@napi-rs/canvas';
import { normalizePngAsset, PNG_ASSET_MAX_BYTES, preparePngAsset } from '../src/live/png-assets.js';

const canvasFactory = () => createCanvas(1, 1) as unknown as HTMLCanvasElement;
const source = (canvas: Canvas) => canvas as unknown as CanvasImageSource;
const bytes = (data: string) => Buffer.from(data.split(',')[1], 'base64');

test('detailed transparent PNGs are reduced below the existing server limit without flattening alpha', async () => {
  const canvas = createCanvas(720, 360), context = canvas.getContext('2d'), pixels = context.createImageData(720, 360);
  let seed = 173;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed & 255; };
  for (let y = 30; y < 330; y++) for (let x = 40; x < 680; x++) {
    if (x > 310 && x < 410 && y > 130 && y < 230) continue;
    const i = (y * 720 + x) * 4;
    pixels.data[i] = random(); pixels.data[i + 1] = random(); pixels.data[i + 2] = random(); pixels.data[i + 3] = 128 + random() % 128;
  }
  context.putImageData(pixels, 0, 0);
  assert.ok(canvas.toBuffer('image/png').length > 125000, 'regression fixture must exceed the old upload limit');
  const result = normalizePngAsset(source(canvas), 720, 360, canvasFactory), output = bytes(result.data);
  assert.ok(output.length <= PNG_ASSET_MAX_BYTES); assert.equal(result.byteLength, output.length);
  assert.ok(result.width < 640); assert.ok(Math.abs(result.width / result.height - 640 / 300) < .03);
  const decoded = await loadImage(output), checked = createCanvas(decoded.width, decoded.height), target = checked.getContext('2d');
  target.drawImage(decoded, 0, 0);
  assert.equal(target.getImageData(Math.floor(decoded.width / 2), Math.floor(decoded.height / 2), 1, 1).data[3], 0, 'transparent center must remain transparent');
  const alpha = target.getImageData(10, 10, 1, 1).data[3]; assert.ok(alpha > 0 && alpha < 255, 'semi-transparent artwork must not get a white background');
});

test('simple signatures retain resolution and proportions after transparent padding is trimmed', () => {
  const canvas = createCanvas(400, 180), context = canvas.getContext('2d');
  context.fillStyle = '#176BB7'; context.fillRect(20, 70, 360, 20);
  const result = normalizePngAsset(source(canvas), 400, 180, canvasFactory);
  assert.equal(result.width, 360); assert.equal(result.height, 20); assert.ok(result.byteLength < 10000);
});

test('empty artwork, invalid dimensions and non-PNG selections fail before settings are changed', async () => {
  const canvas = createCanvas(50, 50);
  assert.throws(() => normalizePngAsset(source(canvas), 50, 50, canvasFactory), /empty|transparent/);
  assert.throws(() => normalizePngAsset(source(canvas), 6001, 50, canvasFactory), /6000/);
  await assert.rejects(preparePngAsset(new File(['not an image'], 'photo.jpg', { type: 'image/jpeg' })), /PNG/);
});

test('the supplied stamp and exact website logo remain transparent upload-ready PNGs', async () => {
  for (const name of ['PBS-Institution-Stamp', 'PBS-Website-Logo']) {
    const file = readFileSync(new URL(`../public/brand-assets/${name}.png`, import.meta.url));
    assert.ok(file.length < PNG_ASSET_MAX_BYTES);
    const image = await loadImage(file), result = normalizePngAsset(image as unknown as CanvasImageSource, image.width, image.height, canvasFactory);
    assert.ok(result.byteLength <= PNG_ASSET_MAX_BYTES); assert.ok(result.data.startsWith('data:image/png;base64,'));
    const canvas = createCanvas(image.width, image.height), context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    assert.equal(context.getImageData(0, 0, 1, 1).data[3], 0);
  }
});
