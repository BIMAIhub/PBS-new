import {mailDomainReport} from '../server/mail-domain.js';
try{console.log(JSON.stringify(await mailDomainReport(process.argv[2]||'pragmaticbim.com'),null,2));}catch(error){console.error(error instanceof Error?error.message:'Email-domain lookup failed.');process.exitCode=1;}
