const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const{Store}=require('../electron/store.cjs');const{createDocumentWithAI}=require('../electron/codex-case.cjs');const{unzipSync}=require('fflate');
function fixture(t){const folder=fs.mkdtempSync(path.join(os.tmpdir(),'lexo-ai-doc-')),store=new Store(path.join(folder,'firm'));store.addOption('banks','Demo Bank');store.addBranch('Demo Bank','Main');const caseId=store.saveCase({name:'AI test case',bank:'Demo Bank',branch:'Main',status:'Active'});t.after(()=>{store.close();fs.rmSync(folder,{recursive:true,force:true});});return{store,caseId};}
test('AI document is a registered valid DOCX before handing off its exact path and instructions',async t=>{
 const{store,caseId}=fixture(t);let called=0;
 const result=await createDocumentWithAI(store,{caseId,title:'Requested draft',type:'General',instructions:'Draft using the case notes. Include unanswered questions.'},async link=>{
  called++;const url=new URL(link),folder=url.searchParams.get('path'),prompt=url.searchParams.get('prompt'),context=JSON.parse(fs.readFileSync(path.join(folder,'.lexo/case-context.json'))),doc=context.documents[0];
  assert.equal(store.state().documents.length,1);assert.match(prompt,/editing that target DOCX in place/);assert.equal(doc.title,'Requested draft');assert.equal(doc.available,true);
  const request=JSON.parse(fs.readFileSync(path.join(folder,'.lexo/requests',doc.id+'.json')));assert.equal(request.document,doc.path);assert.equal(request.instructions,'Draft using the case notes. Include unanswered questions.');assert.ok(unzipSync(fs.readFileSync(path.join(folder,request.document)))['word/document.xml']);
 });assert.equal(called,1);assert.ok(result.id);assert.equal(result.warning,undefined);
});
test('failed Codex handoff preserves one registered document and its drafting request',async t=>{
 const{store,caseId}=fixture(t);const result=await createDocumentWithAI(store,{caseId,title:'Saved draft',type:'General'},async()=>{throw Error('No handler');});assert.ok(result.warning);assert.equal(store.state().documents.length,1);assert.ok(fs.existsSync(store.documentPath(result.id)));const contextFolder=path.dirname(path.dirname(store.documentPath(result.id)));assert.ok(fs.existsSync(path.join(contextFolder,'.lexo/requests',result.id+'.json')));
});
test('invalid AI requests do not create documents or dispatch Codex',async t=>{
 const{store,caseId}=fixture(t);let calls=0;await assert.rejects(createDocumentWithAI(store,{caseId,title:'Draft',type:'General',instructions:'x'.repeat(4001)},()=>{calls++;}),/4,000/);assert.equal(calls,0);assert.equal(store.state().documents.length,0);
});
