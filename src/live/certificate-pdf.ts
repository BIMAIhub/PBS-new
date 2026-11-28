import { installPdfFonts } from './pdf-fonts.js';
import { drawPdfBrand,fitPdfImage,needsLightPdfBackdrop } from './pdf-image.js';
import type { jsPDF } from 'jspdf';
import type { CertificateRecord } from './academy-types.js';
import type { Branding } from './branding-types.js';
import { defaultDocumentStamp,type DocumentStamp } from './document-types.js';
import { drawPdfStamp } from './pdf-stamp.js';

export const certificateLayoutVersion = 'pbs-mep-blueprint-2026-11';
export const defaultCertificateDuration = '6 months of training';
export const certificatePage={width:297,height:210,logo:{x:18,y:18,width:17,height:17},stamp:{x:52,y:170,radius:12.5},signature:{x:116,y:172,width:62,height:11}};

function drawingPipe(pdf:jsPDF,points:[number,number][],color:string,background:string,width=1.7){
  const path=points.map((point,index)=>({op:index?'l':'m',c:point}));
  pdf.setLineJoin('round');pdf.setLineCap('round');pdf.setDrawColor(color);pdf.setLineWidth(width);pdf.path(path).stroke();
  pdf.setDrawColor(background);pdf.setLineWidth(Math.max(.2,width-.3));pdf.path(path).stroke();
  pdf.setDrawColor(color);pdf.setLineWidth(.12);pdf.setLineDashPattern([1.2,1.2],0);pdf.path(path).stroke();pdf.setLineDashPattern([],0);
  for(const point of [points[0],points[points.length-1]]){pdf.setLineWidth(.15);pdf.ellipse(point[0],point[1],width*.5,width*.27,'S');}
  pdf.setLineCap('butt');pdf.setLineJoin('miter');
}

