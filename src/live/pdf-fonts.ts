import type { jsPDF } from 'jspdf';

let fonts:Promise<string[]>|undefined;
const sources=()=>[
  new URL('../assets/pdf-fonts/LiberationSans-Regular.ttf',import.meta.url),
  new URL('../assets/pdf-fonts/LiberationSans-Bold.ttf',import.meta.url),
  new URL('../assets/pdf-fonts/LiberationSerif-Regular.ttf',import.meta.url),
  new URL('../assets/pdf-fonts/LiberationSerif-Italic.ttf',import.meta.url),
];
async function fontData(url:URL) {
  const bytes=url.protocol==='file:'?new Uint8Array(await (await import('node:fs/promises')).readFile(url)):await fetch(url).then(async response=>{if(!response.ok)throw new Error('The document fonts could not be loaded. Check your connection and try again.');return new Uint8Array(await response.arrayBuffer());});
  let data='';for(let i=0;i<bytes.length;i+=8192)data+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(data);
}
// Embed the same glyphs and metrics in the PDF; viewer substitutions must not change its layout.
export async function installPdfFonts(pdf:jsPDF,supplied?:string[]) {
  if(!supplied)fonts??=Promise.all(sources().map(fontData)).catch(error=>{fonts=undefined;throw error;});
  const data=supplied||await fonts;
  const styles=[['helvetica','normal'],['helvetica','bold'],['times','normal'],['times','italic']] as const;
  for(const [index,[family,style]] of styles.entries()) {const filename=`Liberation-${family}-${style}.ttf`;pdf.addFileToVFS(filename,data[index]);pdf.addFont(filename,family,style);}
}
