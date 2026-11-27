import { drawPdfBrand,fitPdfImage } from './pdf-image.js';
import { installPdfFonts } from './pdf-fonts.js';
import type { CourseBrochure } from './education-types.js';
import type { DocumentStamp } from './document-types.js';
import { drawPdfStamp } from './pdf-stamp.js';

export async function buildBrochurePdf(course:CourseBrochure,origin:string,stamp:DocumentStamp,logo?:string) {
  const {jsPDF}=await import('jspdf'),pdf=new jsPDF({unit:'mm',format:'a4',orientation:'portrait',compress:true,putOnlyUsedFonts:true});
  await installPdfFonts(pdf);
  const brand=course.brand,navy='#0A2845',paper='#F4F7FA',blue=brand.primaryColor,gold=brand.accentColor,margin=20,width=170,bottom=247;
  const url=`${origin}/courses/${encodeURIComponent(course.id)}`,lessonCount=course.modules.reduce((sum,module)=>sum+module.lessons.length,0);let y=0;
  const clean=(value:string)=>value.replace(/₹/g,'INR ').replace(/[–—•]/g,'-');
  const date=(value:string)=>new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeZone:'Asia/Kolkata'}).format(new Date(value));
  const amount=(value:number)=>`INR ${(value/100).toLocaleString('en-IN',{maximumFractionDigits:2})}`;
  function label(value:string,x:number,at:number,size:number,color:string,bold=false){pdf.setFont('helvetica',bold?'bold':'normal');pdf.setFontSize(size);pdf.setTextColor(color);pdf.text(clean(value),x,at);}
  function fitted(value:string,x:number,top:number,w:number,h:number,size:number,color:string,bold=false){
    pdf.setFont('helvetica',bold?'bold':'normal');pdf.setTextColor(color);let lines:string[]=[];
    do{pdf.setFontSize(size);lines=pdf.splitTextToSize(clean(value),w);if(lines.length*size*.35278*1.2<=h)break;size-=.5;}while(size>6);
    pdf.text(lines,x,top+size*.35278,{lineHeightFactor:1.2});
  }
  function base(){pdf.setFillColor(paper);pdf.rect(0,0,210,297,'F');pdf.setFillColor(blue);pdf.rect(0,0,5,297,'F');}
  function header(){
    base();pdf.setFillColor(navy);pdf.rect(5,0,205,37,'F');drawPdfBrand(pdf,margin,7,25,22,logo);
    fitted(brand.academyName,52,9,138,10,12,paper,true);fitted(course.title,52,22,138,10,8,'#BED0DF');pdf.setFillColor(gold);pdf.rect(margin,37,29,1,'F');y=50;
  }
  function cover(){
    base();pdf.setFillColor(navy);pdf.rect(5,0,205,125,'F');pdf.setFillColor(blue);pdf.rect(5,0,9,125,'F');pdf.setFillColor(gold);pdf.rect(14,0,1,125,'F');
    drawPdfBrand(pdf,margin,13,27,25,logo);fitted(brand.academyName,55,16,135,11,14,paper,true);fitted(brand.tagline,55,32,135,9,8,'#BED0DF');
    label(course.category||'Professional learning',margin,53,9,gold,true);fitted(course.title,margin,62,width,42,27,paper,true);
    label(`${course.modules.length} modules  |  ${lessonCount} lessons`,margin,115,9,'#BED0DF');y=140;
  }
  function ensure(height:number){if(y+height>bottom){pdf.addPage();header();}}
  function write(value:string,size=10,bold=false,color='#304D63',indent=0){
    if(!value)return;pdf.setFont('helvetica',bold?'bold':'normal');pdf.setFontSize(size);
    const lines=pdf.splitTextToSize(clean(value),width-indent) as string[],leading=size*.35278*1.35;
    for(const line of lines){ensure(leading);label(line,margin+indent,y,size,color,bold);y+=leading;}y+=3;
  }
  function section(value:string){ensure(28);y+=7;pdf.setDrawColor(gold);pdf.setLineWidth(.6);pdf.line(margin,y-7,margin+10,y-7);write(value,15,true,blue);y+=1;}
  function facts(){
    const entries=[['Level',course.page.level||'See course details'],['Learning format',course.page.duration||course.schedule||'See the course page'],['Course content',`${course.modules.length} modules\n${lessonCount} lessons`]];
    pdf.setFont('helvetica','bold');pdf.setFontSize(9);const cell=width/3,lines=entries.map(([,v])=>pdf.splitTextToSize(clean(v),cell-8) as string[]),height=Math.max(...lines.map(v=>v.length))*4+15;
    ensure(height);pdf.setFillColor('#E6EDF3');pdf.rect(margin,y-4,width,height,'F');
    entries.forEach(([name],index)=>{const x=margin+index*cell+4;label(name,x,y+2,7,'#536A7B');lines[index].forEach((line,n)=>label(line,x,y+9+n*4,9,navy,true));});y+=height+5;
  }
  function fee(){
    pdf.setFont('helvetica','normal');pdf.setFontSize(8);const offer=course.price.discount?`Regular fee ${amount(course.fee)} | ${course.price.promotionTitle} | Save ${amount(course.price.discount)}`:'Confirm current availability before applying.';
    const lines=pdf.splitTextToSize(clean(offer),width-12) as string[],height=30+lines.length*3.8;
    ensure(height+5);pdf.setFillColor('#EEE3C8');pdf.rect(margin,y-3,width,height,'F');pdf.setFillColor(gold);pdf.rect(margin,y-3,1,height,'F');
    label('Course fee',margin+6,y+4,8,'#536A7B');label(amount(course.price.total),margin+6,y+17,21,blue,true);lines.forEach((line,i)=>label(line,margin+6,y+25+i*3.8,8,'#304D63'));y+=height+7;
  }
  cover();facts();fee();section('Course overview');write(course.description,10);
  section('Your learning plan');if(course.page.audience)write(course.page.audience,10);
  for(const item of course.page.outcomes)write(`- ${item}`,10,false,'#304D63',2);
  if(course.instructor)write(`Instructor: ${course.instructor}`,9,true,blue);
  if(course.batches.length){section('Upcoming batches');for(const batch of course.batches){ensure(24);write(batch.name,11,true,blue);write(`Starts ${date(batch.startsAt)} | Apply by ${date(batch.deadline)}\n${batch.seatsLeft} places available at the time of this request.`,9);}}
  if(course.page.requirements.length){section('Before you begin');for(const item of course.page.requirements)write(`- ${item}`,9,false,'#304D63',2);}
  section('Course curriculum');
  for(const [index,module] of course.modules.entries()){
    ensure(34);write(`${String(index+1).padStart(2,'0')}  ${module.title}`,12,true,blue);
    if(module.summary)write(module.summary,10);for(const item of module.objectives)write(`- ${item}`,9,false,'#304D63',2);
    for(const [n,lesson] of module.lessons.entries())write(`${String(n+1).padStart(2,'0')}  ${lesson.title}${lesson.duration?` (${lesson.duration})`:''}`,9,false,'#304D63',4);
    y+=2;
  }
  section('Start your learning with PBS');write('Open the course page to check the current fee, available batches and enrollment details. PBS reviews enrollment and payment information before granting course access.',10);
  write(`Questions? ${brand.supportEmail}`,10,true,blue);
  write('Fees, offers and seat availability reflect the brochure request date. Published lessons and live-session schedules appear in the student workspace.',8);
  const qr=await(await import('qrcode')).toDataURL(url,{margin:1,width:180,errorCorrectionLevel:'M'}),pages=pdf.getNumberOfPages();
  for(let i=1;i<=pages;i++){
    pdf.setPage(i);drawPdfStamp(pdf,stamp,177,268,12.5);
    if(i===pages){fitPdfImage(pdf,qr,margin,258,18,18);pdf.link(margin,258,18,18,{url});label('Explore this course',margin+24,264,9,blue,true);label('Scan or tap to view current details',margin+24,271,7,'#536A7B');pdf.link(margin+24,259,99,16,{url});}
    else{label('Practical BIM learning',margin,265,8,navy,true);label('Learn - Innovate - Succeed',margin,271,7,'#536A7B');}
    pdf.setDrawColor(gold);pdf.setLineWidth(.3);pdf.line(margin,284,190,284);label(brand.supportEmail,margin,290,7,'#536A7B');label(`${i} / ${pages}`,180,290,7,'#536A7B');
  }
  pdf.setProperties({title:`${course.title} - Course brochure`,author:brand.academyName,creator:brand.academyName});return pdf;
}
