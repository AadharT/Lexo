const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {acquireLease,atomicWrite}=require('../electron/durable-io.cjs');
test('workspace lock and atomic writes skip mkdir for existing parent folders, including drive roots',()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'lexo-drive-root-'));
 const originalMkdir=fs.mkdirSync;let lease;
 // Emulate Windows drive-root mkdir behaviour without writing to the actual drive root.
 fs.mkdirSync=function(target,...args){if(path.resolve(target)===folder){const error=Error('EPERM mkdir drive root');error.code='EPERM';throw error;}return originalMkdir.call(fs,target,...args);};
 try{
  lease=acquireLease(path.join(folder,'Workspace'));assert.ok(fs.existsSync(path.join(folder,'Workspace.lexo-lock')));
  atomicWrite(path.join(folder,'sample.txt'),'preserved bytes');assert.equal(fs.readFileSync(path.join(folder,'sample.txt'),'utf8'),'preserved bytes');
  lease.release();lease=null;
 }finally{fs.mkdirSync=originalMkdir;lease?.release();fs.rmSync(folder,{recursive:true,force:true});}
});
