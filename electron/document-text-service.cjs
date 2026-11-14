const fs=require('node:fs'),path=require('node:path'),{Worker}=require('node:worker_threads'),{DatabaseSync}=require('node:sqlite');
const{INDEX_FILE}=require('./text-index-engine.cjs');
const{checkedPath}=require('./document-text-info.cjs');
const{listSources}=require('./legacy-sources.cjs');
const{DocumentSearchClient}=require('./document-search-client.cjs');
const{randomUUID}=require('node:crypto');
class DocumentTextService{
 constructor(store,{workerPath=path.join(__dirname,'text-index-worker.cjs')}={}){
  this.store=store;this.root=store.root;this.revision=0;this.closed=false;this.busy=true;this.error='';this.reader=null;this.epoch=randomUUID();this.snapshot={revision:0,sources:[],legacyCount:0,caseCounts:{},documents:[]};this.searcher=new DocumentSearchClient(this.root,{workerPath:path.join(path.dirname(workerPath),'document-search-worker.cjs')});
  this.worker=new Worker(workerPath,{workerData:{root:this.root},resourceLimits:{maxOldGenerationSizeMb:512}});
  const heartbeat=()=>{clearTimeout(this.watchdog);this.watchdog=setTimeout(()=>{if(!this.closed&&this.busy){this.error='Text extraction timed out. Use Refresh text to retry.';this.busy=false;this.revision++;this.worker.terminate();}},120000);this.watchdog.unref();};
  this.worker.on('message',m=>{if(m.status){this.snapshot=m.status;this.revision=m.status.revision;}heartbeat();if(m.type==='progress')this.busy=true;if(m.type==='ready')this.refresh(true);if(m.type==='done'){this.busy=false;this.error='';}if(m.type==='failure'){this.error=m.message;this.busy=false;}});heartbeat();
  this.worker.on('error',e=>{this.error=e.message;this.busy=false;this.revision++;});
  this.worker.on('exit',code=>{if(!this.closed&&code!==0){this.error='Text extraction stopped. Restart Lexo or use Refresh text to retry.';this.busy=false;this.revision++;}});
  this.timer=setInterval(()=>this.refresh(),5000);this.timer.unref();this.watchTimer=null;
  try{this.watcher=fs.watch(path.join(this.root,'cases'),{recursive:true},(_,name)=>{if(name&&/\.(pdf|docx)$/i.test(name)&&!name.includes('.lexo')&&!path.basename(name).startsWith('~$')){clearTimeout(this.watchTimer);this.watchTimer=setTimeout(()=>this.refresh(),1500);}});}catch{}
 }
 documents(){return this.store.db.prepare(`SELECT d.*,c.name AS case_name,c.reference,c.client,c.bank,c.branch,c.archived,COALESCE(f.relative_path,'cases/'||c.id) AS case_folder FROM documents d JOIN cases c ON c.id=d.case_id LEFT JOIN case_folders f ON f.case_id=c.id`).all();}
 refresh(force=false,forceSources=[],{urgent=false}={}){if(this.closed||this.busy&&!force&&!forceSources.length&&!urgent)return;try{this.busy=true;this.worker.postMessage({documents:this.documents(),sources:listSources(this.store),force,forceSources});}catch(e){this.error=e.message;this.busy=false;}}
 db(){if(!this.reader&&fs.existsSync(checkedPath(this.root,INDEX_FILE))){try{this.reader=new DatabaseSync(checkedPath(this.root,INDEX_FILE),{readOnly:true});this.reader.exec('PRAGMA busy_timeout=1000');this.reader.prepare('SELECT source_kind FROM document_text LIMIT 1').get();this.reader.prepare('SELECT rowid FROM text_sections LIMIT 1').get();this.reader.prepare('SELECT id FROM legacy_source_state LIMIT 1').get();}catch{this.reader?.close();this.reader=null;}}return this.reader;}
 status(){const sources=listSources(this.store).map(config=>({state:config.paused?'paused':'pending',counts:{},...this.snapshot.sources.find(s=>s.id===config.id),...config}));return{...this.snapshot,sources,legacyCount:sources.reduce((n,s)=>n+(s.total||0),0),revision:this.epoch+':'+this.revision,busy:this.busy,error:this.error};}
 async search(input){const sources=listSources(this.store),pausedSourceIds=sources.filter(s=>s.paused).map(s=>s.id),result=await this.searcher.search({...input,allowedSourceIds:sources.map(s=>s.id),pausedSourceIds});return{...result,results:result.results.map(row=>pausedSourceIds.includes(row.source_id)?{...row,status:'paused'}:row)};}
 legacyDocument(id){const db=this.db(),row=db?.prepare("SELECT * FROM document_text WHERE id=? AND source_kind='legacy'").get(id);if(!row||!listSources(this.store).some(s=>s.id===row.source_id&&s.root===row.source_root))throw Error('Legacy document is not part of a registered search directory.');return{...row,relative_path:row.source_path,source_paused:!!listSources(this.store).find(s=>s.id===row.source_id)?.paused};}
 async close(){if(this.closed)return;this.closed=true;clearInterval(this.timer);clearTimeout(this.watchTimer);clearTimeout(this.watchdog);this.watcher?.close();this.reader?.close();this.reader=null;await Promise.allSettled([this.worker.terminate(),this.searcher.close()]);}
}
module.exports={DocumentTextService};
