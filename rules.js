/* Upload rules from the CallSource "Upload List Column Header Guide", plus the CSV checker.
   Headers are not case-sensitive and may come in any order; spelling must match. */
const HEAD=["dealer_vehicle_vin","name","phone_number","dealer_vehicle_year","dealer_vehicle_make","dealer_vehicle_model","coupon","email","service_type","recall_id","recall","last_service_date","requested_part","im_expiration_date"];
const YMM=["dealer_vehicle_year","dealer_vehicle_make","dealer_vehicle_model"];
const VARS=["dealer_vehicle_vin","coupon","service_type","recall_id","recall","last_service_date","requested_part","im_expiration_date"];
// Levels: R required · P preferred (optional, flagged for review when blank) · IP include if provided · L not on this list
// r = levels for VARS in order; ymm = level for year/make/model (default R)
const TYPES={
 "CXPro / Service Lifestyle Engine":{k:["cxpro","sle","servicelifestyle","servicelifestyleengine","lifestyle","servicedue","service"],r:["R","IP","IP","L","L","IP","L","L"]},
 "Missed & Appointment Confirmation":{k:["missed","missedappt","missedappointment","missedappointments","confirmation","confirmed","appointmentconfirmation","apptconfirmation","appt","appointment"],r:["IP","L","IP","L","L","IP","L","L"]},
 "Recalls":{k:["recall","recalls"],r:["R","L","L","R","IP","L","L","L"],ymm:"P"},
 "Telematics / TLE":{k:["telematics","tle","connected","connectedservice"],r:["R","IP","IP","L","L","P","L","L"]},
 "CSI":{k:["csi"],r:["R","L","L","L","L","IP","L","L"]},
 "Declined Services":{k:["declined","declinedservices","ds"],r:["R","IP","R","L","L","P","L","L"],dupesOk:true},
 "Special Order Parts":{k:["specialorderparts","specialorder","sop","parts"],r:["R","L","L","L","L","L","R","L"]},
 "Warranty Expiration":{k:["warranty","warrantyexpiration","expiration","imexpiration"],r:["R","L","IP","L","L","L","L","R"]}
};
const TYPE_NAMES=Object.keys(TYPES);
const LEVEL_TEXT={R:"Required",P:"Preferred",IP:"If provided",L:"—"};
const TYPE_NOTES={
 "Missed & Appointment Confirmation":"VIN and last service date aren't needed but can stay if provided.",
 "Recalls":"Year, make and model are highly preferred; the list can go without them. recall_id is the OEM code or NHTSA recall ID; recall holds scheduling notes from the info sheet.",
 "Declined Services":"Several declined services for the same customer go in one service_type cell. Duplicate rows are fine; Omni merges them on import.",
 "Warranty Expiration":"Leave out any expiration dates older than the current week (the checker removes them from the cleaned file)."
};
const GUIDE=[["name","Customer first and last name","Text","Maria Lopez"],["phone_number","Phone number","Any format; must be a 10-digit number","(512) 555-0142 or 5125550142"],["email","Email","Header required on every list; cells may be blank","maria.lopez@email.com"],["dealer_vehicle_vin","VIN","17 characters, no spaces","1HGCV1F34MA012345"],["dealer_vehicle_year","Vehicle year","4-digit year","2021"],["dealer_vehicle_make","Vehicle make","Text","Honda"],["dealer_vehicle_model","Vehicle model","Text","Accord"],["coupon","Incentives and offers","From the incentive sheet, if applicable","$20 off oil change"],["service_type","Service type","Service recommendations provided with the list","Oil change, tire rotation"],["last_service_date","Last service date","MM/DD/YYYY","03/14/2026"],["recall_id","Recall ID","OEM code or NHTSA recall ID","23V-456"],["recall","Recall scheduling notes","Notes from the info sheet for agents","Parts in stock, 2 hr appointment"],["requested_part","Requested part","Text","Front brake rotors"],["im_expiration_date","Warranty expiration date","MM/DD/YYYY, current week or later","12/31/2026"]];
const norm=s=>String(s).toLowerCase().replace(/[^a-z0-9]/g,"");
const ALIAS={vin:"dealer_vehicle_vin",vehiclevin:"dealer_vehicle_vin",customername:"name",fullname:"name",customer:"name",phone:"phone_number",phonenumber:"phone_number",cell:"phone_number",mobile:"phone_number",year:"dealer_vehicle_year",vehicleyear:"dealer_vehicle_year",make:"dealer_vehicle_make",vehiclemake:"dealer_vehicle_make",model:"dealer_vehicle_model",vehiclemodel:"dealer_vehicle_model",emailaddress:"email",servicetype:"service_type",recallid:"recall_id",recallnotes:"recall",lastservicedate:"last_service_date",lastrodate:"last_service_date",requestedpart:"requested_part",part:"requested_part",imexpirationdate:"im_expiration_date",expirationdate:"im_expiration_date",warrantyexpirationdate:"im_expiration_date",offer:"coupon",incentive:"coupon"};
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
function weekStart(){const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-((d.getDay()+6)%7));return d}
const LABEL={name:"Name",phone_number:"Phone",dealer_vehicle_year:"Year",dealer_vehicle_make:"Make",dealer_vehicle_model:"Model",recall_id:"Recall ID",requested_part:"Requested part",service_type:"Service type",last_service_date:"Last service date",im_expiration_date:"Warranty expiration date"};

