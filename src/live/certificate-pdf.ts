import { installPdfFonts } from './pdf-fonts.js';
import { drawPdfBrand,fitPdfImage } from './pdf-image.js';
import type { CertificateRecord } from './academy-types.js';
import type { Branding } from './branding-types.js';
import { defaultDocumentStamp,type DocumentStamp } from './document-types.js';
import { drawPdfStamp } from './pdf-stamp.js';

export const certificateLayoutVersion = 'pbs-light-paper-2026-11';
export const defaultCertificateDuration = '6 months of training';
export const certificatePage={width:297,height:210,logo:{x:22,y:18,width:24,height:24},stamp:{x:183,y:174,radius:12.5},signature:{x:24,y:163,width:64,height:11}};
export async function buildCertificatePdf(record:CertificateRecord,brand:Branding,assets:{logo?:string;qr?:string;verificationUrl?:string;fonts?:string[];duration?:string}={},stamp:DocumentStamp=defaultDocumentStamp(brand)) {
  const {jsPDF}=await import('jspdf'),pdf=new jsPDF({orientation:'landscape',format:'a4',unit:'mm',compress:true,putOnlyUsedFonts:true});
  await installPdfFonts(pdf,assets.fonts);
  const t=record.template,ink='#16344D',muted='#536A7B',paper=t.design==='classic'?'#F8F6EF':'#F4F7FA',gold=t.accentColor,blue=t.primaryColor,left=22,bodyWidth=253;
  const clean=(value:string)=>value.replace(/[–—]/g,'-').replace(/₹/g,'INR ');
  const tint=(hex:string,white:number)=>'#'+[1,3,5].map(index=>Math.round(parseInt(hex.slice(index,index+2),16)*(1-white)+255*white).toString(16).padStart(2,'0')).join('');
  function block(value:string,x:number,y:number,width:number,height:number,size:number,color=ink,bold=false,family='helvetica',align:'left'|'center'|'right'='left') {
    pdf.setFont(family,bold?'bold':'normal');pdf.setTextColor(color);let lines:string[]=[];
    do{pdf.setFontSize(size);lines=pdf.splitTextToSize(clean(value),width);if(lines.length*size*.35278*1.17<=height)break;size-=.5;}while(size>5);
    pdf.text(lines,x,y+size*.35278,{align,lineHeightFactor:1.17});
  }
  const label=(value:string,x:number,y:number,size=8,color=muted,bold=false)=>{pdf.setFont('helvetica',bold?'bold':'normal');pdf.setFontSize(size);pdf.setTextColor(color);pdf.text(clean(value),x,y);};
  const date=(value:string)=>new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeZone:'Asia/Kolkata'}).format(new Date(value));
  pdf.setProperties({title:`${t.title} - ${record.studentName}`,subject:record.courseTitle,author:t.issuer,creator:brand.academyName});
  pdf.setFillColor(paper);pdf.rect(0,0,297,210,'F');
  pdf.setFillColor(tint(blue,.93));pdf.rect(0,0,9,210,'F');pdf.setFillColor(tint(gold,.84));pdf.rect(9,0,1,210,'F');
  pdf.setDrawColor(t.design==='classic'?tint(gold,.42):tint(blue,.78));pdf.setLineWidth(t.design==='classic'?.3:.2);pdf.rect(13,11,271,194);
  pdf.setDrawColor(gold);pdf.setLineWidth(.45);pdf.line(13,11,45,11);pdf.line(13,11,13,32);pdf.line(253,205,284,205);pdf.line(284,184,284,205);
  if(t.design!=='minimal') {
    // Faint floor-plan / elevation lines stay behind the paper, never the text hierarchy.
    pdf.setDrawColor(tint(blue,.89));pdf.setLineWidth(.18);
    pdf.rect(225,90,48,50);pdf.line(237,90,237,140);pdf.line(253,90,253,140);pdf.line(225,106,273,106);pdf.line(225,123,273,123);
    pdf.line(221,86,277,86);pdf.line(221,144,277,144);pdf.line(221,86,221,144);pdf.line(277,86,277,144);
    for(let n=0;n<5;n++)pdf.line(257,126+n*2.4,269,126+n*2.4);
    pdf.setDrawColor(tint(gold,.78));pdf.line(231,96,247,96);pdf.line(247,96,247,118);pdf.line(231,118,247,118);
    pdf.setDrawColor(tint(blue,.88));for(let n=0;n<4;n++){pdf.line(17+n*3,47,17+n*3,82);pdf.line(17,47+n*9,29,47+n*9);}
  }
  const logo=certificatePage.logo;drawPdfBrand(pdf,logo.x,logo.y,logo.width,logo.height,t.logoImage||assets.logo);
  block(t.issuer,53,20,174,9,13,ink,true);block(brand.tagline||'BIM learning & professional practice',53,33,174,7,8,muted);
  pdf.setDrawColor(tint(gold,.3));pdf.setLineWidth(.35);pdf.line(left,47,275,47);
  block(t.title,left,52,bodyWidth,17,28,ink,false,'times');
  block(record.courseTitle,left,75,bodyWidth,17,20,blue,true);
  label('This certificate is awarded to',left,100,9,muted);
  block(record.studentName,left,104,bodyWidth,17,30,ink,false,'times');
  const duration=t.durationLabel||assets.duration||defaultCertificateDuration;
  const completion=record.historical?`has completed verified ${record.historical.mode} training in the course named above.`:'has successfully completed the required course lessons and assessment.';
  block(completion,left,127,bodyWidth,8,9.5,ink);
  block(duration,left,138,bodyWidth,7,11,blue,true);
  const details=t.detailText||(record.historical?`This credential recognizes the learner's successful training with ${t.issuer} and records the completion of the program.`:'The program develops practical knowledge and professional workflows through structured learning and course activities. This certificate records the learner\'s successful completion.');
  block(details,left,147,bodyWidth,9,8.5,muted);
  // Signature, seal and verification share the same pale paper; there is no card or white strip.
  pdf.setDrawColor(tint(gold,.55));pdf.setLineWidth(.2);pdf.line(left,159,275,159);
  const sig=certificatePage.signature;if(t.signatureImage)fitPdfImage(pdf,t.signatureImage,sig.x,sig.y,sig.width,sig.height);
  pdf.setDrawColor(tint(blue,.65));pdf.line(sig.x,176,sig.x+sig.width,176);
  block(t.signer,sig.x,179,108,4,8.5,ink,true);block(t.signerRole,sig.x,185,108,4,7,muted);
  drawPdfStamp(pdf,stamp,certificatePage.stamp.x,certificatePage.stamp.y,certificatePage.stamp.radius);
  if(assets.qr&&assets.verificationUrl&&record.published&&!record.revokedAt){fitPdfImage(pdf,assets.qr,252,165,19,19);pdf.link(252,165,19,19,{url:assets.verificationUrl});label('Scan to verify',251,189,6,muted);}
  else{label(record.revokedAt?'Credential revoked':'Credential enquiries',228,171,7,muted);block(brand.supportEmail,228,175,47,11,7,blue);if(!record.revokedAt)pdf.link(228,174,47,12,{url:`mailto:${brand.supportEmail}`});}
  label('Credential reference',left,194,6.5,muted);block(record.historical?.originalNumber?`${record.historical.originalNumber}\n${record.id}`:record.id,left,196,120,9,7,ink,true);
  label(record.historical?'Training completed':'Certificate issued',153,194,6.5,muted);block(date(record.historical?record.historical.completedAt+'T12:00:00Z':record.issuedAt),153,196,51,8,8,ink,true);
  const scoreAvailable=!record.historical||record.historical.scoreRecorded;
  label(scoreAvailable?'Assessment score':'Training record',228,194,6.5,muted);block(scoreAvailable?`${record.score}%`:`Verified ${record.historical!.mode} completion`,228,196,47,8,7,ink,true);
  label(record.id==='DESIGN-PREVIEW'?'Design preview only - not an issued credential':`Issued ${date(record.issuedAt)} | ${brand.supportEmail}`,left,208,6,muted);
  if(record.revokedAt){pdf.setTextColor('#A44237');pdf.setFont('helvetica','bold');pdf.setFontSize(43);pdf.text('REVOKED',148.5,119,{align:'center'});}
  return pdf;
}
