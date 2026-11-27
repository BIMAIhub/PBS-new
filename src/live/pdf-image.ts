import type { jsPDF } from 'jspdf';

export function fitPdfImage(pdf:jsPDF,data:string,x:number,y:number,width:number,height:number) {
  const image=pdf.getImageProperties(data),scale=Math.min(width/image.width,height/image.height),w=image.width*scale,h=image.height*scale;
  pdf.addImage(data,image.fileType,x+(width-w)/2,y+(height-h)/2,w,h,undefined,'FAST');
}
export function drawPdfBrand(pdf:jsPDF,x:number,y:number,width:number,height:number,data?:string) {
  if(data){try{fitPdfImage(pdf,data,x,y,width,height);return;}catch{}}
  const side=Math.min(width,height),left=x+(width-side)/2,top=y+(height-side)/2;
  pdf.saveGraphicsState();pdf.setFillColor('#0A2845');pdf.setDrawColor('#176BB7');pdf.setLineWidth(side/40);pdf.roundedRect(left+side/80,top+side/80,side*78/80,side*78/80,side*19/80,side*19/80,'FD');
  const at=(a:number,b:number)=>[left+a/80*side,top+b/80*side] as [number,number];
  const draw=(points:number[][],close=false)=>{pdf.path(points.map((point,i)=>({op:i?'l':'m',c:at(...point as [number,number])})));if(close)pdf.close();};
  pdf.setFillColor('#176BB7');draw([[20,59],[20,22],[44,22],[58,32],[58,49],[33,49],[33,59]],true);pdf.fill();
  pdf.setDrawColor('#F4F7FA');pdf.setLineWidth(side*5/80);pdf.setLineJoin('miter');draw([[25,60],[25,25],[42,25],[54,33],[54,45],[35,45],[35,60]]);pdf.stroke();
  pdf.setFillColor('#0A2845');pdf.rect(...at(35,34),side*10/80,side*4/80,'F');
  pdf.setDrawColor('#D4A94D');pdf.setLineWidth(side*3/80);draw([[20,16],[46,16],[61,27]]);pdf.stroke();draw([[61,39],[61,59],[45,59]]);pdf.stroke();pdf.setLineWidth(side*2/80);pdf.line(...at(17,65),...at(64,65));pdf.restoreGraphicsState();
}
