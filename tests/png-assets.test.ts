import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCanvas, loadImage, type Canvas } from '@napi-rs/canvas';
import { normalizePngAsset, PNG_ASSET_MAX_BYTES, preparePngAsset } from '../src/live/png-assets.js';
import { needsLightPdfBackdrop,lightSignatureInk,tintedSignatureInk } from '../src/live/pdf-image.js';

const canvasFactory = () => createCanvas(1, 1) as unknown as HTMLCanvasElement;
const source = (canvas: Canvas) => canvas as unknown as CanvasImageSource;
const bytes = (data: string) => Buffer.from(data.split(',')[1], 'base64');

test('navy certificate artwork uses a backing for dark ink while preserving light ink on transparent PNGs',async()=>{
  const png=(color:string)=>{const canvas=createCanvas(120,40),context=canvas.getContext('2d');context.fillStyle=color;context.fillRect(15,15,90,10);return canvas.toDataURL('image/png');};
  assert.equal(await needsLightPdfBackdrop(png('#101010')),true);
  assert.equal(await needsLightPdfBackdrop(png('#176BB7')),true);
  assert.equal(await needsLightPdfBackdrop(png('#F4F7FA')),false);
  assert.equal(await needsLightPdfBackdrop(png('#D4A94D')),false);
  assert.equal(await needsLightPdfBackdrop('data:image/png;base64,invalid'),true);
});

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


test('both signature PNGs render as light ink with preserved strokes and no white scanner box',async()=>{
  const canvas=createCanvas(120,40),context=canvas.getContext('2d');
  context.fillStyle='#fff';context.fillRect(0,0,120,40);context.fillStyle='#101010';context.fillRect(10,10,100,20);
  const original=canvas.toDataURL('image/png'),output=await lightSignatureInk(original),image=await loadImage(bytes(output));
  const target=createCanvas(120,40),checked=target.getContext('2d');checked.drawImage(image,0,0);
  assert.equal(checked.getImageData(0,0,1,1).data[3],0);
  const ink=Array.from(checked.getImageData(20,20,1,1).data);
  assert.ok(ink.every((channel,index)=>Math.abs(channel-[244,247,250,239][index])<=1),'canvas premultiplication may round a channel by one');
  assert.equal(canvas.toDataURL('image/png'),original,'source PNG remains unchanged');
  context.clearRect(0,0,120,40);context.globalAlpha=.5;context.fillStyle='#176BB7';context.fillRect(10,10,100,20);
  const transparent=await loadImage(bytes(await lightSignatureInk(canvas.toDataURL('image/png'))));checked.clearRect(0,0,120,40);checked.drawImage(transparent,0,0);
  assert.equal(checked.getImageData(0,0,1,1).data[3],0);assert.ok(Math.abs(checked.getImageData(20,20,1,1).data[3]-128)<=1);
});


test('approved light-blue certificates retain a coloured paper field and legible navy signature strokes',async()=>{
  const art=await loadImage(readFileSync(new URL('../src/assets/certificate-art/pbs-certificate-blueprint.jpg',import.meta.url)));
  assert.equal(art.width/art.height,4/3);
  const paper=createCanvas(art.width,art.height),paperContext=paper.getContext('2d');paperContext.drawImage(art,0,0);
  for(const [x,y] of [[1500,1150],[350,910]]) {
    const [r,g,b]=paperContext.getImageData(x,y,1,1).data;
    assert.ok(r>155&&g>175&&b>195,'the approved paper stays pale');
    assert.ok(b-r>12,'the background retains a blue tint instead of white');
  }
  const source=createCanvas(120,40),context=source.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,120,40);context.fillStyle='#101010';context.fillRect(10,10,100,20);
  const original=source.toDataURL('image/png'),rendered=await loadImage(bytes(await tintedSignatureInk(original,'#15364D'))),result=createCanvas(120,40),checked=result.getContext('2d');checked.drawImage(rendered,0,0);
  assert.equal(checked.getImageData(0,0,1,1).data[3],0,'signature paper does not create a box');
  const colour=Array.from(checked.getImageData(20,20,1,1).data);
  assert.ok(colour.every((channel,index)=>Math.abs(channel-[21,54,77,239][index])<=1),'the signature uses dark ink for the approved light background');
  assert.equal(source.toDataURL('image/png'),original,'saved signature pixels are unchanged');
});
