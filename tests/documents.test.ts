import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDocumentPdf } from '../src/live/document-pdf.js';
import { buildCertificatePdf } from '../src/live/certificate-pdf.js';
import { defaultDocumentStamp, type DocumentInfo } from '../src/live/document-types.js';
import { defaultBranding } from '../src/live/branding-types.js';
import { pdfAccount, pdfCertificate, pdfEnrollment, pdfReceipt } from './document-fixtures.js';

const stamp = { ...defaultDocumentStamp(defaultBranding), location: 'Academic office' };
const content = (pdf: Awaited<ReturnType<typeof buildDocumentPdf>>) => JSON.stringify((pdf.internal as unknown as { pages: string[][] }).pages);

test('every document uses identical physical geometry and vector content at phone and desktop widths', async () => {
  await import('jspdf');
  const runtime = globalThis as unknown as { window?: { innerWidth: number; devicePixelRatio: number } }, previous = runtime.window;
  try {
    for (const document of [
      {kind:'receipt',receipt:pdfReceipt}, {kind:'statement',enrollment:pdfEnrollment,receipts:[pdfReceipt]},
      {kind:'letter',account:pdfAccount,enrollment:pdfEnrollment}, {kind:'id',account:pdfAccount,enrollments:[pdfEnrollment]},
    ] as DocumentInfo[]) {
      runtime.window = {innerWidth:390,devicePixelRatio:3};const mobile = await buildDocumentPdf(document,defaultBranding,stamp);
      runtime.window = {innerWidth:1920,devicePixelRatio:1};const desktop = await buildDocumentPdf(document,defaultBranding,stamp);
      assert.equal(content(mobile),content(desktop),`${document.kind} content must not depend on viewport`);
      assert.equal(mobile.getNumberOfPages(),1);assert.ok(Math.abs(mobile.internal.pageSize.getWidth()-210)<.1);
      assert.ok(Math.abs(mobile.internal.pageSize.getHeight()-(document.kind==='id'?148:297))<.1);
      assert.match(content(mobile),/AUTHORIZED RECORD/);assert.match(content(mobile),/Academic office/);
      if(document.kind==='receipt') {assert.match(content(mobile),/INR 7,500.00/);assert.match(content(mobile),/INR 7,499.00/);}
    }
  } finally { if(previous)runtime.window=previous;else delete runtime.window; }
});

test('long fee histories paginate without losing receipt rows and repeat the institution stamp on every page', async () => {
  const receipts = Array.from({length:90},(_,index)=>({...pdfReceipt,id:`qa-${index}`,number:`PBS-QA-${String(index).padStart(6,'0')}`,reference:`QA-REFERENCE-${index}-LONG-VERIFIED-TRANSACTION`,amount:10000}));
  const pdf = await buildDocumentPdf({kind:'statement',enrollment:pdfEnrollment,receipts},defaultBranding,stamp);
  assert.ok(pdf.getNumberOfPages()>3);const pages=(pdf.internal as unknown as {pages:string[][]}).pages.slice(1);
  for(const page of pages) assert.match(page.join('\n'),/AUTHORIZED RECORD/);
  for(const receipt of receipts) assert.ok(content(pdf).includes(receipt.number),`Receipt ${receipt.number} must be preserved`);
});

test('long names stay in a single ID page and all certificate designs stay A4 landscape with an optional stamp', async () => {
  const id = await buildDocumentPdf({kind:'id',account:{...pdfAccount,name:'An exceptionally long learner name for institution record layout verification with extended family and given names',id:'PBS-EXTENDED-IDENTIFICATION-REFERENCE-01234567890123456789',rollNumber:'PBS/2026/PROFESSIONAL-BIM-ACADEMY/000001'},enrollments:[pdfEnrollment]},defaultBranding,stamp);
  assert.equal(id.getNumberOfPages(),1);
  for(const design of ['architectural','classic','minimal'] as const) {
    const pdf=await buildCertificatePdf({...pdfCertificate,template:{...pdfCertificate.template,design}},defaultBranding,{},stamp);
    assert.equal(pdf.getNumberOfPages(),1);assert.ok(Math.abs(pdf.internal.pageSize.getWidth()-297)<.1);assert.ok(Math.abs(pdf.internal.pageSize.getHeight()-210)<.1);assert.match(content(pdf),/AUTHORIZED RECORD/);
    const without=await buildCertificatePdf({...pdfCertificate,template:{...pdfCertificate.template,design}},defaultBranding,{}, {...stamp,enabled:false});assert.ok(!content(without).includes('AUTHORIZED RECORD'));
  }
});
