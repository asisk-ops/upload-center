/* Upload template rules (from the Data Upload Template doc) and the CSV checker. */
const HEAD=["dealer_vehicle_vin","name","phone_number","dealer_vehicle_year","dealer_vehicle_make","dealer_vehicle_model","coupon","email","service_type","recall_id","recall","last_service_date","requested_part","im_expiration_date"];
const BASE=["name","phone_number","dealer_vehicle_year","dealer_vehicle_make","dealer_vehicle_model"];
const VARS=["dealer_vehicle_vin","coupon","service_type","recall_id","recall","last_service_date","requested_part","im_expiration_date"];
// R required · IP if provided · L leave out · N not needed (column ok, may be blank)
const TYPES={
 "Service Due (A / B)":{k:["servicedue","servicea","serviceb","service"],r:["R","IP","R","L","L","R","L","L"],svc:["Service A","Service B"]},
 "Declined Services":{k:["declined","declinedservices","ds"],r:["R","IP","R","L","L","R","L","L"],svc:["Declined Services"]},
 "PPM Package":{k:["ppm","ppmpackage","ppmpackageinfo"],r:["R","IP","R","L","L","IP","L","IP"],svc:["PPM Package Info"]},
 "Warranty / PPM Expiration":{k:["warranty","ppmexpiration","warrantyexpiration","expiration","imexpiration"],r:["R","IP","L","L","L","IP","L","R"]},
 "Recall":{k:["recall","recalls"],r:["R","L","L","R","IP","L","L","L"]},
 "Special Order Parts":{k:["specialorderparts","specialorder","sop","parts"],r:["R","IP","L","L","L","L","R","L"]},
 "Missed Appointments":{k:["missed","missedappt","missedappointments","missedappointment"],r:["N","IP","R","L","L","L","L","L"],svc:["Missed Appt"]},
 "Confirmed Appointments":{k:["confirmed","confirmedappt","confirmedappointments","confirmedappointment"],r:["N","IP","L","L","L","L","L","L"]}
};
const TYPE_NAMES=Object.keys(TYPES);
const GUIDE=[["dealer_vehicle_vin","VIN","17 characters, no spaces","1HGCV1F34MA012345"],["name","Customer first and last name","First Last","Maria Lopez"],["phone_number","Phone number","10 digits, no dashes or spaces","5125550142"],["dealer_vehicle_year","Year","4-digit year","2021"],["dealer_vehicle_make","Make","Text","Honda"],["dealer_vehicle_model","Model","Text","Accord"],["coupon","Incentives / offers","Text","$20 off oil change"],["email","Email","Valid email or blank","maria.lopez@email.com"],["service_type","Service type","Service A, Service B, Declined Services, PPM Package Info, Missed Appt","Service A"],["recall_id","Recall ID","Manufacturer recall code","23V-456"],["recall","Recall scheduling notes","Text","Parts in stock, 2 hr appointment"],["last_service_date","Last RO date","MM/DD/YYYY","03/14/2026"],["requested_part","Special order parts","Text","Front brake rotors"],["im_expiration_date","Warranty / PPM expiration","MM/DD/YYYY","12/31/2026"]];
const norm=s=>String(s).toLowerCase().replace(/[^a-z0-9]/g,"");
const ALIAS={vin:"dealer_vehicle_vin",vehiclevin:"dealer_vehicle_vin",customername:"name",fullname:"name",customer:"name",phone:"phone_number",phonenumber:"phone_number",cell:"phone_number",mobile:"phone_number",year:"dealer_vehicle_year",vehicleyear:"dealer_vehicle_year",make:"dealer_vehicle_make",vehiclemake:"dealer_vehicle_make",model:"dealer_vehicle_model",vehiclemodel:"dealer_vehicle_model",emailaddress:"email",servicetype:"service_type",recallid:"recall_id",recallnotes:"recall",lastservicedate:"last_service_date",lastrodate:"last_service_date",requestedpart:"requested_part",part:"requested_part",imexpirationdate:"im_expiration_date",expirationdate:"im_expiration_date",offer:"coupon"};
HEAD.forEach(h=>ALIAS[norm(h)]=h);

