import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDocumentPdf } from '../src/live/document-pdf.js';
import { buildCertificatePdf } from '../src/live/certificate-pdf.js';
import { buildBrochurePdf } from '../src/live/brochure-pdf.js';
import type { CourseBrochure } from '../src/live/education-types.js';
import { defaultDocumentStamp, type DocumentInfo } from '../src/live/document-types.js';
import { defaultBranding } from '../src/live/branding-types.js';
import { pdfAccount, pdfCertificate, pdfEnrollment, pdfReceipt } from './document-fixtures.js';

const stamp = { ...defaultDocumentStamp(defaultBranding), location: 'Academic office' };
const content = (pdf: Awaited<ReturnType<typeof buildDocumentPdf>>) => JSON.stringify((pdf.internal as unknown as { pages: string[][] }).pages);

const extracted=new WeakMap<object,Promise<string[]>>();
async function pdfPages(pdf:Awaited<ReturnType<typeof buildDocumentPdf>>) {
  let text=extracted.get(pdf);if(!text){text=(async()=>{const engine=await import('pdfjs-dist/legacy/build/pdf.mjs');const task=engine.getDocument({data:new Uint8Array(pdf.output('arraybuffer')),useSystemFonts:false});const document=await task.promise;try{const pages=[];for(let i=1;i<=document.numPages;i++){const page=await document.getPage(i),content=await page.getTextContent();pages.push(content.items.map(item=>'str'in item?item.str:'').join(' '));}return pages;}finally{await task.destroy();}})();extracted.set(pdf,text);}return text;
}
const readable=async(pdf:Awaited<ReturnType<typeof buildDocumentPdf>>)=>(await pdfPages(pdf)).join('\n');

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
      assert.ok(Math.abs(mobile.internal.pageSize.getHeight()-297)<.1);
      assert.match(await readable(mobile),/AUTHORIZED RECORD/);assert.match(await readable(mobile),/Academic office/);
      if(document.kind==='receipt') {assert.match(await readable(mobile),/INR 7,500.00/);assert.match(await readable(mobile),/INR 7,499.00/);}
    }
  } finally { if(previous)runtime.window=previous;else delete runtime.window; }
});

test('long fee histories paginate without losing receipt rows and repeat the institution stamp on every page', async () => {
  const receipts = Array.from({length:90},(_,index)=>({...pdfReceipt,id:`qa-${index}`,number:`PBS-QA-${String(index).padStart(6,'0')}`,reference:`QA-REFERENCE-${index}-LONG-VERIFIED-TRANSACTION`,amount:10000}));
  const pdf = await buildDocumentPdf({kind:'statement',enrollment:pdfEnrollment,receipts},defaultBranding,stamp);
  assert.ok(pdf.getNumberOfPages()>3);const pages=await pdfPages(pdf);
  for(const page of pages) assert.match(page,/AUTHORIZED RECORD/);
  for(const receipt of receipts) assert.ok((await readable(pdf)).includes(receipt.number),`Receipt ${receipt.number} must be preserved`);
});

test('long names stay in a single ID page and all certificate designs stay A4 landscape with an optional stamp', async () => {
  const id = await buildDocumentPdf({kind:'id',account:{...pdfAccount,name:'An exceptionally long learner name for institution record layout verification with extended family and given names',id:'PBS-EXTENDED-IDENTIFICATION-REFERENCE-01234567890123456789',rollNumber:'PBS/2026/PROFESSIONAL-BIM-ACADEMY/000001'},enrollments:[pdfEnrollment]},defaultBranding,stamp);
  assert.equal(id.getNumberOfPages(),1);
  for(const design of ['architectural','classic','minimal'] as const) {
    const pdf=await buildCertificatePdf({...pdfCertificate,template:{...pdfCertificate.template,design}},defaultBranding,{},stamp);
    assert.equal(pdf.getNumberOfPages(),1);assert.ok(Math.abs(pdf.internal.pageSize.getWidth()-297)<.1);assert.ok(Math.abs(pdf.internal.pageSize.getHeight()-210)<.1);assert.match(await readable(pdf),/AUTHORIZED RECORD/);assert.equal((await readable(pdf)).split(pdfCertificate.template.signer).length-1,1,'one authorized signatory per certificate');
    const without=await buildCertificatePdf({...pdfCertificate,template:{...pdfCertificate.template,design}},defaultBranding,{}, {...stamp,enabled:false});assert.ok(!(await readable(without)).includes('AUTHORIZED RECORD'));
  }
});

test('historical credentials describe verified training without inventing an assessment and retain original references',async()=>{
  const pdf=await buildCertificatePdf({...pdfCertificate,studentName:'An extended recipient name with multiple family names for historical institution credential review',
    courseTitle:'Professional Building Information Modelling, Revit Mechanical Electrical Plumbing Coordination and Advanced Project Documentation',
    template:{...pdfCertificate.template,title:'Certificate of professional course completion',signer:'Academic director and head of professional BIM learning programs',signerRole:'Authorized institution signatory for professional training and education'},
    historical:{completedAt:'2024-06-01',mode:'offline',originalNumber:'PBS/OFFLINE/2024/ORIGINAL-000001',qualification:'Civil engineer',scoreRecorded:false,hasOriginal:true}},defaultBranding,{},stamp);
  assert.equal(pdf.getNumberOfPages(),1);assert.match(await readable(pdf),/has completed verified offline training in/);assert.ok(!(await readable(pdf)).includes('learning requirements and assessment'));assert.match(await readable(pdf),/ORIGINAL-000001/);
});

test('course brochures paginate real curriculum and use identical A4 content on mobile and desktop',async()=>{
  const course:CourseBrochure={id:'qa-brochure',title:pdfEnrollment.courseTitle,description:'A course brochure layout fixture. Never published to the academy catalog.',category:'BIM',instructor:'',schedule:'',fee:1800000,brand:defaultBranding,
    price:{listPrice:1800000,total:1500000,discount:300000,promotionId:'qa',promotionTitle:'First batch offer',code:'',percent:17},
    page:{level:'Beginner to advanced',duration:'Self-paced videos with live mentorship',audience:'Civil and MEP engineers',outcomes:['Develop coordinated BIM models','Produce practical project documentation'],requirements:['A supported Revit installation']},
    modules:Array.from({length:10},(_,i)=>({id:`module-${i}`,title:`Module ${i+1} — practical BIM workflows`,summary:'A detailed introduction to practical learning tasks.',objectives:['Practise the workflow with the supplied model.'],lessons:Array.from({length:9},(_,n)=>({title:`Recorded lesson ${i+1}.${n+1}: project coordination and modelling exercises`,duration:'20 min'}))})),batches:[{name:'Quality review batch',startsAt:'2026-12-01T12:00:00Z',deadline:'2026-11-30T12:00:00Z',seatsLeft:12}]};
  await import('jspdf');const runtime=globalThis as unknown as {window?:{innerWidth:number;devicePixelRatio:number}},previous=runtime.window;
  try{runtime.window={innerWidth:390,devicePixelRatio:3};const phone=await buildBrochurePdf(course,'https://portal.example.invalid',stamp);runtime.window={innerWidth:1920,devicePixelRatio:1};const desktop=await buildBrochurePdf(course,'https://portal.example.invalid',stamp);
    assert.equal(content(phone),content(desktop));assert.ok(phone.getNumberOfPages()>3);assert.ok(Math.abs(phone.internal.pageSize.getHeight()-297)<.1);assert.match(await readable(phone),/10.9/);assert.match(await readable(phone),/INR 15,000/);
  }finally{if(previous)runtime.window=previous;else delete runtime.window;}
});