export async function buildCertificatePdf(record:CertificateRecord,brand:Branding,assets:{logo?:string;qr?:string;verificationUrl?:string;fonts?:string[];duration?:string}={},stamp:DocumentStamp=defaultDocumentStamp(brand)) {
  const {jsPDF}=await import('jspdf'),pdf=new jsPDF({orientation:'landscape',format:'a4',unit:'mm',compress:true,putOnlyUsedFonts:true});
  await installPdfFonts(pdf,assets.fonts);
  const t=record.template,main='#0D2942',sidebar='#091D30',ink='#F4F7FA',muted='#BACBD9',gold=t.accentColor,blue=t.primaryColor,left=116,bodyWidth=165;
  const clean=(value:string)=>value.replace(/[–—]/g,'-').replace(/₹/g,'INR ');
  const mix=(a:string,b:string,weight:number)=>'#'+[1,3,5].map(index=>Math.round(parseInt(a.slice(index,index+2),16)*(1-weight)+parseInt(b.slice(index,index+2),16)*weight).toString(16).padStart(2,'0')).join('');
  function block(value:string,x:number,y:number,width:number,height:number,size:number,color=ink,bold=false){
    pdf.setFont('helvetica',bold?'bold':'normal');pdf.setTextColor(color);let lines:string[]=[];
    do{pdf.setFontSize(size);lines=pdf.splitTextToSize(clean(value),width);if(lines.length*size*.35278*1.17<=height)break;size-=.5;}while(size>5);
    pdf.text(lines,x,y+size*.35278,{lineHeightFactor:1.17});
  }
  const label=(value:string,x:number,y:number,size=8,color=muted,bold=false)=>{pdf.setFont('helvetica',bold?'bold':'normal');pdf.setFontSize(size);pdf.setTextColor(color);pdf.text(clean(value),x,y);};
  const date=(value:string)=>new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeZone:'Asia/Kolkata'}).format(new Date(value));
  pdf.setProperties({title:`${t.title} - ${record.studentName}`,subject:record.courseTitle,author:t.issuer,creator:brand.academyName});
  pdf.setFillColor(main);pdf.rect(0,0,297,210,'F');pdf.setFillColor(sidebar);pdf.rect(0,0,99,210,'F');
  pdf.setDrawColor(mix(blue,main,.77));pdf.setLineWidth(.12);
  for(let x=99;x<290;x+=16)pdf.line(x,9,x,201);
  for(let y=18;y<202;y+=16)pdf.line(99,y,288,y);
  if(t.design!=='minimal'){
    for(let x=9;x<99;x+=8)pdf.line(x,145,x,201);
    for(let y=145;y<202;y+=8)pdf.line(9,y,99,y);
    const pipeInk=mix(gold,main,.64),sideInk=mix(gold,sidebar,.62);
    drawingPipe(pdf,[[238,-7],[238,12],[259,25],[259,35],[283,49],[300,40]],pipeInk,main,2.2);
    drawingPipe(pdf,[[226,0],[226,19],[248,32],[248,43],[271,57],[286,48]],pipeInk,main,1.5);
    drawingPipe(pdf,[[255,-7],[255,5],[278,19],[297,8]],pipeInk,main,1.8);
    drawingPipe(pdf,[[-8,197],[15,183],[29,191],[42,183],[60,193],[75,184]],sideInk,sidebar,1.8);
    drawingPipe(pdf,[[4,214],[22,203],[22,196],[39,186],[57,197],[77,185]],sideInk,sidebar,1.5);
  }
  pdf.setDrawColor('#496781');pdf.setLineWidth(.35);pdf.rect(9,9,279,192);
  if(t.design==='classic'){pdf.setDrawColor(mix(gold,main,.55));pdf.setLineWidth(.16);pdf.rect(11,11,275,188);}
  pdf.setDrawColor(gold);pdf.setLineWidth(.6);pdf.line(99,9,99,201);
  const logo=certificatePage.logo;drawPdfBrand(pdf,logo.x,logo.y,logo.width,logo.height,t.logoImage||assets.logo);
  block(t.issuer,39,19,52,12,10.5,ink,true);block(brand.tagline||'BIM learning & professional practice',39,32,52,11,7,muted);
  label('CREDENTIAL REFERENCE',18,70,7.5,muted);
  block(record.historical?.originalNumber?`${record.historical.originalNumber}\n${record.id}`:record.id,18,75,73,19,10,ink,true);
  label(record.historical?'TRAINING COMPLETED':'CERTIFICATE ISSUED',18,103,7.5,muted);
  block(date(record.historical?record.historical.completedAt+'T12:00:00Z':record.issuedAt),18,108,73,10,10.5,ink,true);
  const scoreAvailable=!record.historical||record.historical.scoreRecorded;
  label(scoreAvailable?'ASSESSMENT SCORE':'TRAINING RECORD',18,127,7.5,muted);
  block(scoreAvailable?`${record.score}%`:`Verified ${record.historical!.mode} completion`,18,132,73,16,10,ink,true);
  if(stamp.enabled){
    const seal=certificatePage.stamp;
    // Keep uploaded seal pixels unchanged and legible; generated seals use the blueprint's gold ink.
    if(stamp.imageData&&await needsLightPdfBackdrop(stamp.imageData)){pdf.setFillColor('#F4F7FA');pdf.circle(seal.x,seal.y,seal.radius+.7,'F');}
    drawPdfStamp(pdf,stamp.imageData?stamp:{...stamp,color:gold,accent:gold},seal.x,seal.y,seal.radius);
  }
  block(t.title.toUpperCase(),left,20,bodyWidth,14,19.5,gold,true);
  label('This certificate is awarded to',left,55,10.5,ink);
  block(record.studentName,left,63,bodyWidth,23,32.5,ink,true);
  pdf.setDrawColor(gold);pdf.setLineWidth(.4);pdf.line(left,91,281,91);
  const completion=record.historical?`has completed verified ${record.historical.mode} training in`:'has successfully completed the required learning and assessment in';
  block(completion,left,99,bodyWidth,12,10.5,ink);
  block(record.courseTitle,left,115,bodyWidth,22,21,ink,true);
  const duration=t.durationLabel||assets.duration||defaultCertificateDuration;
  pdf.setFillColor(gold);pdf.rect(left,144,2.2,2.2,'F');block(duration,left+6,140,bodyWidth-6,9,10.5,ink);
  const details=t.detailText||(record.historical?`This credential recognizes the learner's successful training with ${t.issuer} and records the completion of the program.`:'The program develops practical knowledge and professional workflows through structured learning and course activities. This certificate records the learner\'s successful completion.');
  block(details,left,155,bodyWidth,16,9,ink);
  const sig=certificatePage.signature;
  if(t.signatureImage){
    // A small backing beneath only the genuine PNG supports black/blue ink on the navy paper.
    if(await needsLightPdfBackdrop(t.signatureImage)){pdf.setFillColor('#E8DFC9');pdf.roundedRect(sig.x-.8,sig.y-.7,sig.width+1.6,sig.height+1.4,.6,.6,'F');}
    fitPdfImage(pdf,t.signatureImage,sig.x,sig.y,sig.width,sig.height);
  }
  pdf.setDrawColor('#8FA6B9');pdf.setLineWidth(.22);pdf.line(sig.x,186,sig.x+sig.width,186);
  block(t.signer,sig.x,187,118,4,9,ink,true);block(t.signerRole,sig.x,193,118,3.5,7,muted);
  if(assets.qr&&assets.verificationUrl&&record.published&&!record.revokedAt){fitPdfImage(pdf,assets.qr,263,174,18,18);pdf.link(263,174,18,18,{url:assets.verificationUrl});label('Scan to verify',263,196,5.5,muted);}
  else if(record.revokedAt)block('Credential revoked',248,183,33,12,8,'#F2B6AA');
  block(record.id==='DESIGN-PREVIEW'?'Design preview only - not an issued credential':`Issued ${date(record.issuedAt)} | ${brand.supportEmail}`,left,198,165,5,6.5,muted);
  if(record.revokedAt){pdf.setTextColor('#F2B6AA');pdf.setFont('helvetica','bold');pdf.setFontSize(40);pdf.text('REVOKED',198,87,{align:'center'});}
  return pdf;
}
