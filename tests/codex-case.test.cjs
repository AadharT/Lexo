const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const{Store}=require('../electron/store.cjs');const{prepareCodexCase,codexCaseUrl}=require('../electron/codex-case.cjs');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'lexo-codex-')),store=new Store(path.join(root,'firm'));store.savePreferences({firmName:'Test Firm',workspaceName:'Local cases',theme:'dark'});store.addOption('banks','Test Bank');store.addBranch('Test Bank','Main');const id=store.saveCase({name:'Case & special names',bank:'Test Bank',branch:'Main',status:'Active',client:'Sample client'});t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});return{root,store,id};}
test('prepares only the selected case and opens a correctly encoded local-workspace link',async t=>{
 const{store,id}=fixture(t),second=store.saveCase({name:'Another matter',bank:'Test Bank',branch:'Main',status:'Active'}),field=store.saveField({label:'Claim value',type:'currency',searchable:true});
 store.saveCase({...store.getCase(id),custom:{[field]:12345}});const doc=await store.createDocument(id,'Original evidence','General'),original=fs.readFileSync(store.documentPath(doc));
 const result=prepareCodexCase(store,id),url=new URL(result.url),context=JSON.parse(fs.readFileSync(path.join(result.folder,'.lexo/case-context.json')));
 assert.equal(url.protocol,'codex:');assert.equal(url.hostname,'threads');assert.equal(url.pathname,'/new');assert.equal(url.searchParams.get('path'),result.folder);assert.equal(url.searchParams.has('prompt'),false);
 assert.equal(context.case.id,id);assert.equal(context.fields[0].value,12345);assert.equal(context.documents.length,1);assert.equal(context.documents[0].id,doc);assert.equal(context.documents[0].available,true);assert.equal(context.firm,'Test Firm');
 assert.ok(fs.existsSync(path.join(result.folder,'AGENTS.md')));assert.ok(fs.existsSync(path.join(result.folder,'MEMORY.md')));assert.ok(fs.existsSync(path.join(result.folder,'.agents/skills')));
 assert.deepEqual(fs.readFileSync(store.documentPath(doc)),original);const other=store.db.prepare('SELECT relative_path FROM case_folders WHERE case_id=?').get(second).relative_path;assert.equal(fs.existsSync(path.join(store.root,other)),false);
 assert.throws(()=>prepareCodexCase(store,'not-a-case'),/Case not found/);
});
test('reopening refreshes case facts but preserves instructions, memories, skills and original paths',t=>{
 const{store,id}=fixture(t),first=prepareCodexCase(store,id);fs.writeFileSync(path.join(first.folder,'AGENTS.md'),'Firm-specific instructions');fs.writeFileSync(path.join(first.folder,'MEMORY.md'),'Confirmed conversation decisions');fs.mkdirSync(path.join(first.folder,'.agents/skills/custom'));fs.writeFileSync(path.join(first.folder,'.agents/skills/custom/SKILL.md'),'Existing custom skill');
 store.saveCase({...store.getCase(id),name:'Renamed case',notes:'Updated Lexo details'});const again=prepareCodexCase(store,id);assert.equal(again.folder,first.folder);
 assert.equal(fs.readFileSync(path.join(again.folder,'AGENTS.md'),'utf8'),'Firm-specific instructions');assert.equal(fs.readFileSync(path.join(again.folder,'MEMORY.md'),'utf8'),'Confirmed conversation decisions');assert.equal(fs.readFileSync(path.join(again.folder,'.agents/skills/custom/SKILL.md'),'utf8'),'Existing custom skill');assert.equal(JSON.parse(fs.readFileSync(path.join(again.folder,'.lexo/case-context.json'))).case.notes,'Updated Lexo details');
});
test('legacy UUID case folders retain their existing documents and locations',async t=>{
 const{store,id}=fixture(t);store.db.prepare('DELETE FROM case_folders WHERE case_id=?').run(id);const doc=await store.createDocument(id,'Legacy document','General'),original=store.documentPath(doc);
 const prepared=prepareCodexCase(store,id);assert.equal(prepared.folder,path.join(store.root,'cases',id));assert.equal(store.documentPath(doc),original);assert.ok(fs.existsSync(original));
});
test('preserves foreign context files and refuses linked case context directories',t=>{
 const{root,store,id}=fixture(t),prepared=prepareCodexCase(store,id),file=path.join(prepared.folder,'.lexo/case-context.json');const context=JSON.parse(fs.readFileSync(file));context.case.id='another-case';fs.writeFileSync(file,JSON.stringify(context));const original=fs.readFileSync(file);
 assert.throws(()=>prepareCodexCase(store,id),/preserved/);assert.deepEqual(fs.readFileSync(file),original);
 fs.rmSync(path.join(prepared.folder,'.lexo'),{recursive:true});const outside=path.join(root,'outside');fs.mkdirSync(outside);fs.symlinkSync(outside,path.join(prepared.folder,'.lexo'),process.platform==='win32'?'junction':'dir');assert.throws(()=>prepareCodexCase(store,id),/symbolic links/);assert.equal(fs.readdirSync(outside).length,0);
});
test('case context, memory and custom skills survive encrypted backup and restore',async t=>{
 const{root,store,id}=fixture(t),prepared=prepareCodexCase(store,id);fs.writeFileSync(path.join(prepared.folder,'MEMORY.md'),'Preserve case memory');fs.writeFileSync(path.join(prepared.folder,'drafts/notes.md'),'Draft notes');
 const backup=await store.backup(path.join(root,'backups'),'sample backup password');fs.writeFileSync(path.join(prepared.folder,'MEMORY.md'),'Later edits');store.restore(backup,'sample backup password');const restored=prepareCodexCase(store,id);assert.equal(fs.readFileSync(path.join(restored.folder,'MEMORY.md'),'utf8'),'Preserve case memory');assert.equal(fs.readFileSync(path.join(restored.folder,'drafts/notes.md'),'utf8'),'Draft notes');assert.ok(fs.existsSync(path.join(restored.folder,'.agents/skills/README.md')));
});
test('deep links handle Unicode, spaces and shell metacharacters without adding parameters',()=>{
 const folder=path.resolve('Sample & legal # case ? ए'),url=new URL(codexCaseUrl(folder));assert.equal(url.searchParams.size,1);assert.equal(url.searchParams.get('path'),folder);assert.throws(()=>codexCaseUrl('relative-case'),/absolute/);
});
