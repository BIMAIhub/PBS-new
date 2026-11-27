import { installPdfFonts } from './pdf-fonts';
import type { CourseBrochure } from './education-types';
import type { DocumentStamp } from './document-types';
import { drawPdfStamp } from './pdf-stamp';

export async function buildBrochurePdf(course:CourseBrochure,origin:string,stamp:DocumentStamp,logo?:string) {
  const {jsPDF}=await import('jspdf'),pdf=new jsPDF({unit:'mm',format:'a4',compress:true,putOnlyUsedFonts:true});
  await installPdfFonts(pdf);
  const brand=course.brand,margin=17,width=176,bottom=249;let y=0;
  const clean=(s:string)=>s.replace(/₹/g,'INR ').replace(/[–—•]/g,'-');
  function header(){
    pdf.setFillColor('#F4F7FA');pdf.rect(0,0,210,297,'F');pdf.setFillColor(brand.primaryColor);pdf.rect(0,0,210,38,'F');
    let left=margin;if(logo){try{pdf.addImage(logo,'PNG',margin,9,18,18);left+=24;}catch{}}
    pdf.setFont('helvetica','bold');pdf.setFontSize(14);pdf.setTextColor('#F4F7FA');pdf.text(pdf.splitTextToSize(clean(brand.academyName),193-left),left,16);
    pdf.setFont('helvetica','normal');pdf.setFontSize(8);pdf.text('COURSE BROCHURE  |  LEARN - INNOVATE - SUCCEED',left,31);
    pdf.setFillColor(brand.accentColor);pdf.rect(margin,38,28,1.2,'F');y=49;
  }
  function ensure(h:number){if(y+h>bottom){pdf.addPage();header();}}
  function write(value:string,size=10,bold=false,color='#274257'){
    pdf.setFont('helvetica',bold?'bold':'normal');pdf.setFontSize(size);pdf.setTextColor(color);
    const lines=pdf.splitTextToSize(clean(value),width) as string[],leading=size*.35278*1.35;
    for(const line of lines){ensure(leading);pdf.text(line,margin,y);y+=leading;}y+=3;
  }
  function section(value:string){ensure(17);y+=3;write(value,14,true,brand.primaryColor);}
  const amount=(v:number)=>`INR ${(v/100).toLocaleString('en-IN',{maximumFractionDigits:2})}`;
  const date=(v:string)=>new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeZone:'Asia/Kolkata'}).format(new Date(v));
  header();write(course.category.toUpperCase(),8,true,brand.primaryColor);write(course.title,23,true,brand.primaryColor);write(course.description,11);
  write([course.page.level,course.page.duration,`${course.modules.length} modules`].filter(Boolean).join(' | '),9);
  section('Your learning plan');if(course.page.audience)write(course.page.audience);
  for(const item of course.page.outcomes)write(`- ${item}`);
  section('Course fee');write(amount(course.price.total),20,true,brand.primaryColor);
  if(course.price.discount)write(`Regular fee ${amount(course.fee)} | ${course.price.promotionTitle} | Save ${amount(course.price.discount)}`,10);
  write('The fee and any offer shown reflect the brochure request date. Confirm the current price and available batch before applying.',8);
  if(course.batches.length){section('Upcoming batches');for(const b of course.batches)write(`${b.name}\nStarts ${date(b.startsAt)} | Apply by ${date(b.deadline)} | ${b.seatsLeft} places available`);}
  if(course.page.requirements.length){section('Before you begin');for(const item of course.page.requirements)write(`- ${item}`);}
  section('Curriculum');for(const [i,module] of course.modules.entries()){
    ensure(20);write(`${String(i+1).padStart(2,'0')}  ${module.title}`,12,true,brand.primaryColor);
    if(module.summary)write(module.summary,10);for(const item of module.objectives)write(`- ${item}`,9);
    for(const [n,lesson] of module.lessons.entries())write(`  ${n+1}. ${lesson.title}${lesson.duration?` (${lesson.duration})`:''}`,9);
  }
  section('Ready to learn with PBS?');const url=`${origin}/courses/${encodeURIComponent(course.id)}`;write(url,10,true,brand.primaryColor);write(`Questions? ${brand.supportEmail}`,10);
  write('Apply through the course page. PBS reviews enrollment and payment details before granting access. Published lesson and live-session schedules appear in your student workspace.',9);
  pdf.setProperties({title:`${course.title} - Course brochure`,author:brand.academyName,creator:brand.academyName});
  const pages=pdf.getNumberOfPages();for(let i=1;i<=pages;i++){pdf.setPage(i);drawPdfStamp(pdf,stamp,180,270,10);pdf.setDrawColor(brand.accentColor);pdf.line(margin,283,193,283);pdf.setFont('helvetica','normal');pdf.setFontSize(7);pdf.setTextColor('#53687A');pdf.text(clean(brand.supportEmail),margin,289);pdf.text(`${i} / ${pages}`,193,289,{align:'right'});}
  return pdf;
}
