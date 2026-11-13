const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const{DatabaseSync}=require('node:sqlite');
const{atomicWrite,atomicJson,safePath,hash}=require('./durable-io.cjs');
function caseFiles(root){const result=[];function walk(folder){if(!fs.existsSync(folder))return;for(const entry of fs.readdirSync(folder,{withFileTypes:true})){const full=path.join(folder,entry.name);if(entry.isSymbolicLink())throw Error('Workspace case folders cannot contain symbolic links.');if(entry.isDirectory())walk(full);else if(entry.isFile()&&!entry.name.startsWith('~$'))result.push(path.relative(root,full).replaceAll(path.sep,'/'));}}walk(path.join(root,'cases'));return result;}
function checkedCopy(source,destination){const before=fs.statSync(source),data=fs.readFileSync(source),after=fs.statSync(source);if(before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw Error('A document changed during the recovery snapshot. Save and close Word, then retry.');atomicWrite(destination,data,{replace:false});const digest=hash(data);if(hash(fs.readFileSync(destination))!==digest)throw Error('Recovery copy verification failed.');return {sha256:digest,size:data.length};}
function validateDatabase(db){if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw Error('The workspace database failed its integrity check.');if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('The workspace database contains broken references.');}
function createSnapshot(db,root,reason){
 const parent=path.resolve(root)+'.lexo-recovery';fs.mkdirSync(parent,{recursive:true});const folder=path.join(parent,`${new Date().toISOString().replace(/[:.]/g,'-')}-${crypto.randomUUID().slice(0,8)}`),stage=folder+'.partial';fs.mkdirSync(stage);
 try{
  const database=path.join(stage,'lexo.sqlite');db.prepare('VACUUM INTO ?').run(database);const fd=fs.openSync(database,'r+');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  const copy=new DatabaseSync(database,{readOnly:true});try{validateDatabase(copy);const registered=copy.prepare('SELECT relative_path FROM documents').all();for(const d of registered)if(!fs.existsSync(safePath(root,d.relative_path)))throw Error(`A registered document is missing: ${d.relative_path}. Recover it before upgrading.`);}finally{copy.close();}
  const entries=[{name:'lexo.sqlite',sha256:hash(fs.readFileSync(database)),size:fs.statSync(database).size}];
  for(const relative of caseFiles(root))entries.push({name:relative,...checkedCopy(safePath(root,relative),safePath(stage,relative))});
  for(const entry of entries.slice(1))if(hash(fs.readFileSync(safePath(root,entry.name)))!==entry.sha256)throw Error('A document changed during the recovery snapshot. Save and close Word, then retry.');
  const manifest={format:1,createdAt:new Date().toISOString(),reason,schemaVersion:Number(db.prepare('PRAGMA user_version').get().user_version),files:entries};atomicJson(path.join(stage,'snapshot.json'),manifest);fs.renameSync(stage,folder);return folder;
 }catch(e){throw Error(`Recovery snapshot did not complete; the database was not upgraded. ${e.message}`);}
}
function latestSnapshot(root){const folder=path.resolve(root)+'.lexo-recovery';if(!fs.existsSync(folder))return null;return fs.readdirSync(folder).filter(name=>!name.endsWith('.partial')&&fs.existsSync(path.join(folder,name,'snapshot.json'))).sort().at(-1)?path.join(folder,fs.readdirSync(folder).filter(name=>!name.endsWith('.partial')&&fs.existsSync(path.join(folder,name,'snapshot.json'))).sort().at(-1)):null;}
function operationPath(root){return path.resolve(root)+'.lexo-operation.json';}
function beginRestore(root,stage,previous){const journal={format:1,type:'restore',root:path.resolve(root),stage:path.resolve(stage),previous:path.resolve(previous),createdAt:new Date().toISOString()};atomicJson(operationPath(root),journal);return journal;}
function clearOperation(root){const file=operationPath(root);if(fs.existsSync(file))fs.unlinkSync(file);}
function validLibrary(root){if(!fs.existsSync(path.join(root,'lexo.sqlite')))return false;let db;try{db=new DatabaseSync(path.join(root,'lexo.sqlite'),{readOnly:true});validateDatabase(db);db.prepare('SELECT id FROM cases LIMIT 1').get();db.prepare('SELECT id FROM documents LIMIT 1').get();return true;}catch{return false;}finally{db?.close();}}
function recoverRestore(root){
 const file=operationPath(root);if(!fs.existsSync(file))return null;const journal=JSON.parse(fs.readFileSync(file,'utf8')),resolved=path.resolve(root);
 if(journal.format!==1||journal.type!=='restore'||journal.root!==resolved||!journal.stage?.startsWith(resolved+'-restore-')||!journal.previous?.startsWith(resolved+'-before-restore-')||path.dirname(journal.stage)!==path.dirname(resolved)||path.dirname(journal.previous)!==path.dirname(resolved))throw Error('The recovery journal is invalid. No workspace files were changed.');
 if(validLibrary(root)){clearOperation(root);return 'An interrupted restore was completed. The previous library was retained.';}
 if(validLibrary(journal.previous)){if(fs.existsSync(root))fs.renameSync(root,root+'-failed-restore-'+crypto.randomUUID());fs.renameSync(journal.previous,root);clearOperation(root);return 'An interrupted restore was recovered using the original library.';}
 throw Error(`An interrupted restore needs assistance. Preserve ${journal.previous} and ${journal.stage}. No empty workspace was created.`);
}
module.exports={caseFiles,checkedCopy,validateDatabase,createSnapshot,latestSnapshot,beginRestore,clearOperation,recoverRestore};
