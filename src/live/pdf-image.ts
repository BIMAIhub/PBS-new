import type { jsPDF } from 'jspdf';

// Preserve uploaded pixels; choose only whether their displayed ink needs a light backing.
export async function needsLightPdfBackdrop(data:string) {
  try {
    const match=/^data:image\/png;base64,(.+)$/.exec(data);if(!match)return true;
    const {decode}=await import('fast-png'),png=decode(Uint8Array.from(atob(match[1]),value=>value.charCodeAt(0)));
    const count=png.width*png.height,step=Math.max(1,Math.floor(count/4096)),maximum=png.depth===16?65535:255;
    let total=0,weight=0;
    for(let pixel=0;pixel<count;pixel+=step){
      const index=pixel*png.channels,palette=png.palette?.[Number(png.data[index])];
      let r:number,g:number,b:number,alpha=1;
      if(palette){[r,g,b]=palette;if(palette.length>3)alpha=palette[3]/255;r/=255;g/=255;b/=255;}
      else if(png.channels<=2){r=g=b=Number(png.data[index])/maximum;if(png.channels===2)alpha=Number(png.data[index+1])/maximum;}
      else{r=Number(png.data[index])/maximum;g=Number(png.data[index+1])/maximum;b=Number(png.data[index+2])/maximum;if(png.channels===4)alpha=Number(png.data[index+3])/maximum;}
      if(alpha<.08)continue;total+=(.2126*r+.7152*g+.0722*b)*alpha;weight+=alpha;
    }
    return !weight||total/weight<.6;
  }catch{return true;}
}

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

// Render genuine signature strokes in the certificate's ink colour. Stored PNGs stay untouched.
// A white scanner background is removed only when fully opaque.
export async function tintedSignatureInk(data:string,ink:string) {
  if(!/^#[0-9a-f]{6}$/i.test(ink))throw new Error('Choose a valid signature ink colour.');
  const colour=[1,3,5].map(index=>parseInt(ink.slice(index,index+2),16));
  const match=/^data:image\/png;base64,(.+)$/.exec(data);
  if(!match)throw new Error('Choose a PNG signature.');
  const {decode,encode}=await import('fast-png');
  const png=decode(Uint8Array.from(atob(match[1]),value=>value.charCodeAt(0))),count=png.width*png.height;
  if(count>4_000_000)throw new Error('Resize the signature PNG before uploading it.');
  const maximum=png.depth===16?65535:255;
  function pixel(index:number) {
    const offset=index*png.channels,palette=png.palette?.[Number(png.data[offset])];
    if(palette)return [palette[0]/255,palette[1]/255,palette[2]/255,palette.length>3?palette[3]/255:1];
    if(png.channels<=2){const gray=Number(png.data[offset])/maximum;return [gray,gray,gray,png.channels===2?Number(png.data[offset+1])/maximum:1];}
    return [Number(png.data[offset])/maximum,Number(png.data[offset+1])/maximum,Number(png.data[offset+2])/maximum,png.channels===4?Number(png.data[offset+3])/maximum:1];
  }
  let transparent=false;
  for(let i=0;i<count;i++)if(pixel(i)[3]<.99){transparent=true;break;}
  const whitePaper=!transparent&&[0,png.width-1,count-png.width,count-1].every(i=>pixel(i).slice(0,3).every(channel=>channel>.94));
  const output=new Uint8Array(count*4);
  for(let i=0;i<count;i++) {
    const [r,g,b,a]=pixel(i),alpha=whitePaper?a*(1-Math.min(r,g,b)):a;
    output.set([...colour,Math.round(255*alpha)],i*4);
  }
  const bytes=encode({width:png.width,height:png.height,channels:4,depth:8,data:output});
  let encoded='';for(let i=0;i<bytes.length;i+=8192)encoded+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return 'data:image/png;base64,'+btoa(encoded);
}

// Retain the light-ink helper for existing document callers.
export const lightSignatureInk=(data:string)=>tintedSignatureInk(data,'#F4F7FA');
