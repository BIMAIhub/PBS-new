import { installPdfFonts } from './pdf-fonts.js';
import { drawPdfBrand,fitPdfImage } from './pdf-image.js';
import type { CertificateRecord } from './academy-types.js';
import type { Branding } from './branding-types.js';
import { defaultDocumentStamp,type DocumentStamp } from './document-types.js';
import { drawPdfStamp } from './pdf-stamp.js';

export const certificateLayoutVersion = 'pbs-side-band-2026-11';
export const certificatePage={width:297,height:210,logo:{x:11,y:20,width:32,height:28},stamp:{x:214,y:168,radius:12.5},signature:{x:84,y:154,width:62,height:11}};
export async function buildCertificatePdf(record:CertificateRecord,brand:Branding,assets:{logo?:string;qr?:string;verificationUrl?:string;fonts?:string[];duration?:string}={},stamp:DocumentStamp=defaultDocumentStamp(brand)) {
  const {jsPDF}=await import('jspdf'),pdf=new jsPDF({orientation:'landscape',format:'a4',unit:'mm',compress:true,putOnlyUsedFonts:true});
  await installPdfFonts(pdf,assets.fonts);
  const t=record.template,navy='#0A2845',paper='#F4F7FA',gold=t.accentColor,blue=t.primaryColor,light=t.design==='minimal';
  const ink=light?navy:paper,muted=light?'#536A7B':'#BED0DF',left=75,bodyWidth=204;
  const clean=(value:string)=>value.replace(/[–—]/g,'-').replace(/₹/g,'INR ');
  function block(value:string,x:number,y:number,width:number,height:number,size:number,color=ink,bold=false,align:'left'|'center'|'right'='left') {
    pdf.setFont('helvetica',bold?'bold':'normal');pdf.setTextColor(color);let lines:string[]=[];
    do{pdf.setFontSize(size);lines=pdf.splitTextToSize(clean(value),width);if(lines.length*size*.35278*1.17<=height)break;size-=.5;}while(size>5);
    pdf.text(lines,x,y+size*.35278,{align,lineHeightFactor:1.17});
  }
  const label=(value:string,x:number,y:number,size=8,color=muted,bold=false)=>{pdf.setFont('helvetica',bold?'bold':'normal');pdf.setFontSize(size);pdf.setTextColor(color);pdf.text(clean(value),x,y);};
  const date=(value:string)=>new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeZone:'Asia/Kolkata'}).format(new Date(value));
  pdf.setProperties({title:`${t.title} - ${record.studentName}`,subject:record.courseTitle,author:t.issuer,creator:brand.academyName});
  pdf.setFillColor(light?paper:navy);pdf.rect(0,0,297,210,'F');
  pdf.setFillColor(blue);pdf.rect(0,0,54,210,'F');pdf.setFillColor(gold);pdf.rect(54,0,1.3,210,'F');
  if(t.design==='classic'){pdf.setDrawColor(gold);pdf.setLineWidth(.22);pdf.rect(64,9,224,192);}
  const logo=certificatePage.logo;drawPdfBrand(pdf,logo.x,logo.y,logo.width,logo.height,t.logoImage||assets.logo);
  block(t.issuer,27,57,38,22,9,paper,true,'center');
  // A quiet construction-line detail belongs to BIM without borrowing the reference's emblem.
  pdf.setDrawColor(gold);pdf.setLineWidth(.3);pdf.rect(12,97,29,30);pdf.line(12,107,41,107);pdf.line(22,97,22,127);pdf.line(12,127,41,97);pdf.line(16,131,45,102);
  label('Learn',12,162,9,paper,true);label('Innovate',12,173,9,paper,true);label('Succeed',12,184,9,paper,true);pdf.setDrawColor(gold);pdf.line(12,149,29,149);
  block(t.title,left,15,bodyWidth,9,10,light?blue:gold,true);
  block(brand.tagline||'BIM learning & professional practice',left,29,bodyWidth,8,8.5,muted);
  block(record.courseTitle,left,45,bodyWidth,32,28,ink,true);
  label('Awarded to',left,90,9,muted);
  block(record.studentName,left,95,bodyWidth,18,27,ink,true);
  const completion=record.historical?`has completed verified ${record.historical.mode} training in the program named above.`:'has completed the required learning and assessment in the program named above.';
  block(completion,left,117,bodyWidth,10,10,muted);
  const details=t.detailText||(record.historical?`This credential records verified course completion issued by ${t.issuer}.`:'The learner completed the prescribed lessons and passed the course assessment. This credential recognizes that achievement in professional learning.');
  block(details,left,131,bodyWidth,13,9,muted);
  // One signatory only. A light panel keeps genuine black/blue signature PNGs legible.
  pdf.setFillColor('#F4F7FA');pdf.rect(left,150,bodyWidth,35,'F');pdf.setFillColor(gold);pdf.rect(left,150,1,35,'F');
  const sig=certificatePage.signature;if(t.signatureImage)fitPdfImage(pdf,t.signatureImage,sig.x,sig.y,sig.width,sig.height);
  pdf.setDrawColor('#C9D3DC');pdf.setLineWidth(.2);pdf.line(sig.x,167,sig.x+sig.width,167);
  block(t.signer,sig.x,170,105,4,9,navy,true);block(t.signerRole,sig.x,177,105,4,7,'#536A7B');
  drawPdfStamp(pdf,stamp,certificatePage.stamp.x,certificatePage.stamp.y,certificatePage.stamp.radius);
  if(assets.qr&&assets.verificationUrl&&record.published&&!record.revokedAt){fitPdfImage(pdf,assets.qr,251,155,19,19);pdf.link(251,155,19,19,{url:assets.verificationUrl});label('Scan to verify',250,180,6,'#536A7B');}
  else block(record.revokedAt?'Credential revoked':'Institution record\nPublic verification is private',245,159,29,20,7,'#536A7B');
  label('Credential reference',left,191,6.5);block(record.historical?.originalNumber?`${record.historical.originalNumber}\n${record.id}`:record.id,left,192,88,9,7,ink,true);
  label(record.historical?'Training completed':'Certificate issued',170,191,6.5);block(date(record.historical?record.historical.completedAt+'T12:00:00Z':record.issuedAt),170,192,48,8,8,ink,true);
  const duration=t.durationLabel||assets.duration||'',scoreAvailable=!record.historical||record.historical.scoreRecorded;
  label(duration?'Program duration':scoreAvailable?'Assessment score':'Training record',228,191,6.5);
  block(duration||(scoreAvailable?`${record.score}%`:`Verified ${record.historical!.mode} completion`),228,192,51,9,7,ink,true);
  label(record.id==='DESIGN-PREVIEW'?'Design preview only - not an issued credential':`Issued ${date(record.issuedAt)} | ${brand.supportEmail}`,left,206,6.5,muted);
  if(record.revokedAt){pdf.setTextColor('#BC4A40');pdf.setFont('helvetica','bold');pdf.setFontSize(43);pdf.text('REVOKED',177,110,{align:'center'});}
  return pdf;
}
