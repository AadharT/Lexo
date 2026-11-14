const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { zipSync, unzipSync } = require('fflate');
const { Document, Packer, Paragraph, HeadingLevel } = require('docx');
const {atomicWrite,atomicJson,safePath,hash,acquireLease}=require('./durable-io.cjs');
const {CURRENT_SCHEMA,inspect,migrate,validateDatabase}=require('./migrations.cjs');
const {caseFiles,createSnapshot,latestSnapshot,beginRestore,clearOperation,recoverRestore}=require('./recovery.cjs');

const text = (v, max = 500) => { if (typeof v !== 'string' || v.length > max) throw Error('Invalid text value.'); return v.trim(); };
const choiceKey=value=>value.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('en-IN');
const cleanChoice=value=>text(text(value,100).normalize('NFKC').replace(/\s+/g,' '),100);
const inside = (root, relative) => { const target = path.resolve(root, relative); if (!target.startsWith(path.resolve(root) + path.sep)) throw Error('Invalid document path.'); return target; };
const readable = value => (value.normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1f]/g,' ').replace(/\s+/g,' ').replace(/[. ]+$/g,'').trim().slice(0,65) || 'Untitled');
class Store {
  constructor(root,options={}) { this.root=path.resolve(root);this.options={appVersion:require('../package.json').version,allowCreate:true,...options};this.lease=null;this.open(); }
  open({recover=true,keepLeaseOnError=false}={}) {
    const file=path.join(this.root,'lexo.sqlite'),hasOperation=fs.existsSync(this.root+'.lexo-operation.json');
    if(fs.existsSync(file)&&!hasOperation)inspect(file,this.options.appVersion);
    if(!fs.existsSync(file)&&!hasOperation&&!this.options.allowCreate)throw Error('The selected workspace is unavailable. Reconnect its drive or open the existing workspace. No empty workspace was created.');
    if(!this.lease)this.lease=acquireLease(this.root);
    try{
      if(recover)this.recoveryNotice=recoverRestore(this.root);
      if(fs.existsSync(file))inspect(file,this.options.appVersion);else if(!this.options.allowCreate)throw Error('The workspace database is missing. No empty workspace was created.');
      fs.mkdirSync(this.root,{recursive:true});this.db=new DatabaseSync(file);
      this.db.exec('PRAGMA foreign_keys=ON;PRAGMA busy_timeout=5000;PRAGMA synchronous=FULL;PRAGMA journal_mode=WAL;');
      this.lastRecoverySnapshot=migrate(this.db,this.root,this.options);
      const last=this.db.prepare("SELECT value FROM settings WHERE key='lastOpenedAppVersion'").get()?.value;
      if(!this.lastRecoverySnapshot&&last&&last!==this.options.appVersion)this.lastRecoverySnapshot=createSnapshot(this.db,this.root,'Before Lexo '+last+' → '+this.options.appVersion);
      this.pendingRecovery=this.recoverPendingDocuments();
      const workspaceId=this.db.prepare("SELECT value FROM settings WHERE key='workspaceId'").get().value;
      const marker=path.join(this.root,'.lexo-workspace.json');if(fs.existsSync(marker)){const previous=JSON.parse(fs.readFileSync(marker,'utf8'));if(previous.workspaceId!==workspaceId)throw Error('Workspace identity does not match its marker. Preserve the folder and reconnect the correct workspace.');}
      atomicJson(marker,{format:1,workspaceId,schemaVersion:CURRENT_SCHEMA,appVersion:this.options.appVersion});
      this.setting('lastOpenedAppVersion',this.options.appVersion);validateDatabase(this.db);
    }catch(e){try{this.db?.close();}catch{}this.db=null;if(!keepLeaseOnError){this.lease?.release();this.lease=null;}throw e;}
  }
  close() { if(this.db){this.db.close();this.db=null;}this.lease?.release();this.lease=null; }
  recoverPendingDocuments(){
    const issues=[];for(const p of this.db.prepare('SELECT * FROM pending_documents').all()){
      try{const target=safePath(this.root,p.relative_path),temp=safePath(this.root,p.temp_path),source=fs.existsSync(target)?target:fs.existsSync(temp)?temp:null;
        if(!source)throw Error('The interrupted file copy did not finish. Re-import the original file.');const data=fs.readFileSync(source);if(data.length!==p.size||hash(data)!==p.sha256)throw Error('Interrupted file needs recovery; its bytes did not verify.');if(source!==target)fs.renameSync(source,target);
        this.db.exec('BEGIN IMMEDIATE');try{this.db.prepare('INSERT OR IGNORE INTO documents VALUES(?,?,?,?,?,?,?)').run(p.id,p.case_id,p.title,p.type,p.relative_path,p.extension,p.created_at);this.db.prepare('DELETE FROM pending_documents WHERE id=?').run(p.id);this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}
      }catch(e){issues.push({id:p.id,title:p.title,message:e.message});}
    }return issues;
  }
  safety(){return{schemaVersion:CURRENT_SCHEMA,workspaceId:this.db.prepare("SELECT value FROM settings WHERE key='workspaceId'").get().value,appVersion:this.options.appVersion,recoveryFolder:this.root+'.lexo-recovery',latestRecoverySnapshot:this.lastRecoverySnapshot||latestSnapshot(this.root),pendingRecovery:this.pendingRecovery||[],recoveryNotice:this.recoveryNotice||null};}
  preferences(){return Object.fromEntries(this.db.prepare('SELECT * FROM settings').all().map(x=>[x.key,x.value]));}
  state({fileStats=true}={}) {
    const documents=this.db.prepare('SELECT * FROM documents ORDER BY created_at DESC').all().map(d=>{
      if(!fileStats)return{...d,size:null,modified_at:d.created_at,missing:false};
      try{const stat=fs.statSync(inside(this.root,d.relative_path));return{...d,size:stat.size,modified_at:stat.mtime.toISOString(),missing:false};}catch{return{...d,missing:true};}
    });
    const custom=new Map();for(const v of this.db.prepare('SELECT * FROM field_values').all()){if(!custom.has(v.case_id))custom.set(v.case_id,{});custom.get(v.case_id)[v.field_id]=v.number_value??v.bool_value??v.date_value??v.text_value;}
    return{cases:this.db.prepare('SELECT * FROM cases ORDER BY updated_at DESC').all().map(c=>({...c,custom:custom.get(c.id)||{}})),documents,
      fields:this.db.prepare('SELECT * FROM fields ORDER BY rowid').all().map(f=>({...f,choices:JSON.parse(f.choices)})),branches:this.db.prepare('SELECT b.*,d.ifsc,d.city,d.state,d.address,d.branch_name,d.source,d.source_version FROM branches b LEFT JOIN branch_directory_details d ON d.branch_id=b.id ORDER BY b.bank,b.name').all(),
      options:{statuses:[],documentTypes:[],banks:[],...Object.fromEntries(['statuses','documentTypes','banks'].map(k=>[k,this.db.prepare('SELECT value FROM options WHERE kind=? ORDER BY value').all(k).map(x=>x.value)]))},safety:this.safety(),settings:this.preferences(),libraryPath:this.root};
  }
  setting(k,v) { this.db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k,v); }
  savePreferences(input){
    const firmName=text(input.firmName,120),workspaceName=text(input.workspaceName,120),theme=text(input.theme,20);
    if(!firmName||!workspaceName)throw Error('Firm and workspace names are required.');
    if(!['light','dark','system'].includes(theme))throw Error('Select a valid appearance.');
    this.db.exec('BEGIN');try{for(const[k,v]of Object.entries({firmName,workspaceName,theme,setupComplete:'true'}))this.setting(k,v);this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  addBranch(bank,name){
    bank=this.canonicalOption('banks',bank);name=cleanChoice(name);if(!name||!bank)throw Error('Choose a bank and enter a branch name.');
    const existing=this.db.prepare('SELECT name FROM branches WHERE bank=? ORDER BY rowid').all(bank).find(b=>choiceKey(b.name)===choiceKey(name));if(existing)return existing.name;
    this.db.prepare('INSERT OR IGNORE INTO branches VALUES(?,?,?)').run(crypto.randomUUID(),bank,name);
    return name;
  }
  directoryBankCode(bank){const canonical=this.canonicalOption('banks',bank);return canonical?this.db.prepare('SELECT code FROM bank_directory_links WHERE bank=?').get(canonical)?.code:null;}
  importDirectoryBank(record){
    if(!record||!/^[A-Z0-9]{4}$/.test(record.code)||typeof record.name!=='string'||!record.name.trim())throw Error('Invalid directory bank.');
    const linked=this.db.prepare('SELECT bank FROM bank_directory_links WHERE code=?').get(record.code);if(linked)return linked.bank;
    const sourceName=record.name.trim();let display=sourceName.length<=100?sourceName:`${sourceName.slice(0,90)} (${record.code})`;const sameName=this.canonicalOption('banks',display);if(sameName&&this.directoryBankCode(sameName)&&this.directoryBankCode(sameName)!==record.code)display=`${sourceName.slice(0,90)} (${record.code})`;
    this.db.exec('SAVEPOINT directory_bank');try{const bank=this.addOption('banks',display);const old=this.directoryBankCode(bank);if(old&&old!==record.code)throw Error('This bank name is linked to a different directory bank.');this.db.prepare('INSERT OR REPLACE INTO bank_directory_links VALUES(?,?,?)').run(bank,record.code,sourceName);this.db.exec('RELEASE directory_bank');return bank;}catch(e){this.db.exec('ROLLBACK TO directory_bank; RELEASE directory_bank');throw e;}
  }
  importDirectoryBranch(record,bank,version){
    bank=this.canonicalOption('banks',bank);if(!bank||!record||!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(record.ifsc)||!/^[A-Z0-9]{4}$/.test(record.bank_code))throw Error('Choose a valid bank and directory branch.');
    const linked=this.db.prepare('SELECT bank FROM bank_directory_links WHERE code=?').get(record.bank_code);if(linked&&linked.bank!==bank)throw Error(`Select ${linked.bank} to use this branch.`);
    const existing=this.db.prepare('SELECT b.* FROM branches b JOIN branch_directory_details d ON d.branch_id=b.id WHERE d.ifsc=?').get(record.ifsc);if(existing){if(existing.bank!==bank)throw Error(`This IFSC belongs to ${existing.bank} in your firm list.`);return existing.name;}
    this.db.exec('SAVEPOINT directory_branch');try{
      const old=this.directoryBankCode(bank);if(old&&old!==record.bank_code)throw Error('This branch does not belong to the selected bank.');
      this.db.prepare('INSERT OR IGNORE INTO bank_directory_links VALUES(?,?,?)').run(bank,record.bank_code,record.bank_name);
      const name=this.addBranch(bank,record.label),branch=this.db.prepare('SELECT id FROM branches WHERE bank=? AND name=?').get(bank,name);
      this.db.prepare('INSERT INTO branch_directory_details VALUES(?,?,?,?,?,?,?,?,?)').run(branch.id,record.ifsc,record.bank_code,record.branch,record.city,record.state,record.address,'Razorpay IFSC',String(version));
      this.db.exec('RELEASE directory_branch');return name;
    }catch(e){this.db.exec('ROLLBACK TO directory_branch; RELEASE directory_branch');throw e;}
  }
  canonicalOption(kind,value){const key=choiceKey(text(value,100));return this.db.prepare('SELECT value FROM options WHERE kind=? ORDER BY rowid').all(kind).find(o=>choiceKey(o.value)===key)?.value;}
  addFieldChoice(id,value){
    const field=this.db.prepare("SELECT * FROM fields WHERE id=? AND type='select' AND archived=0").get(text(id));if(!field)throw Error('Dropdown field not found.');
    value=cleanChoice(value);if(!value)throw Error('Enter an option name.');const choices=JSON.parse(field.choices),existing=choices.find(o=>choiceKey(o)===choiceKey(value));if(existing)return existing;
    if(choices.length>=100)throw Error('Use at most 100 dropdown options.');choices.push(value);this.db.prepare('UPDATE fields SET choices=? WHERE id=?').run(JSON.stringify(choices),id);return value;
  }
  removeOption(kind,value){
    if(!['statuses','documentTypes','banks'].includes(kind))throw Error('Unknown list.');
    const table=kind==='documentTypes'?'documents':'cases',column=kind==='documentTypes'?'type':kind==='banks'?'bank':'status';
    if(this.db.prepare(`SELECT 1 FROM ${table} WHERE ${column}=?`).get(text(value,100)))throw Error('This option is used by a record and cannot be removed.');
    if(kind==='banks'&&this.db.prepare('SELECT 1 FROM branches WHERE bank=?').get(value))throw Error('Remove this bank’s unused branches first.');
    this.db.prepare('DELETE FROM options WHERE kind=? AND value=?').run(kind,value);
    if(kind==='banks')this.db.prepare('DELETE FROM bank_directory_links WHERE bank=?').run(value);
  }
  removeBranch(id){const b=this.db.prepare('SELECT * FROM branches WHERE id=?').get(text(id));if(!b)throw Error('Branch not found.');if(this.db.prepare('SELECT 1 FROM cases WHERE bank=? AND branch=?').get(b.bank,b.name))throw Error('This branch is used by a case.');this.db.prepare('DELETE FROM branch_directory_details WHERE branch_id=?').run(id);this.db.prepare('DELETE FROM branches WHERE id=?').run(id);}
  saveField(input){
    const label=text(input.label,100),type=text(input.type,20),types=['text','longtext','number','currency','date','select','checkbox'];
    if(!label||!types.includes(type))throw Error('Enter a label and choose a field type.');
    if(['case name','client','bank','branch','status','notes','created','created at','reference','case reference'].includes(label.toLowerCase()))throw Error('This name is already used by a built-in case field.');
    const previous=input.id?JSON.parse(this.db.prepare('SELECT choices FROM fields WHERE id=?').get(input.id)?.choices||'[]'):[];
    const choices=[];if(type==='select')for(const value of (input.choices||[]).map(cleanChoice).filter(Boolean)){if(!choices.some(c=>choiceKey(c)===choiceKey(value)))choices.push(previous.find(p=>choiceKey(p)===choiceKey(value))||value);}
    if(type==='select'&&!choices.length)throw Error('Add at least one dropdown option.');
    if(choices.length>100)throw Error('Use at most 100 dropdown options.');
    const id=input.id||crypto.randomUUID(),old=input.id&&this.db.prepare('SELECT * FROM fields WHERE id=?').get(input.id);
    if(input.id&&!old)throw Error('Field not found.');
    if(old){
      const used=this.db.prepare('SELECT * FROM field_values WHERE field_id=?').all(id);
      if(used.length&&old.type!==type)throw Error('A field with saved values cannot change type.');
      if(type==='select'&&used.some(v=>v.text_value&&!choices.includes(v.text_value)))throw Error('Keep dropdown options already used by cases.');
    }
    try{this.db.prepare('INSERT INTO fields(id,label,type,choices,required,searchable,filterable) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET label=excluded.label,type=excluded.type,choices=excluded.choices,required=excluded.required,searchable=excluded.searchable,filterable=excluded.filterable').run(id,label,type,JSON.stringify(choices),input.required?1:0,input.searchable?1:0,input.filterable?1:0);}catch(e){if(e.message.includes('UNIQUE'))throw Error('A field with this name already exists.');throw e;}return id;
  }
  archiveField(id,archived){const result=this.db.prepare('UPDATE fields SET archived=? WHERE id=?').run(archived?1:0,text(id));if(!result.changes)throw Error('Field not found.');}
  customValues(input,caseId){
    const rows=[];
    for(const f of this.db.prepare('SELECT * FROM fields WHERE archived=0').all()){
      const v=input[f.id];const empty=v===undefined||v===null||v==='';
      if(empty){if(f.required)throw Error(`${f.label} is required.`);continue;}
      let str=null,num=null,dt=null,bool=null;
      if(['number','currency'].includes(f.type)){if((typeof v!=='number'&&typeof v!=='string')||!Number.isFinite(Number(v)))throw Error(`${f.label} must be a number.`);num=Number(v);}
      else if(f.type==='checkbox'){if(![true,false,0,1].includes(v))throw Error(`${f.label} must be checked or unchecked.`);bool=v?1:0;if(f.required&&!bool)throw Error(`${f.label} must be checked.`);}
      else if(f.type==='date'){dt=text(v,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(dt)||!Number.isFinite(Date.parse(dt))||new Date(dt).toISOString().slice(0,10)!==dt)throw Error(`${f.label} must be a valid date.`);}
      else{str=text(v,f.type==='longtext'?20000:2000);if(f.required&&!str)throw Error(`${f.label} is required.`);if(f.type==='select'){str=JSON.parse(f.choices).find(option=>choiceKey(option)===choiceKey(str));if(!str)throw Error(`Choose a valid ${f.label}.`);}}
      rows.push([caseId,f.id,str,num,dt,bool]);
    }
    return rows;
  }
  relocateRoot(destination,{onSwitch}={}){
    destination=path.resolve(text(destination,1000));if(destination===this.root)return;
    if(destination.startsWith(this.root+path.sep)||this.root.startsWith(destination+path.sep))throw Error('Choose a separate workspace folder.');
    if(fs.existsSync(destination)&&fs.readdirSync(destination).length)throw Error('Choose an empty folder for this workspace.');
    const previous=this.root,previousLease=this.lease,targetLease=acquireLease(destination);let switched=false;
    try{
      fs.mkdirSync(destination,{recursive:true});this.db.prepare('VACUUM INTO ?').run(path.join(destination,'lexo.sqlite'));
      const copied=[];for(const relative of caseFiles(previous)){const source=safePath(previous,relative),data=fs.readFileSync(source);atomicWrite(safePath(destination,relative),data,{replace:false});copied.push({relative,digest:hash(data)});}
      for(const d of this.db.prepare('SELECT relative_path FROM documents').all())if(!fs.existsSync(safePath(destination,d.relative_path)))throw Error('A registered document is missing. Recover it before changing folders.');
      for(const c of copied)if(hash(fs.readFileSync(safePath(previous,c.relative)))!==c.digest||hash(fs.readFileSync(safePath(destination,c.relative)))!==c.digest)throw Error('A document changed while copying. Save and close Word, then retry.');
      inspect(path.join(destination,'lexo.sqlite'),this.options.appVersion);this.db.close();this.db=null;this.root=destination;this.lease=targetLease;switched=true;this.open({recover:false,keepLeaseOnError:true});onSwitch?.();previousLease.release();
    }catch(e){if(switched){try{this.db?.close();}catch{}this.db=null;targetLease.release();this.root=previous;this.lease=previousLease;this.open({recover:false});}else targetLease.release();throw Error('Workspace was not changed; the original library is preserved. '+e.message);}
  }
  addOption(kind,value) {
    if (!['statuses','documentTypes','banks'].includes(kind)) throw Error('Unknown list.');
    value=cleanChoice(value); if(!value) throw Error('Enter a name.');
    const existing=this.canonicalOption(kind,value);if(existing)return existing;
    this.db.prepare('INSERT OR IGNORE INTO options VALUES(?,?)').run(kind,value);
    return value;
  }
  getCase(id) { const c=this.db.prepare('SELECT * FROM cases WHERE id=?').get(text(id)); if(!c) throw Error('Case not found.'); return c; }
  saveCase(input) {
    const c=Object.fromEntries(['name','client','bank','branch','status','notes'].map(k=>[k,text(input[k]??'',k==='notes'?20000:500)]));
    if(!c.name || !c.bank || !c.branch || !c.status) throw Error('Case name, bank, branch and status are required.');
    c.status=this.canonicalOption('statuses',c.status);if(!c.status)throw Error('Choose a status from the firm list.');
    if(c.bank){c.bank=this.canonicalOption('banks',c.bank);if(!c.bank)throw Error('Choose a bank from the firm list.');}
    if(c.branch){const matched=c.bank&&this.db.prepare('SELECT name FROM branches WHERE bank=?').all(c.bank).find(b=>choiceKey(b.name)===choiceKey(c.branch));if(!matched)throw Error('Choose a branch belonging to the selected bank.');c.branch=matched.name;}
    const now=new Date().toISOString(), id=input.id||crypto.randomUUID();
    const values=input.custom===undefined&&input.id?null:this.customValues(input.custom||{},id);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if(input.id) { this.getCase(input.id); this.db.prepare('UPDATE cases SET name=?,client=?,bank=?,branch=?,status=?,notes=?,updated_at=? WHERE id=?').run(...Object.values(c),now,input.id); }
      else {
        const n=Number(this.db.prepare('SELECT COUNT(*) AS n FROM cases').get().n)+1;
        const ref=`LEX-${String(n).padStart(4,'0')}`;
        this.db.prepare('INSERT INTO cases(id,reference,name,client,bank,branch,status,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,ref,...Object.values(c),now,now);
        this.db.prepare('INSERT INTO case_folders VALUES(?,?)').run(id,`cases/${ref} - ${readable(c.name)} - ${id.slice(0,8)}`);
      }
      if(values){this.db.prepare('DELETE FROM field_values WHERE case_id=? AND field_id IN(SELECT id FROM fields WHERE archived=0)').run(id);for(const row of values)this.db.prepare('INSERT INTO field_values VALUES(?,?,?,?,?,?)').run(...row);}
      this.db.exec('COMMIT'); return id;
    } catch(e) { this.db.exec('ROLLBACK'); throw e; }
  }
  archiveCase(id, archived) { this.getCase(id); this.db.prepare('UPDATE cases SET archived=?,updated_at=? WHERE id=?').run(archived?1:0,new Date().toISOString(),id); }
  setCaseStatus(id,value){const c=this.getCase(id),status=this.canonicalOption('statuses',value);if(!status)throw Error('Choose a status from the firm list.');this.db.prepare('UPDATE cases SET status=?,updated_at=? WHERE id=?').run(status,new Date().toISOString(),c.id);return status;}
  documentPath(id) { const d=this.db.prepare('SELECT * FROM documents WHERE id=?').get(text(id)); if(!d) throw Error('Document not found.'); return inside(this.root,d.relative_path); }
  async addDocument(caseId,title,type,extension,buffer) {
    this.getCase(caseId); title=text(title,200);type=text(type,100);
    if(!title || !type || !['.pdf','.docx'].includes(extension)) throw Error('Use a PDF or DOCX document and provide a title and type.');
    if(buffer.length>100*1024*1024) throw Error('Documents must be smaller than 100 MB.');
    if(extension==='.pdf' && !buffer.subarray(0,1024).includes(Buffer.from('%PDF-'))) throw Error('This file is not a valid PDF.');
    if(extension==='.docx') { let entries; try { entries=unzipSync(buffer,{filter:f=>f.name==='word/document.xml'||f.name==='[Content_Types].xml'}); } catch { throw Error('This file is not a valid DOCX.'); } if(!entries['word/document.xml']||!entries['[Content_Types].xml']) throw Error('This file is not a Word document.'); }
    type=this.canonicalOption('documentTypes',type);if(!type)throw Error('Choose a document type from the firm list.');
    const folder=this.db.prepare('SELECT relative_path FROM case_folders WHERE case_id=?').get(caseId)?.relative_path||`cases/${caseId}`;
    const id=crypto.randomUUID(), relative=`${folder}/documents/${readable(title)} - ${id.slice(0,8)}${extension}`, target=inside(this.root,relative);
    const createdAt=new Date().toISOString(),tempRelative=relative+'.pending-'+id;
    this.db.prepare('INSERT INTO pending_documents VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,caseId,title,type,relative,tempRelative,extension,createdAt,hash(buffer),buffer.length);
    atomicWrite(target,buffer,{replace:false,tempFile:safePath(this.root,tempRelative)});
    this.db.exec('BEGIN IMMEDIATE');try{this.db.prepare('INSERT INTO documents VALUES(?,?,?,?,?,?,?)').run(id,caseId,title,type,relative,extension,createdAt);this.db.prepare('DELETE FROM pending_documents WHERE id=?').run(id);this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw Error('The document file was preserved. Lexo will retry its registration on the next launch. '+e.message);}
    return id;
  }
  async createDocument(caseId,title,type) {
    const c=this.getCase(caseId);
    const doc=new Document({sections:[{children:[new Paragraph({text:title,heading:HeadingLevel.TITLE}),new Paragraph(`Case: ${c.name}`),new Paragraph(`Reference: ${c.reference}`),new Paragraph(`Client: ${c.client}`),new Paragraph(''),new Paragraph('')]}]});
    return this.addDocument(caseId,title,type,'.docx',await Packer.toBuffer(doc));
  }
  async importDocument(caseId,file,type) {
    return this.addDocument(caseId,path.basename(file,path.extname(file)),type,path.extname(file).toLowerCase(),await fs.promises.readFile(file));
  }
  async backup(destination,password) {
    if(typeof password!=='string'||password.length<12) throw Error('Use a backup password of at least 12 characters.');
    const resolved=path.resolve(destination); if(resolved===this.root || resolved.startsWith(this.root+path.sep)) throw Error('Choose a backup folder outside the live library.');
    fs.mkdirSync(resolved,{recursive:true});
    const scratch=path.join(path.dirname(this.root),`snapshot-${crypto.randomUUID()}.sqlite`);
    try {
      this.db.prepare('VACUUM INTO ?').run(scratch);
      const entries={'lexo.sqlite':fs.readFileSync(scratch)};
      for(const d of this.db.prepare('SELECT relative_path FROM documents').all())if(!fs.existsSync(safePath(this.root,d.relative_path)))throw Error('A registered document is missing. Restore it before backing up.');
      for(const relative of caseFiles(this.root)){const source=safePath(this.root,relative),before=fs.statSync(source),data=fs.readFileSync(source),after=fs.statSync(source);if(before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw Error('A document changed during backup. Save and close Word, then retry.');entries[relative]=data;}
      for(const[name,data]of Object.entries(entries))if(name!=='lexo.sqlite'&&hash(fs.readFileSync(safePath(this.root,name)))!==hash(data))throw Error('A document changed during backup. Save and close Word, then retry.');
      entries['manifest.json']=Buffer.from(JSON.stringify({format:1,createdAt:new Date().toISOString(),files:Object.keys(entries).map(name=>({name,sha256:crypto.createHash('sha256').update(entries[name]).digest('hex')}))}));
      const salt=crypto.randomBytes(16), iv=crypto.randomBytes(12), key=crypto.scryptSync(password,salt,32);
      const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
      const encrypted=Buffer.concat([cipher.update(zipSync(entries)),cipher.final()]);
      const output=path.join(resolved,`Lexo-${new Date().toISOString().replace(/[:.]/g,'-')}-${crypto.randomBytes(3).toString('hex')}.lexobak`);
      atomicWrite(output,Buffer.concat([Buffer.from('LEXOBAK1'),salt,iv,cipher.getAuthTag(),encrypted]),{replace:false}); this.setting('lastBackup',new Date().toISOString()); return output;
    } finally { if(fs.existsSync(scratch)) fs.unlinkSync(scratch); }
  }
  restore(file,password) {
    const data=fs.readFileSync(file); if(data.subarray(0,8).toString()!=='LEXOBAK1') throw Error('Not a Lexo backup.');
    let entries;
    try { const decipher=crypto.createDecipheriv('aes-256-gcm',crypto.scryptSync(password,data.subarray(8,24),32),data.subarray(24,36)); decipher.setAuthTag(data.subarray(36,52)); entries=unzipSync(Buffer.concat([decipher.update(data.subarray(52)),decipher.final()])); } catch { throw Error('Incorrect password or damaged backup.'); }
    const manifest=JSON.parse(Buffer.from(entries['manifest.json']||[]).toString());
    if(manifest.format!==1||!Array.isArray(manifest.files)||!entries['lexo.sqlite']) throw Error('Unsupported backup format.');
    const stage=this.root+'-restore-'+crypto.randomUUID(), previous=this.root+'-before-restore-'+crypto.randomUUID(); fs.mkdirSync(stage);
    let check;
    try {
      for(const item of manifest.files) {
        const parts=typeof item.name==='string'?item.name.split('/'):[];
        if(item.name!=='lexo.sqlite'&&!(parts.length>=3&&parts[0]==='cases'&&parts.every(p=>p&&p!=='.'&&p!=='..'&&!/[\\:\x00]/.test(p)))) throw Error('Invalid backup entry.');
        if(!entries[item.name]||crypto.createHash('sha256').update(entries[item.name]).digest('hex')!==item.sha256) throw Error('Backup integrity check failed.');
        const target=inside(stage,item.name);fs.mkdirSync(path.dirname(target),{recursive:true});atomicWrite(target,entries[item.name],{replace:false});
      }
      check=new DatabaseSync(path.join(stage,'lexo.sqlite'),{readOnly:true});
      if(check.prepare('PRAGMA integrity_check').get().integrity_check!=='ok') throw Error('Backup database is damaged.');
      if(![1,2,3,CURRENT_SCHEMA].includes(check.prepare('PRAGMA user_version').get().user_version)) throw Error('Unsupported database version.');
      const docs=check.prepare('SELECT relative_path FROM documents').all();
      for(const d of docs) if(!fs.existsSync(inside(stage,d.relative_path))) throw Error('Backup is missing a document.');
      check.prepare('SELECT id,name FROM cases').all(); check.close();check=null;
      inspect(path.join(stage,'lexo.sqlite'),this.options.appVersion);beginRestore(this.root,stage,previous);this.db.close();this.db=null;fs.renameSync(this.root,previous);
      try {fs.renameSync(stage,this.root);this.open({recover:false,keepLeaseOnError:true});this.setting('lastRestore',new Date().toISOString());clearOperation(this.root);}
      catch(e){try{this.db?.close();}catch{}this.db=null;if(fs.existsSync(this.root))fs.renameSync(this.root,this.root+'-failed-'+crypto.randomUUID());fs.renameSync(previous,this.root);this.open({recover:false});clearOperation(this.root);throw e;}
      return previous;
    } finally { if(check) check.close(); if(fs.existsSync(stage)) fs.rmSync(stage,{recursive:true,force:true}); }
  }
}
module.exports={Store,inside};
