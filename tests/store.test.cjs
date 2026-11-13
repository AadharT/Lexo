const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {Store,inside}=require('../electron/store.cjs');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lexo-test-'));const store=new Store(path.join(dir,'library'));store.addOption('banks','Example Bank');store.addBranch('Example Bank','Pune');t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});return {store,dir};}
const sample={name:'Recovery matter',client:'Example client',bank:'Example Bank',branch:'Pune',status:'Active',notes:'Initial review'};
test('cases persist, automatic references are unique, custom statuses and archive preserve documents',async t=>{
 const {store}=fixture(t);const id=store.saveCase(sample);const second=store.saveCase({...sample,name:'Another matter'});
 assert.notEqual(store.getCase(id).reference,store.getCase(second).reference);
 const doc=await store.createDocument(id,'Legal notice','Legal notice');const originalPath=store.documentPath(doc);
 store.addOption('statuses','Awaiting bank response');store.saveCase({...sample,id,name:'Renamed matter',status:'Awaiting bank response'});
 assert.equal(store.documentPath(doc),originalPath);assert.ok(store.state().options.statuses.includes('Awaiting bank response'));
 store.archiveCase(id,true);assert.equal(store.getCase(id).archived,1);assert.ok(fs.existsSync(originalPath));
 store.close();store.open();assert.equal(store.getCase(id).name,'Renamed matter');
});
test('banks and branches enforce firm lists and correct bank relationships',t=>{
 const {store}=fixture(t);store.addOption('banks','Other Bank');store.addBranch('Other Bank','Delhi');
 assert.throws(()=>store.saveCase({...sample,bank:'Unknown'}),/firm list/);
 assert.throws(()=>store.saveCase({...sample,branch:'Delhi'}),/belonging/);
 assert.throws(()=>store.saveCase({...sample,status:'Invented'}),/firm list/);
 const id=store.saveCase(sample);assert.throws(()=>store.removeOption('banks','Example Bank'),/used/);
 const branch=store.state().branches.find(b=>b.name==='Pune');assert.throws(()=>store.removeBranch(branch.id),/used/);
 assert.equal(store.getCase(id).branch,'Pune');
});
test('case creation requires bank and branch while client may be empty',t=>{
 const{store}=fixture(t);assert.throws(()=>store.saveCase({...sample,bank:''}),/bank, branch/);assert.throws(()=>store.saveCase({...sample,branch:''}),/bank, branch/);assert.throws(()=>store.saveCase({...sample,bank:' ',branch:' '}),/required/);
 const id=store.saveCase({...sample,client:''});assert.equal(store.getCase(id).client,'');store.saveCase({...sample,id,client:''});assert.equal(store.getCase(id).client,'');
});
test('firm choices reuse canonical spelling regardless of case, Unicode width and repeated spaces',async t=>{
 const{store}=fixture(t);assert.equal(store.addOption('banks','  EXAMPLE   bank  '),'Example Bank');assert.equal(store.addBranch('example bank','  pUNE  '),'Pune');
 store.addOption('banks','HDFC Bank');assert.equal(store.addOption('banks','ＨＤＦＣ bank'),'HDFC Bank');
 assert.equal(store.addOption('documentTypes','LEGAL   NOTICE'),'Legal notice');assert.equal(store.addOption('statuses','active'),'Active');
 const id=store.saveCase({...sample,bank:'example BANK',branch:'PUNE',status:'aCtIvE'});const c=store.getCase(id);assert.equal(c.bank,'Example Bank');assert.equal(c.branch,'Pune');assert.equal(c.status,'Active');
 await store.createDocument(id,'Notice','legal   notice');assert.equal(store.state().documents[0].type,'Legal notice');
 assert.equal(store.state().options.banks.filter(v=>v.toLowerCase().includes('example')).length,1);assert.equal(store.state().branches.length,1);
 store.addBranch('HDFC Bank','Pune');assert.equal(store.state().branches.length,2);
});
test('custom dropdown choices can be created inline and never duplicate case variants',t=>{
 const{store}=fixture(t);const field=store.saveField({label:'Priority',type:'select',choices:['Urgent',' urgent ','Normal'],searchable:true});
 assert.deepEqual(store.state().fields[0].choices,['Urgent','Normal']);assert.equal(store.addFieldChoice(field,'URGENT'),'Urgent');assert.equal(store.addFieldChoice(field,'Needs   review'),'Needs review');assert.equal(store.addFieldChoice(field,'needs review'),'Needs review');
 const id=store.saveCase({...sample,custom:{[field]:'nEeDs   Review'}});assert.equal(store.state().cases.find(c=>c.id===id).custom[field],'Needs review');assert.equal(store.state().fields[0].choices.length,3);
});
test('typed custom fields validate required values and round trip through SQLite',t=>{
 const{store}=fixture(t);
 const amount=store.saveField({label:'Claim amount',type:'currency',required:true,searchable:true,filterable:true});
 const stage=store.saveField({label:'Stage',type:'select',choices:['Intake','Filed'],searchable:true,filterable:true});
 const hearing=store.saveField({label:'Hearing',type:'date'});
 const verified=store.saveField({label:'Verified',type:'checkbox'});
 assert.throws(()=>store.saveCase(sample),/Claim amount is required/);
 assert.throws(()=>store.saveCase({...sample,custom:{[amount]:'abc'}}),/number/);
 assert.throws(()=>store.saveCase({...sample,custom:{[amount]:100,[stage]:'Unknown'}}),/valid Stage/);
 assert.throws(()=>store.saveCase({...sample,custom:{[amount]:100,[hearing]:'2026-02-30'}}),/valid date/);
 const id=store.saveCase({...sample,custom:{[amount]:'1250000.50',[stage]:'Filed',[hearing]:'2026-12-01',[verified]:false}});
 const row=store.state().cases.find(c=>c.id===id);assert.equal(row.custom[amount],1250000.5);assert.equal(row.custom[verified],0);assert.equal(row.custom[stage],'Filed');
 assert.throws(()=>store.saveField({id:amount,label:'Claim amount',type:'text'}),/cannot change type/);
 assert.throws(()=>store.saveField({id:stage,label:'Stage',type:'select',choices:['Intake']}),/already used/);
 store.archiveField(amount,true);store.saveCase({...sample,id,custom:{[stage]:'Intake'}});assert.equal(store.state().cases.find(c=>c.id===id).custom[amount],1250000.5);
 store.close();store.open();assert.equal(store.state().fields.length,4);
});
test('removed defaults stay removed after reopening and field labels cannot shadow core fields',t=>{
 const{store}=fixture(t);store.removeOption('documentTypes','Evidence');store.close();store.open();assert.equal(store.state().options.documentTypes.includes('Evidence'),false);assert.throws(()=>store.saveField({label:'Client',type:'text'}),/built-in/);
});
test('readable case and document paths are Windows safe and backup compatible',async t=>{
 const {store,dir}=fixture(t);const id=store.saveCase({...sample,name:'SBI / Recovery: Mehta?'});
 const document=await store.createDocument(id,'Demand: notice / final?','Legal notice');
 const relative=store.state().documents.find(d=>d.id===document).relative_path;
 assert.match(relative,/cases\/LEX-0001 - SBI Recovery Mehta - [a-f0-9]+\/documents\/Demand notice final - [a-f0-9]+\.docx/);
 const backup=await store.backup(path.join(dir,'backups'),'readable folder password');store.restore(backup,'readable folder password');assert.ok(fs.existsSync(store.documentPath(document)));
});
test('workspace folder selection preserves originals and rejects occupied folders',async t=>{
 const {store,dir}=fixture(t);const id=store.saveCase(sample);const doc=await store.createDocument(id,'Draft','General');const previous=store.root;
 store.savePreferences({firmName:'Mehta & Associates',workspaceName:'Banking',theme:'dark'});
 const occupied=path.join(dir,'occupied');fs.mkdirSync(occupied);fs.writeFileSync(path.join(occupied,'personal.txt'),'keep');assert.throws(()=>store.relocateRoot(occupied),/empty folder/);assert.equal(store.root,previous);
 const next=path.join(dir,'firm-workspace');store.relocateRoot(next);assert.equal(store.root,next);assert.ok(fs.existsSync(path.join(previous,'lexo.sqlite')));assert.ok(fs.existsSync(store.documentPath(doc)));assert.equal(store.state().settings.firmName,'Mehta & Associates');assert.equal(store.state().settings.theme,'dark');
});
test('imports are independent copies; invalid files and path traversal are rejected',async t=>{
 const {store,dir}=fixture(t);const id=store.saveCase(sample);const file=path.join(dir,'order.pdf');
 fs.writeFileSync(file,'%PDF-1.7\nexample');const doc=await store.importDocument(id,file,'Order');fs.unlinkSync(file);
 assert.ok(fs.existsSync(store.documentPath(doc)));await assert.rejects(store.addDocument(id,'bad','General','.pdf',Buffer.from('bad')),/valid PDF/);
 await assert.rejects(store.addDocument(id,'bad','General','.docx',Buffer.from('bad')),/valid DOCX/);
 assert.throws(()=>inside(store.root,'../outside'),/Invalid/);assert.throws(()=>store.saveCase({...sample,name:''}),/required/);
});
test('encrypted backup round-trips database, DOCX edits and lists; wrong password preserves live data',async t=>{
 const {store,dir}=fixture(t);const id=store.saveCase(sample);const doc=await store.createDocument(id,'Draft','General');
 const documentBytes=fs.readFileSync(store.documentPath(doc));const destination=path.join(dir,'drive');
 await assert.rejects(store.backup(destination,'short'),/12 characters/);
 await assert.rejects(store.backup(store.root,'correct horse battery staple'),/outside/);
 const snapshot=await store.backup(destination,'correct horse battery staple');
 const encrypted=fs.readFileSync(snapshot);assert.equal(encrypted.includes(Buffer.from('Recovery matter')),false);
 store.saveCase({...sample,id,name:'Changed after backup'});
 assert.throws(()=>store.restore(snapshot,'wrong password'),/Incorrect password/);assert.equal(store.getCase(id).name,'Changed after backup');
 const recovery=store.restore(snapshot,'correct horse battery staple');assert.ok(fs.existsSync(path.join(recovery,'lexo.sqlite')));
 assert.equal(store.getCase(id).name,sample.name);assert.deepEqual(fs.readFileSync(store.documentPath(doc)),documentBytes);
 assert.equal(store.state().documents.length,1);
});
test('missing managed document blocks backup instead of claiming success',async t=>{
 const {store,dir}=fixture(t);const id=store.saveCase(sample);const doc=await store.createDocument(id,'Draft','General');fs.unlinkSync(store.documentPath(doc));
 assert.equal(store.state().documents[0].missing,true);await assert.rejects(store.backup(path.join(dir,'backups'),'correct horse battery staple'));
 assert.equal(store.state().settings.lastBackup,undefined);
});
