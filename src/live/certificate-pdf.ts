import { installPdfFonts } from './pdf-fonts.js';
import { fitPdfImage,lightSignatureInk } from './pdf-image.js';
import type { jsPDF } from 'jspdf';
import type { CertificateRecord } from './academy-types.js';
import type { Branding } from './branding-types.js';
import type { DocumentStamp } from './document-types.js';

export const certificateLayoutVersion = 'pbs-reference-blueprint-4x3-two-signatures-v1';
export const defaultCertificateDuration = '6 months of training';
// The supplied 2048 × 1536 artwork is 4:3. Its PDF paper is deliberately not A4.
export const certificatePage = {width:280,height:210,aspectRatio:4/3};
const institution = 'Pragmatic BIM Solution';
const unit = (pixels:number) => pixels * certificatePage.width / 2048;
const pointSize = (pixels:number) => unit(pixels) * 72 / 25.4;
let artwork:Promise<string>|undefined;
async function backgroundArtwork() {
  artwork ??= (async()=>{
    // Lazy URL evaluation also permits native Node initialization of the deployed renderer.
    const url=new URL('../assets/certificate-art/pbs-certificate-blueprint.jpg',import.meta.url);
    const bytes=url.protocol==='file:'?new Uint8Array(await (await import('node:fs/promises')).readFile(url)):await fetch(url).then(async response=>{
      if(!response.ok)throw new Error('The certificate artwork could not be loaded. Refresh and try again.');
      return new Uint8Array(await response.arrayBuffer());
    });
    let encoded='';for(let i=0;i<bytes.length;i+=8192)encoded+=String.fromCharCode(...bytes.subarray(i,i+8192));
    return 'data:image/jpeg;base64,'+btoa(encoded);
  })().catch(error=>{artwork=undefined;throw error;});
  return artwork;
}
type CertificateAssets = {logo?:string;qr?:string;verificationUrl?:string;fonts?:string[];duration?:string;background?:string};

export async function buildCertificatePdf(record:CertificateRecord,brand:Branding,assets:CertificateAssets={},_stamp?:DocumentStamp) {
  const {jsPDF}=await import('jspdf');
  const pdf=new jsPDF({orientation:'landscape',format:[certificatePage.width,certificatePage.height],unit:'mm',compress:true,putOnlyUsedFonts:true});
  await installPdfFonts(pdf,assets.fonts);
  pdf.addImage(assets.background||await backgroundArtwork(),'JPEG',0,0,certificatePage.width,certificatePage.height);
  const t=record.template,ink='#F4F7FA',muted='#BACBD9';
  const clean=(value:string)=>value.replace(/₹/g,'INR ');
  function block(value:string,x:number,y:number,width:number,height:number,pixels:number,bold=false,color=ink) {
    if(!value)return;
    pdf.setFont('pbs-sans',bold?'bold':'normal');pdf.setTextColor(color);
    let lines:string[]=[];
    do {
      pdf.setFontSize(pointSize(pixels));lines=pdf.splitTextToSize(clean(value),unit(width));
      if(pixels*(.99+Math.max(0,lines.length-1)*1.15)<=height)break;
      pixels-=1;
    } while(pixels>14);
    pdf.text(lines,unit(x),unit(y+pixels*.79),{lineHeightFactor:1.15});
    return pixels*(.99+Math.max(0,lines.length-1)*1.15);
  }
  function searchable(value:string,x:number,y:number,pixels:number) {
    pdf.setFont('pbs-sans','normal');pdf.setFontSize(pointSize(pixels));
    pdf.text(value,unit(x),unit(y),{renderingMode:'invisible'});
  }
  const date=(value:string)=>new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeZone:'Asia/Kolkata'}).format(new Date(value));
  pdf.setProperties({title:`Certificate of completion - ${record.studentName}`,subject:record.courseTitle,author:institution,creator:institution});
  // Searchable equivalents for the fixed lettering in the reference artwork.
  searchable(institution,248,175,36);
  searchable('CERTIFICATE OF COMPLETION',790,203,50);
  searchable('This certificate is awarded to',790,389,40);
  searchable('CREDENTIAL REFERENCE',128,507,28);
  searchable('TRAINING COMPLETED',128,633,28);
  searchable('TRAINING RECORD',128,762,28);
  searchable('PBS AUTHORIZED RECORD',252,1150,22);

  const reference=record.historical?.originalNumber?`${record.historical.originalNumber}\n${record.id}`:record.id;
  block(reference,128,528,525,69,32,true);
  block(date(record.historical?record.historical.completedAt+'T12:00:00Z':record.issuedAt),128,655,525,46,32,true);
  const scoreAvailable=!record.historical||record.historical.scoreRecorded;
  block(scoreAvailable?`Assessment score: ${record.score}%`:`Verified ${record.historical!.mode} completion`,128,781,525,76,32,true);
  block(record.studentName,790,445,1120,100,100,true);
  const completion=record.historical?`has completed verified ${record.historical.mode} training in`:'has completed the required learning and assessment in';
  block(completion,790,637,1120,64,40);
  block(record.courseTitle,790,726,1120,94,62,true);
  block(t.durationLabel||assets.duration||defaultCertificateDuration,832,838,1080,58,40);
  const details=t.detailText||`This credential recognizes the learner's successful training with ${institution} and records the completion of the program.`;
  block(details,790,934,1115,92,32);

  const signatories=[
    {x:790,name:t.signer||'Academic Director',role:t.signerRole||'Authorized signatory',image:t.signatureImage},
    {x:1305,name:t.secondSigner||'Authorized signatory',role:t.secondSignerRole||institution,image:t.secondSignatureImage},
  ];
  for(const signer of signatories) {
    if(signer.image)fitPdfImage(pdf,await lightSignatureInk(signer.image),unit(signer.x),unit(1116),unit(333),unit(86));
    const nameHeight=block(signer.name,signer.x,1235,440,62,32,true)||0;
    block(signer.role,signer.x,Math.max(1275,1241+nameHeight),440,51,26,false,muted);
  }
  if(assets.qr&&assets.verificationUrl&&record.published&&!record.revokedAt) {
    fitPdfImage(pdf,assets.qr,unit(1858),unit(1348),unit(102),unit(102));
    pdf.link(unit(1858),unit(1348),unit(102),unit(102),{url:assets.verificationUrl});
    block('Scan to verify',1685,1423,165,31,27,false,muted);
  } else if(record.revokedAt)block('Credential revoked',1670,1395,270,58,29,true,'#F2B6AA');
  block(record.id==='DESIGN-PREVIEW'?'Design preview only — not an issued credential':`Issued ${date(record.issuedAt)}  |  ${brand.supportEmail}`,790,1423,860,35,28,false,muted);
  if(record.revokedAt) {
    pdf.setTextColor('#F2B6AA');pdf.setFont('pbs-sans','bold');pdf.setFontSize(40);
    pdf.text('REVOKED',unit(1360),unit(1090),{align:'center'});
  }
  return pdf;
}
