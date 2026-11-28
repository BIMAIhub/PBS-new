import {Resolver} from 'node:dns/promises';
import {domainToASCII} from 'node:url';

type RecordCheck={status:'ready'|'review'|'missing'|'unavailable';records:string[];note:string};
export type MailDomainReport={domain:string;checkedAt:string;spf:RecordCheck;dkim:RecordCheck;dmarc:RecordCheck;mx:RecordCheck;nameservers:string[];dnsHost:string;note:string};
export type MailDns={txt:(name:string)=>Promise<string[][]>;cname:(name:string)=>Promise<string[]>;mx:(name:string)=>Promise<{exchange:string;priority:number}[]>;ns:(name:string)=>Promise<string[]>};
export async function mailDomainReport(address:string,dns?:MailDns):Promise<MailDomainReport>{
  const domain=domainToASCII(address.includes('@')?address.split('@').pop()!:address).toLowerCase();
  if(!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain))throw new Error('Choose a valid public sending domain.');
  const resolver=new Resolver({timeout:3000,tries:1}),source=dns||{txt:(n:string)=>resolver.resolveTxt(n),cname:(n:string)=>resolver.resolveCname(n),mx:(n:string)=>resolver.resolveMx(n),ns:(n:string)=>resolver.resolveNs(n)};
  const ask=async<T>(run:()=>Promise<T>)=>{try{return {data:await run(),unavailable:false};}catch(error){const code=(error as {code?:string}).code;return {data:undefined,unavailable:!['ENODATA','ENOTFOUND','NXDOMAIN'].includes(code||'')};}};
  const [txt,dm,s1,s2,mx,ns]=await Promise.all([ask(()=>source.txt(domain)),ask(()=>source.txt('_dmarc.'+domain)),ask(()=>source.cname('selector1._domainkey.'+domain)),ask(()=>source.cname('selector2._domainkey.'+domain)),ask(()=>source.mx(domain)),ask(()=>source.ns(domain))]);
  const spf=(txt.data||[]).map(r=>r.join('')).filter(r=>/^v=spf1(?:\s|$)/i.test(r)),dmarc=(dm.data||[]).map(r=>r.join('')).filter(r=>/^v=DMARC1(?:;|\s|$)/i.test(r));
  const selectors=[...(s1.data||[]).map(v=>'selector1: '+v),...(s2.data||[]).map(v=>'selector2: '+v)],nameservers=ns.data||[];
  const recognisedSpf=spf.length===1&&/include:(?:spf\.protection\.outlook\.com|secureserver\.net)(?=\s|$)/i.test(spf[0]);
  const godaddyMail=(mx.data||[]).some(r=>/^(?:smtp|mailstore1)\.secureserver\.net\.?$/i.test(r.exchange));
  const policy=dmarc.length===1?/;\s*p=(none|quarantine|reject)(?:;|\s|$)/i.exec(dmarc[0])?.[1].toLowerCase():undefined;
  return {domain,checkedAt:new Date().toISOString(),
    spf:{status:txt.unavailable?'unavailable':spf.length===0?'missing':spf.length!==1||/\+all\b/i.test(spf[0])?'review':recognisedSpf?'ready':'review',records:spf,note:txt.unavailable?'DNS lookup is unavailable; this does not mean the record is missing.':spf.length===1?'One SPF record is published. Microsoft 365 bought from GoDaddy normally uses include:secureserver.net; direct Microsoft 365 normally uses include:spf.protection.outlook.com. Use the value prescribed by your mailbox provider and verify spf=pass in a received message.':'Publish exactly one SPF record for the sending domain.'},
    dkim:{status:selectors.length?'review':s1.unavailable||s2.unavailable?'unavailable':'missing',records:selectors,note:selectors.length?'At least one Microsoft selector CNAME is published. Check both records, enable DKIM signing in Microsoft 365 and verify dkim=pass with d='+domain+' in a received message.':'Microsoft selector1 and selector2 CNAME records were not found. Get both values from Microsoft 365 for this exact domain, publish them at the authoritative DNS host, then enable DKIM. Other mail services can use different selectors.'},
    dmarc:{status:dm.unavailable?'unavailable':dmarc.length===0?'missing':policy?'ready':'review',records:dmarc,note:policy?`Published policy: ${policy}. Preserve the existing policy while checking that a passing SPF or DKIM domain aligns with the visible From domain.`:'DMARC requires alignment of the visible From domain with a passing SPF or DKIM domain. For a new record, begin with monitoring and review legitimate senders before enforcing it.'},
    mx:{status:mx.unavailable?'unavailable':godaddyMail?'review':mx.data?.length?'ready':'missing',records:(mx.data||[]).sort((a,b)=>a.priority-b.priority).map(r=>`${r.priority} ${r.exchange}`),note:godaddyMail?'Mail currently routes to GoDaddy mail servers. Compare these values with your Email & Office dashboard or Microsoft 365 domain setup. DNS alone does not establish which mailbox product you use; change routing only as part of a confirmed mailbox setup.':'The domain should have valid mail routing. Compare the records with your actual mailbox provider’s instructions.'},
    nameservers,dnsHost:nameservers.some(n=>/domaincontrol\.com\.?$/i.test(n))?'GoDaddy':nameservers.some(n=>/vercel-dns\.com\.?$/i.test(n))?'Vercel':nameservers.some(n=>/cloudflare\.com\.?$/i.test(n))?'Cloudflare':'Your authoritative DNS provider',
    note:'DNS records alone cannot confirm inbox delivery or active DKIM signing. Check SPF, DKIM and DMARC in a received message. Microsoft Accepted is not an inbox-delivery confirmation.'};
}