function parseCSV(text){text=text.replace(/^﻿/,"");const rows=[];let row=[],cell="",q=false;
  for(let i=0;i<text.length;i++){const c=text[i];
    if(q){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++}else q=false}else cell+=c}
    else if(c==='"')q=true;else if(c===","){row.push(cell);cell=""}
    else if(c==="\n"||c==="\r"){if(c==="\r"&&text[i+1]==="\n")i++;row.push(cell);rows.push(row);row=[];cell=""}
    else cell+=c}
  if(cell!==""||row.length){row.push(cell);rows.push(row)}
  return rows.filter(r=>r.some(c=>c.trim()!==""))}
const csvCell=v=>{v=v==null?"":String(v);return /[",\r\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v};
function detectType(name){const parts=String(name).replace(/\.csv$/i,"").split(/[_\s-]+/);
  for(const part of parts.slice(1).concat(parts)){const n=norm(part);for(const t of TYPE_NAMES)if(TYPES[t].k.includes(n))return t}
  const n=norm(name);for(const t of TYPE_NAMES)for(const k of TYPES[t].k)if(k.length>4&&n.includes(k))return t;return null}
const pad2=x=>String(x).padStart(2,"0");const validDate=(mo,d,y)=>mo>=1&&mo<=12&&d>=1&&d<=31&&y>1900&&y<2100;
function fixDate(v){const s=v.trim();if(!s)return{v:s};let m;
  if(m=s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/))return validDate(+m[1],+m[2],+m[3])?{v:s}:{err:"Not a real date"};
  if(m=s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2}|\d{4})$/)){const y=m[3].length===2?2000+ +m[3]:+m[3];if(!validDate(+m[1],+m[2],y))return{err:"Not a real date"};return{v:pad2(m[1])+"/"+pad2(m[2])+"/"+y,fixed:"Date reformatted to MM/DD/YYYY"}}
  if(m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)){if(!validDate(+m[2],+m[3],+m[1]))return{err:"Not a real date"};return{v:pad2(m[2])+"/"+pad2(m[3])+"/"+m[1],fixed:"Date reformatted to MM/DD/YYYY"}}
  return{err:"Date isn't MM/DD/YYYY"}}