function checkFile(name,text,forced){
  const rows=parseCSV(text),R={name,issues:[],checks:[],errRows:new Set(),fixRows:new Set(),warnRows:new Set(),drop:new Set()};
  if(!rows.length){R.fatal="The file is empty.";return R}
  const fnOk=/^[A-Za-z0-9]+_[A-Za-z0-9]+_\d{8}\.csv$/i.test(name);
  R.checks.push([fnOk?"ok":"fx",fnOk?"File name follows the naming rule":`File name should be DealerName_ListType_MMDDYYYY.csv (got “${name}”)`]);
  const type=forced||detectType(name);R.type=type;
  if(!type){R.fatal="Couldn't tell the list type from the file name. Pick it from the List type menu.";return R}
  R.dealer=(name.split("_")[0]||"").replace(/([a-z])([A-Z])/g,"$1 $2");
  const T=TYPES[type],req={name:"R",phone_number:"R",email:"H"};VARS.forEach((v,i)=>req[v]=T.r[i]);YMM.forEach(c=>req[c]=T.ymm||"R");
  const raw=rows[0],map=[],seen={},notes=[];
  raw.forEach(h=>{const t=h.trim(),canon=ALIAS[norm(t)];if(!canon){notes.push(["no",`Unknown column “${t||"(blank)"}” will be dropped`]);map.push(null);return}
    if(seen[canon]){notes.push(["no",`Column ${canon} appears twice; the first one is kept`]);map.push(null);return}
    seen[canon]=true;map.push(canon);if(t.toLowerCase()!==canon)notes.push(["fx",`Header “${t}” renamed to ${canon}`])});
  const missing=HEAD.filter(c=>req[c]==="R"&&!seen[c]);
  R.checks.push(missing.length?["no","Missing required column"+(missing.length>1?"s":"")+": "+missing.join(", ")]:["ok","All required columns are present"]);
  if(!seen.email)R.checks.push(["fx","email header missing; added as a blank column (required on every list)"]);
  const pref=HEAD.filter(c=>req[c]==="P"&&!seen[c]);if(pref.length)R.checks.push(["fx","Not required but highly preferred: "+pref.join(", ")]);
  const extra=HEAD.filter(c=>req[c]==="L"&&seen[c]);if(extra.length)R.checks.push(["fx",`Not used on ${type} lists: ${extra.join(", ")} (dropped from the cleaned file)`]);
  notes.forEach(n=>R.checks.push(n));R.missingCols=missing;
  const out=HEAD.filter(h=>h==="email"||req[h]==="R"||((req[h]==="IP"||req[h]==="P")&&seen[h]));R.out=out;
  const yr=new Date().getFullYear(),dupe={},wk=weekStart();
  const add=(row,col,msg,kind)=>{R.issues.push({row,col,msg,kind});({err:R.errRows,fix:R.fixRows,warn:R.warnRows})[kind].add(row)};
  const clean=rows.slice(1).map((cells,ri)=>{const rn=ri+2,o={};map.forEach((c,i)=>{if(c)o[c]=(cells[i]||"")});
    for(const k in o){const t=o[k].replace(/\s+/g," ").trim();if(o[k].trim()!==t)add(rn,k,"Extra spaces removed","fix");o[k]=t}
    if("dealer_vehicle_vin" in o||req.dealer_vehicle_vin==="R"){let v=o.dealer_vehicle_vin||"";const u=v.replace(/[\s-]/g,"").toUpperCase();if(v&&u!==v)add(rn,"VIN","VIN cleaned (spaces/case)","fix");v=u;o.dealer_vehicle_vin=v;
      if(!v){if(req.dealer_vehicle_vin==="R")add(rn,"VIN","VIN is blank","err")}else if(!/^[A-HJ-NPR-Z0-9]{17}$/.test(v))add(rn,"VIN",v.length!==17?`VIN has ${v.length} characters, needs 17`:"VIN has invalid letters (I, O or Q)","err")}
    HEAD.forEach(c=>{if(c==="dealer_vehicle_vin"||c==="email"||o[c])return;if(req[c]==="R"&&(seen[c]||!missing.includes(c)))add(rn,c,LABEL[c]+" is blank","err")});
    if(req.dealer_vehicle_year==="P"&&seen.dealer_vehicle_year&&!(o.dealer_vehicle_year&&o.dealer_vehicle_make&&o.dealer_vehicle_model))add(rn,"year/make/model","Year, make or model missing (preferred)","warn");
    if(o.phone_number){let d=o.phone_number.replace(/\D/g,"");if(d.length===11&&d[0]==="1")d=d.slice(1);if(d.length!==10)add(rn,"phone_number",`Phone has ${d.length} digits, should be a 10-digit number`,"err")}  // any format is fine (dashes, spaces, parentheses); kept as sent
    if(o.dealer_vehicle_year&&!(/^\d{4}$/.test(o.dealer_vehicle_year)&&+o.dealer_vehicle_year>=1980&&+o.dealer_vehicle_year<=yr+2))add(rn,"dealer_vehicle_year","Year isn't a 4-digit model year","err");
    if(o.email&&!/^[^\s@,;]+@[^\s@,;]+\.[a-z]{2,}$/i.test(o.email))add(rn,"email","Email isn't valid","err");
    ["last_service_date","im_expiration_date"].forEach(c=>{if(!(c in o)||!o[c])return;const r=fixDate(o[c]);if(r.err){add(rn,c,r.err,"err");return}if(r.fixed)add(rn,c,r.fixed,"fix");o[c]=r.v;
      if(c==="im_expiration_date"){const[mm,dd,yy]=r.v.split("/").map(Number);if(new Date(yy,mm-1,dd)<wk){R.drop.add(rn);add(rn,c,"Row removed: expiration date is before this week","fix")}}});
    if(!T.dupesOk){const key=(o.dealer_vehicle_vin||"")+"|"+(o.phone_number||"")+"|"+norm(o.name||"");if(key.replace(/\|/g,"")){if(dupe[key])add(rn,"row",`Possible duplicate of row ${dupe[key]}`,"warn");else dupe[key]=rn}}
    return[rn,out.map(h=>o[h]||"")]});
  R.clean=clean.filter(([rn])=>!R.drop.has(rn)).map(x=>x[1]);
  R.total=clean.length;return R}

function summarize(R){const g={};R.issues.forEach(i=>{const msg=i.msg.replace(/has \d+ (characters|digits)/,"has the wrong number of $1").replace(/“[^”]*”/,"value").replace(/row \d+/,"another row");const k=i.kind+"|"+msg;(g[k]=g[k]||{kind:i.kind,msg,rows:new Set()}).rows.add(i.row)});
  const rank={err:0,warn:1,fix:2};return Object.values(g).map(x=>({kind:x.kind,msg:x.msg,n:x.rows.size})).sort((a,b)=>rank[a.kind]-rank[b.kind]||b.n-a.n)}
