const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs');
const normalise=value=>String(value||'').normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('en-IN');
const clean=value=>String(value||'').normalize('NFKC').trim().replace(/\s+/g,' ');
const branchLabel=row=>`${clean(row.branch).slice(0,48)}${row.city||row.state?' — '+clean(row.city||row.state).slice(0,20):''} [${row.ifsc}]`;
function* csvRows(input){
 let row=[],cell='',quoted=false;
 for(let i=0;i<input.length;i++){
  const c=input[i];if(c==='"'){if(quoted&&input[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
  else if(c===','&&!quoted){row.push(cell);cell='';}
  else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&input[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v!==''))yield row;row=[];cell='';}
  else cell+=c;
  if(cell.length>100000)throw Error('The directory contains an oversized CSV field.');
 }
 if(quoted)throw Error('The directory CSV is incomplete.');if(cell||row.length){row.push(cell);yield row;}
}
function buildCache(file,csv,names,sublets,metadata,{minRows=1000,onProgress=()=>{}}={}){
 const db=new DatabaseSync(file);let total=0,skipped=0;
 try{
  db.exec(`PRAGMA journal_mode=DELETE;CREATE TABLE banks(code TEXT PRIMARY KEY,name TEXT NOT NULL,name_key TEXT NOT NULL);CREATE TABLE branches(ifsc TEXT PRIMARY KEY,bank_code TEXT NOT NULL REFERENCES banks(code),branch TEXT NOT NULL,city TEXT NOT NULL,state TEXT NOT NULL,address TEXT NOT NULL,search_key TEXT NOT NULL);CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);BEGIN IMMEDIATE;`);
  const iterator=csvRows(csv),header=iterator.next().value?.map(c=>c.replace(/^\uFEFF/,''));
  for(const column of ['IFSC','BRANCH','CITY','STATE','ADDRESS'])if(!header?.includes(column))throw Error(`Directory is missing ${column}.`);
  const positions=Object.fromEntries(header.map((h,i)=>[h,i]));
  const bank=db.prepare('INSERT OR IGNORE INTO banks VALUES(?,?,?)'),branch=db.prepare('INSERT INTO branches VALUES(?,?,?,?,?,?,?) ON CONFLICT(ifsc) DO NOTHING');
  for(const values of iterator){
   const ifsc=clean(values[positions.IFSC]).toUpperCase(),name=clean(values[positions.BRANCH]);
   if(!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)||!name){skipped++;continue;}
   const code=clean(sublets[ifsc]||ifsc.slice(0,4)).toUpperCase();if(!/^[A-Z0-9]{4}$/.test(code)){skipped++;continue;}
   const bankName=clean(names[code]||values[positions.BANK]||`${code} (bank name unavailable)`),city=clean(values[positions.CITY]),state=clean(values[positions.STATE]),address=clean(values[positions.ADDRESS]);
   bank.run(code,bankName,normalise(bankName));total+=Number(branch.run(ifsc,code,name,city,state,address,normalise([name,city,state,ifsc,address].join(' '))).changes);
   if(total%10000===0)onProgress(total);
  }
  if(total<minRows||skipped>Math.max(100,total*.05))throw Error('The downloaded directory failed its completeness checks.');
  db.exec('CREATE INDEX bank_name_lookup ON banks(name_key);CREATE INDEX branch_bank_lookup ON branches(bank_code,branch);');
  const summary={...metadata,format:1,branchCount:total,bankCount:Number(db.prepare('SELECT COUNT(*) AS n FROM banks').get().n),skippedRows:skipped,downloadedAt:new Date().toISOString()};
  const put=db.prepare('INSERT INTO metadata VALUES(?,?)');for(const[k,v]of Object.entries(summary))put.run(k,JSON.stringify(v));
  db.exec('COMMIT');if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Directory integrity check failed.');return summary;
 }catch(e){try{db.exec('ROLLBACK');}catch{}throw e;}finally{db.close();}
}
class DirectoryCache{
 constructor(file){this.file=file;this.db=new DatabaseSync(file,{readOnly:true});try{this.metadata=Object.fromEntries(this.db.prepare('SELECT * FROM metadata').all().map(r=>[r.key,JSON.parse(r.value)]));if(this.metadata.format!==1)throw Error('Unsupported directory format.');}catch(e){this.db.close();throw e;}}
 close(){this.db.close();}
 banks(query='',limit=40){
  const q=normalise(query).slice(0,150),escape=value=>value.replace(/[\\%_]/g,'\\$&'),tokens=q.split(' ').filter(Boolean).slice(0,12);
  const where=tokens.length?tokens.map(()=>"(name_key LIKE ? ESCAPE '\\' OR lower(code) LIKE ? ESCAPE '\\')").join(' AND '):'1=1';
  return this.db.prepare(`SELECT code,name FROM banks WHERE ${where} ORDER BY CASE WHEN name_key=? OR lower(code)=? THEN 0 WHEN name_key LIKE ? ESCAPE '\\' OR lower(code) LIKE ? ESCAPE '\\' THEN 1 ELSE 2 END,name,code LIMIT ?`).all(...tokens.flatMap(token=>[`%${escape(token)}%`,`%${escape(token)}%`]),q,q,`${escape(q)}%`,`${escape(q)}%`,Math.min(60,limit));
 }
 bank(code){return this.db.prepare('SELECT code,name FROM banks WHERE code=?').get(String(code).toUpperCase());}
 bankByName(name){const matches=this.db.prepare('SELECT code,name FROM banks WHERE name_key=? ORDER BY code LIMIT 2').all(normalise(name));return matches.length===1?matches[0]:null;}
 branches(code,query='',limit=40){
  const tokens=normalise(query).slice(0,150).split(' ').filter(Boolean).slice(0,8),where=tokens.map(()=>`AND b.search_key LIKE ?`).join(' ');
  return this.db.prepare(`SELECT b.*,k.name AS bank_name FROM branches b JOIN banks k ON k.code=b.bank_code WHERE b.bank_code=? ${where} ORDER BY b.branch,b.city,b.ifsc LIMIT ?`).all(code,...tokens.map(t=>`%${t}%`),Math.min(60,limit)).map(r=>({...r,label:branchLabel(r)}));
 }
 branch(ifsc){const r=this.db.prepare('SELECT b.*,k.name AS bank_name FROM branches b JOIN banks k ON k.code=b.bank_code WHERE ifsc=?').get(String(ifsc).toUpperCase());return r?{...r,label:branchLabel(r)}:null;}
}
module.exports={normalise,branchLabel,csvRows,buildCache,DirectoryCache};