function checkFile(name,text,forced){
  const rows=parseCSV(text),R={name,issues:[],checks:[],errRows:new Set(),fixRows:new Set()};
  if(!rows.length){R.fatal="The file is empty.";return R}
  const fnOk=/^[A-Za-z0-9]+_[A-Za-z0-9]+_\d{8}\.csv$/i.test(name);
  R.checks.push([fnOk?"ok":"fx",fnOk?"File name follows the naming rule":`File name should be DealerName_ListType_MMDDYYYY.csv (got “${name}”)`]);
  const type=forced||detectType(name);R.type=type;
  if(!type){R.fatal="Couldn't tell the list type from the file name. Pick it from the List type menu.";return R}
  R.dealer=(name.split("_")[0]||"").replace(/([a-z])([A-Z])/g,"$1 $2");
  const T=TYPES[type],req={};VARS.forEach((v,i)=>req[v]=T.r[i]);BASE.forEach(b=>req[b]="R");
  const raw=rows[0],map=[],seen={},notes=[];
  raw.forEach(h=>{const t=h.trim(),canon=ALIAS[norm(t)];if(!canon){notes.push(["no",`Unknown column “${t||"(blank)"}” will be dropped`]);map.push(null);return}
    if(seen[canon]){notes.push(["no",`Column ${canon} appears twice; the first one is kept`]);map.push(null);return}
    seen[canon]=true;map.push(canon);if(t!==canon)notes.push(["fx",`Header “${t}” renamed to ${canon}`])});
  const missing=BASE.concat(req.dealer_vehicle_vin==="R"?["dealer_vehicle_vin"]:[]).filter(c=>!seen[c]);
  VARS.forEach(v=>{if(req[v]==="R"&&!seen[v]&&!missing.includes(v))missing.push(v)});
  R.checks.push(missing.length?["no","Missing required column"+(missing.length>1?"s":"")+": "+missing.join(", ")]:["ok","All required columns are present"]);
  if(!seen.email)R.checks.push(["fx","email header missing; added as a blank column"]);
  const extra=VARS.filter(v=>req[v]==="L"&&seen[v]);if(extra.length)R.checks.push(["fx",`Not used for ${type}: ${extra.join(", ")} (dropped from the cleaned file)`]);
  notes.forEach(n=>R.checks.push(n));R.missingCols=missing;
  const out=HEAD.filter(h=>h==="email"||req[h]==="R"||req[h]==="N"||(req[h]==="IP"&&seen[h]));R.out=out;
  const yr=new Date().getFullYear(),dupe={};
  const add=(row,col,msg,kind)=>{R.issues.push({row,col,msg,kind});(kind==="err"?R.errRows:R.fixRows).add(row)};
  R.clean=rows.slice(1).map((cells,ri)=>{const rn=ri+2,o={};map.forEach((c,i)=>{if(c)o[c]=(cells[i]||"")});
    for(const k in o){const t=o[k].replace(/\s+/g," ").trim();if(o[k].trim()!==t)add(rn,k,"Extra spaces removed","fix");o[k]=t}
    if("dealer_vehicle_vin" in o||req.dealer_vehicle_vin==="R"){let v=o.dealer_vehicle_vin||"";const u=v.replace(/[\s-]/g,"").toUpperCase();if(v&&u!==v)add(rn,"VIN","VIN cleaned (spaces/case)","fix");v=u;o.dealer_vehicle_vin=v;
      if(!v){if(req.dealer_vehicle_vin==="R")add(rn,"VIN","VIN is blank","err")}else if(!/^[A-HJ-NPR-Z0-9]{17}$/.test(v))add(rn,"VIN",v.length!==17?`VIN has ${v.length} characters, needs 17`:"VIN has invalid letters (I, O or Q)","err")}
    BASE.forEach(c=>{if(!o[c])add(rn,c,{name:"Name",phone_number:"Phone",dealer_vehicle_year:"Year",dealer_vehicle_make:"Make",dealer_vehicle_model:"Model"}[c]+" is blank","err")});
    if(o.phone_number){let d=o.phone_number.replace(/\D/g,"");if(d.length===11&&d[0]==="1")d=d.slice(1);if(d.length===10){if(d!==o.phone_number)add(rn,"phone_number","Phone reformatted to 10 digits","fix");o.phone_number=d}else add(rn,"phone_number",`Phone has ${d.length} digits, needs 10`,"err")}
    if(o.dealer_vehicle_year&&!(/^\d{4}$/.test(o.dealer_vehicle_year)&&+o.dealer_vehicle_year>=1980&&+o.dealer_vehicle_year<=yr+2))add(rn,"dealer_vehicle_year","Year isn't a 4-digit model year","err");
    if(o.email&&!/^[^\s@,;]+@[^\s@,;]+\.[a-z]{2,}$/i.test(o.email))add(rn,"email","Email isn't valid","err");
    ["last_service_date","im_expiration_date"].forEach(c=>{if(!(c in o))return;if(!o[c]){if(req[c]==="R")add(rn,c,c==="last_service_date"?"Last service date is blank":"Expiration date is blank","err");return}const r=fixDate(o[c]);if(r.err)add(rn,c,r.err,"err");else{if(r.fixed)add(rn,c,r.fixed,"fix");o[c]=r.v}});
    ["recall_id","requested_part"].forEach(c=>{if(req[c]==="R"&&!o[c])add(rn,c,(c==="recall_id"?"Recall ID":"Requested part")+" is blank","err")});
    if(req.service_type==="R"){const ok=T.svc,cur=o.service_type||"",match=ok.find(s=>norm(s)===norm(cur));
      if(match){if(match!==cur)add(rn,"service_type",`Service type set to “${match}”`,"fix");o.service_type=match}
      else if(!cur&&ok.length===1){o.service_type=ok[0];add(rn,"service_type",`Service type filled as “${ok[0]}”`,"fix")}
      else add(rn,"service_type",cur?`Service type “${cur}” should be ${ok.join(" or ")}`:"Service type is blank (Service A or Service B)","err")}
    const key=(o.dealer_vehicle_vin||"")+"|"+(o.phone_number||"")+"|"+norm(o.name||"");if(key.replace(/\|/g,"")){if(dupe[key])add(rn,"row",`Duplicate of row ${dupe[key]}`,"err");else dupe[key]=rn}
    return out.map(h=>o[h]||"")});
  R.total=R.clean.length;return R}

function summarize(R){const g={};R.issues.forEach(i=>{const msg=i.msg.replace(/has \d+ (characters|digits)/,"has the wrong number of $1").replace(/“[^”]*”/,"value").replace(/row \d+/,"another row");const k=i.kind+"|"+msg;(g[k]=g[k]||{kind:i.kind,msg,rows:new Set()}).rows.add(i.row)});
  return Object.values(g).map(x=>({kind:x.kind,msg:x.msg,n:x.rows.size})).sort((a,b)=>a.kind===b.kind?b.n-a.n:(a.kind==="err"?-1:1))}
