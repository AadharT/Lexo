const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const{Worker}=require('node:worker_threads');
const{DirectoryCache}=require('./directory-cache.cjs');
class BankDirectory{
 constructor(root,{workerPath=path.join(__dirname,'directory-worker.cjs')}={}){this.root=root;this.file=path.join(root,'bank-directory.sqlite');this.workerPath=workerPath;this.cache=null;this.worker=null;this.phase='idle';this.error='';this.detail='';this.progress=null;if(fs.existsSync(this.file)){try{this.cache=new DirectoryCache(this.file);}catch(e){this.error=e.message;}}}
 status(){return{available:!!this.cache,updating:!!this.worker,phase:this.phase,detail:this.detail,progress:this.progress,error:this.error,metadata:this.cache?.metadata||null,checkedAt:this.checkedAt||null};}
 update(){
  if(this.worker)return Promise.reject(Error('The bank directory is already updating.'));
  fs.mkdirSync(this.root,{recursive:true});const stage=path.join(this.root,`directory-${crypto.randomUUID()}.sqlite`);this.phase='checking';this.detail='Checking the published directory…';this.error='';this.progress=null;
  return new Promise((resolve,reject)=>{
   const worker=new Worker(this.workerPath,{workerData:{file:stage,current:this.cache?.metadata}});this.worker=worker;let finished=false;
   const fail=message=>{if(finished)return;finished=true;this.worker=null;this.phase='error';this.error=message;this.detail='';try{if(fs.existsSync(stage))fs.unlinkSync(stage);}catch{}reject(Error(message));};
   worker.on('message',message=>{
    if(message.type==='progress'){this.phase=message.phase;this.detail=message.detail;this.progress=message.progress??null;return;}
    if(message.type==='error'){fail(message.message);return;}
    if(message.type==='unchanged'){finished=true;this.worker=null;this.phase='ready';this.detail='The directory is up to date.';this.checkedAt=new Date().toISOString();resolve(this.status());return;}
    if(message.type==='ready'){
     const previous=path.join(this.root,`previous-${crypto.randomUUID()}.sqlite`);let swapped=false;
     try{const check=new DirectoryCache(stage);check.close();this.cache?.close();this.cache=null;if(fs.existsSync(this.file))fs.renameSync(this.file,previous);fs.renameSync(stage,this.file);swapped=true;this.cache=new DirectoryCache(this.file);if(fs.existsSync(previous))fs.unlinkSync(previous);finished=true;this.worker=null;this.phase='ready';this.detail='Bank directory is available offline.';this.checkedAt=new Date().toISOString();resolve(this.status());}
     catch(e){try{if(swapped&&fs.existsSync(this.file))fs.unlinkSync(this.file);if(fs.existsSync(previous))fs.renameSync(previous,this.file);if(fs.existsSync(this.file))this.cache=new DirectoryCache(this.file);}catch{}fail(e.message);}
    }
   });
   worker.on('error',e=>fail(e.message));worker.on('exit',code=>{if(!finished)fail(`Directory update stopped before completion (${code}).`);});
  });
 }
 searchBanks(query){return this.cache?.banks(query)||[];}
 bank(code){return this.cache?.bank(code)||null;}
 bankByName(name){return this.cache?.bankByName(name)||null;}
 searchBranches(code,query){return this.cache?.branches(code,query)||[];}
 branch(ifsc){return this.cache?.branch(ifsc)||null;}
 close(){this.worker?.terminate();this.cache?.close();this.cache=null;}
}
module.exports={BankDirectory};
