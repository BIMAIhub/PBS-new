export interface PastStudentContactInput { name:string; email:string; phone:string }
export const pastStudentImportLimit=25;

// RFC 4180 quoting, UTF-8 BOM and CRLF are supported; contact values remain strings.
export function parsePastStudentCsv(input:string):PastStudentContactInput[] {
  if(input.length>200_000)throw new Error('Choose a CSV below 200 KB.');
  const text=input.replace(/^\uFEFF/,''),table:string[][]=[];
  let row:string[]=[],value='',quoted=false,closed=false;
  const finishCell=()=>{row.push(value.trim());value='';closed=false;};
  const finishRow=()=>{finishCell();if(row.some(Boolean))table.push(row);row=[];};
  for(let i=0;i<text.length;i++) {
    const char=text[i];
    if(quoted){if(char==='"'){if(text[i+1]==='"'){value+='"';i++;}else{quoted=false;closed=true;}}else value+=char;continue;}
    if(char==='"'){if(value.trim()||closed)throw new Error('A CSV quote is in the wrong place. Save the file as a standard CSV and try again.');value='';quoted=true;}
    else if(char===',')finishCell();
    else if(char==='\r'||char==='\n'){if(char==='\r'&&text[i+1]==='\n')i++;finishRow();}
    else if(closed){if(!/\s/.test(char))throw new Error('Unexpected text after a quoted CSV value.');}
    else value+=char;
  }
  if(quoted)throw new Error('A CSV quote is not closed.');
  if(value||row.length||closed)finishRow();
  if(table.length<2)throw new Error('Include a header and at least one student.');
  const headers=table.shift()!.map(s=>s.toLowerCase().replace(/[^a-z0-9]/g,''));
  const find=(names:string[])=>headers.findIndex(s=>names.includes(s));
  const nameIndex=find(['name','fullname','studentname']),emailIndex=find(['email','emailid','emailaddress']),phoneIndex=find(['phone','phonenumber','mobile','mobilenumber','whatsapp','whatsappnumber']);
  if(nameIndex<0||emailIndex<0)throw new Error('Use Name, Email ID and Mobile Number columns.');
  if(table.length>pastStudentImportLimit)throw new Error(`Import up to ${pastStudentImportLimit} students at a time.`);
  const emails=new Set<string>();
  return table.map((cells,index)=>{
    const name=cells[nameIndex]||'',email=(cells[emailIndex]||'').toLowerCase(),phone=phoneIndex<0?'':cells[phoneIndex]||'';
    const fail=(message:string)=>{throw new Error(`CSV row ${index+2}: ${message}`);};
    if(!name||name.length>120)fail('enter a full name up to 120 characters.');
    if(email.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(email))fail('enter a valid email address.');
    if(phone.length>32||phone&&!/^\+?[\d ()-]{7,32}$/.test(phone))fail('enter a valid mobile number.');
    if(emails.has(email))fail('this email is repeated in the file.');emails.add(email);
    return {name,email,phone};
  });
}

export function accessDetailsCsv(rows:{name:string;email:string;phone:string;studentId:string;password?:string;signInUrl:string;body:string}[]) {
  // CSV exports must not interpret a learner-provided value as a spreadsheet formula.
  const cell=(value:string)=>'"'+(/^[=+@\-\t\r]/.test(value)?"'"+value:value).replace(/"/g,'""')+'"';
  return '\uFEFF'+[['Name','Email','Mobile number','Student ID','Temporary password','Sign-in link','Login instructions'],...rows.map(r=>[r.name,r.email,r.phone,r.studentId,r.password||'Use existing password',r.signInUrl,r.body])].map(row=>row.map(cell).join(',')).join('\r\n');
}
