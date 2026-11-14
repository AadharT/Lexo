const path=require('node:path'),{Worker}=require('node:worker_threads');
// Read-only search stays independent of both Electron and extraction. Replacing
// a request stops its old query instead of letting stale keystrokes queue up.
class DocumentSearchClient{
 constructor(root,{workerPath=path.join(__dirname,'document-search-worker.cjs'),timeoutMs=5000}={}){this.root=root;this.workerPath=workerPath;this.timeoutMs=timeoutMs;this.sequence=0;this.closed=false;this.retiring=new Set();}
 retire(){const worker=this.worker;this.worker=null;if(worker){const ended=worker.terminate();this.retiring.add(ended);ended.finally(()=>this.retiring.delete(ended));}}
 spawn(){const worker=this.worker=new Worker(this.workerPath,{workerData:{root:this.root},resourceLimits:{maxOldGenerationSizeMb:256}});worker.on('message',m=>{if(worker!==this.worker||m.id!==this.pending?.id)return;const pending=this.pending;this.pending=null;clearTimeout(pending.timer);if(m.error)pending.reject(Error(m.error));else pending.resolve(m.result);});worker.on('error',e=>{if(worker===this.worker){const p=this.pending;this.pending=null;if(p){clearTimeout(p.timer);p.reject(e);}this.retire();}});worker.on('exit',()=>{if(worker===this.worker){this.worker=null;const p=this.pending;this.pending=null;if(p){clearTimeout(p.timer);p.reject(Error('Search stopped. Please retry.'));}}});}
 search(input){if(this.closed)return Promise.reject(Error('Search is closed.'));if(this.pending){clearTimeout(this.pending.timer);this.pending.resolve({cancelled:true,results:[]});this.pending=null;this.retire();}if(!this.worker)this.spawn();const id=++this.sequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{if(this.pending?.id!==id)return;this.pending=null;this.retire();reject(Error('This search took too long. Try more specific words or select a source.'));},this.timeoutMs);this.pending={id,resolve,reject,timer};this.worker.postMessage({id,input});});}
 async close(){this.closed=true;if(this.pending){clearTimeout(this.pending.timer);this.pending.resolve({cancelled:true,results:[]});this.pending=null;}this.retire();await Promise.allSettled([...this.retiring]);}
}
module.exports={DocumentSearchClient};
