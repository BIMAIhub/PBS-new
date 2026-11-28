import {randomBytes} from 'node:crypto';

const line=(value:string)=>value.replace(/[\r\n]/g,' ');
const encoded=(value:string)=>{
  const words:string[]=[];let current='';
  for(const character of line(value)){if(Buffer.byteLength(current+character)>39){words.push('=?UTF-8?B?'+Buffer.from(current).toString('base64')+'?=');current='';}current+=character;}
  if(current)words.push('=?UTF-8?B?'+Buffer.from(current).toString('base64')+'?=');return words.join('\r\n ');
};
const content=(value:string)=>Buffer.from(value,'utf8').toString('base64').match(/.{1,76}/g)?.join('\r\n')||'';
// Standard List-Unsubscribe headers require MIME; Graph JSON custom headers are limited to x-*.
export function marketingMime(options:{from:string;name:string;to:string;subject:string;text:string;html:string;unsubscribeUrl:string}){
  for(const email of [options.from,options.to])if(!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email))throw new Error('Choose a valid mail address.');
  const url=new URL(options.unsubscribeUrl);if(url.protocol!=='https:'||/[\r\n<>]/.test(options.unsubscribeUrl))throw new Error('Choose a secure unsubscribe link.');
  const boundary='pbs_alt_'+randomBytes(18).toString('hex');
  const headers=[`From: ${encoded(options.name)} <${options.from}>`,`To: <${options.to}>`,`Subject: ${encoded(options.subject)}`,`Date: ${new Date().toUTCString()}`,`Message-ID: <${randomBytes(18).toString('hex')}@${options.from.split('@')[1]}>`,'MIME-Version: 1.0',`List-Unsubscribe: <${url.href}>`,'List-Unsubscribe-Post: List-Unsubscribe=One-Click',`Content-Type: multipart/alternative; boundary="${boundary}"`];
  const parts=[['text/plain',options.text],['text/html',options.html]].map(([type,value])=>`--${boundary}\r\nContent-Type: ${type}; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${content(value)}`);
  return Buffer.from(headers.join('\r\n')+'\r\n\r\n'+parts.join('\r\n')+`\r\n--${boundary}--\r\n`,'utf8').toString('base64');
}
