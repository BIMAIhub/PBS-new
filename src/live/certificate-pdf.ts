import { installPdfFonts } from './pdf-fonts';
import { drawPdfBrand,fitPdfImage } from './pdf-image';
import type { CertificateRecord } from './academy-types';
import type { Branding } from './branding-types';
import { defaultDocumentStamp,type DocumentStamp } from './document-types';
import { drawPdfStamp } from './pdf-stamp';

export const certificatePage={width:297,height:210,logo:{x:23,y:21,width:32,height:22},stamp:{x:148.5,y:184,radius:12},signature:{x:25,y:177,width:61,height:9}};
export async function buildCertificatePdf(record:CertificateRecord,brand:Branding,assets:{logo?:string;qr?:string;verificationUrl?:string;fonts?:string[];duration?:string}={},stamp:DocumentStamp=defaultDocumentStamp(brand)) {
  const {jsPDF}=await import('jspdf'),pdf=new jsPDF({orientation:'landscape',format:'a4',unit:'mm',compress:true,putOnlyUsedFonts:true});
  await installPdfFonts(pdf,assets.fonts);const t=record.template,ink='#142F47',muted='#536A7B',gold=t.accentColor,blue=t.primaryColor;
  const text=(v:string)=>v.replace(/[–—]/g,'-').replace(/₹/g,'INR ');
  function block(value:string,x:number,y:number,width:number,height:number,size:number,align:'left'|'center'|'right'='left') {
    let lines:string[]=[];do{pdf.setFontSize(size);lines=pdf.splitTextToSize(text(value),width);if(lines.length*size*.35278*1.14<=height)break;size-=.5;}while(size>5);
    pdf.text(lines,x,y+size*.35278,{align,lineHeightFactor:1.14});
  }
  const label=(value:string,x:number,y:number,size=8,color=muted,bold=false)=>{pdf.setFont('helvetica',bold?'bold':'normal');pdf.setFontSize(size);pdf.setTextColor(color);pdf.text(text(value),x,y);};
  const date=(v:string)=>new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeZone:'Asia/Kolkata'}).format(new Date(v));
  pdf.setProperties({title:`${t.title} - ${record.studentName}`,subject:record.courseTitle,author:t.issuer,creator:brand.academyName});
  pdf.setFillColor('#F4F7FA');pdf.rect(0,0,297,210,'F');pdf.setFillColor('#F8F5EC');pdf.rect(9,9,279,192,'F');
  pdf.setDrawColor(gold);pdf.setLineWidth(.35);pdf.rect(13,13,271,184);
  if(t.design==='classic'){pdf.setDrawColor(blue);pdf.setLineWidth(.3);pdf.rect(15,15,267,180);}
  pdf.setFillColor(blue);pdf.rect(9,9,279,41,'F');pdf.setFillColor(gold);pdf.rect(9,9,3,192,'F');
  if(t.design==='architectural') {pdf.setDrawColor(gold);pdf.setLineWidth(.24);for(let i=0;i<4;i++){pdf.line(270+i*3,50,270+i*3,59);pdf.line(269,50+i*3,284,50+i*3);} }
  const logo=certificatePage.logo;drawPdfBrand(pdf,logo.x,logo.y,logo.width,logo.height,t.logoImage||assets.logo);
  pdf.setFont('helvetica','bold');pdf.setTextColor('#F4F7FA');block(t.issuer,63,23,207,12,16);
  label(brand.tagline||'BIM learning & professional practice',63,42,8,'#E2EAF2');
  pdf.setFont('times','normal');pdf.setTextColor(blue);block(t.title,148.5,58,244,19,29,'center');
  pdf.setFont('helvetica','normal');pdf.setFontSize(9);pdf.setTextColor(muted);pdf.text('Awarded to',148.5,84,{align:'center'});
  pdf.setFont('times','normal');pdf.setTextColor(ink);block(record.studentName,148.5,90,242,23,31,'center');
  pdf.setDrawColor(gold);pdf.setLineWidth(.35);pdf.line(110,116,187,116);
  pdf.setFont('helvetica','normal');pdf.setTextColor(muted);pdf.setFontSize(9);
  pdf.text(record.historical?`has completed verified ${record.historical.mode} training in`:'has completed the required learning and assessment in',148.5,123,{align:'center'});
  pdf.setFont('helvetica','bold');pdf.setTextColor(blue);block(record.courseTitle,148.5,128,241,16,17,'center');
  const details=t.detailText||`This credential records verified course completion issued by ${t.issuer}.`;
  pdf.setFont('helvetica','normal');pdf.setTextColor(muted);block(details,148.5,147,239,10,9,'center');
  pdf.setDrawColor('#D4C9AB');pdf.setLineWidth(.2);pdf.line(25,158,272,158);
  label('Credential reference',25,163,7,muted);pdf.setFont('helvetica','bold');pdf.setTextColor(ink);
  block(record.historical?.originalNumber?`${record.historical.originalNumber}\n${record.id}`:record.id,25,165,86,9,8);
  label(record.historical?'Training completed':'Certificate issued',120,163,7,muted);label(date(record.historical?record.historical.completedAt+'T12:00:00Z':record.issuedAt),120,170,9,ink,true);
  const duration=t.durationLabel||assets.duration||'',scoreAvailable=!record.historical||record.historical.scoreRecorded;
  label(duration?'Program duration':scoreAvailable?'Assessment score':'Training record',211,163,7,muted);pdf.setFont('helvetica','bold');pdf.setTextColor(ink);
  block(duration||(scoreAvailable?`${record.score}%`:`Verified ${record.historical!.mode} completion`),211,165,61,9,9);
  pdf.setDrawColor('#D4C9AB');pdf.line(25,176,272,176);
  const sig=certificatePage.signature;if(t.signatureImage)fitPdfImage(pdf,t.signatureImage,sig.x,sig.y,sig.width,sig.height);
  pdf.setFont('helvetica','bold');pdf.setTextColor(ink);block(t.signer,25,187,89,4,9);
  pdf.setFont('helvetica','normal');pdf.setTextColor(muted);block(t.signerRole,25,192,90,4,7);
  drawPdfStamp(pdf,stamp,certificatePage.stamp.x,certificatePage.stamp.y,certificatePage.stamp.radius);
  if(assets.qr&&assets.verificationUrl&&record.published&&!record.revokedAt){fitPdfImage(pdf,assets.qr,249,177,18,18);pdf.link(249,177,18,18,{url:assets.verificationUrl});label('Scan to verify',248,196.5,5.5);}
  else{pdf.setFont('helvetica','normal');pdf.setTextColor(muted);block(record.revokedAt?'This credential is revoked.':'Public verification is private. Enable sharing in My certificates.',211,182,61,12,8);}
  label(record.id==='DESIGN-PREVIEW'?'Design preview only - not an issued credential':`Issued ${date(record.issuedAt)} | ${brand.supportEmail}`,25,205,6.5);
  label('Learn - Innovate - Succeed',239,205,6.5);
  if(record.revokedAt){pdf.setTextColor('#A13A34');pdf.setFont('helvetica','bold');pdf.setFontSize(43);pdf.text('REVOKED',148.5,111,{align:'center'});}
  return pdf;
}
