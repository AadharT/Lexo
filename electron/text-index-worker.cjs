const{parentPort,workerData}=require('node:worker_threads');
const{TextIndexEngine}=require('./text-index-engine.cjs');
const{collectSource}=require('./legacy-sources.cjs');
const engine=new TextIndexEngine(workerData.root),inventories=new Map();let running=false,pending=null,currentSources=[],lastProgress=0;
function emit(type,force=false){if(!force&&Date.now()-lastProgress<500)return;lastProgress=Date.now();parentPort.postMessage({type,status:engine.status(currentSources)});}
parentPort.on('message',message=>{pending={documents:message.documents,sources:message.sources||[],force:message.force||pending?.force,forceSources:[...new Set([...(message.forceSources||[]),...(pending?.forceSources||[])])]};if(!running)run();});
async function run(){running=true;while(pending){const current=pending;pending=null;currentSources=current.sources;try{
 engine.prepareSources(current.sources);for(const id of inventories.keys())if(!current.sources.some(s=>s.id===id))inventories.delete(id);const documents=[...current.documents],states=[],skipSources=[];
 for(const source of current.sources){
  const identity=JSON.stringify([source.root,source.name,source.paused]),cached=inventories.get(source.id);let inventory;
  if(!current.forceSources.includes(source.id)&&cached&&cached.identity===identity&&Date.now()-cached.at<30000){inventory=cached.inventory;if(!engine.db.prepare("SELECT 1 FROM document_text WHERE source_id=? AND status IN ('pending','stale','indexing') LIMIT 1").get(source.id))skipSources.push(source.id);}
  else{engine.sourceState({id:source.id,state:source.paused?'paused':'scanning',scanned:0,supported:0,unsupported:0,ignored:0,error:'',lastScan:new Date().toISOString()});emit('progress');inventory=collectSource(workerData.root,source,{onProgress:state=>{engine.sourceState(state);emit('progress');}});inventories.set(source.id,{identity,at:Date.now(),inventory});}
  engine.sourceState(inventory.state);if(!skipSources.includes(source.id))for(const doc of inventory.documents)documents.push(doc);states.push(inventory.state);
 }
 await engine.scan(documents,{force:current.force,forceSources:current.forceSources,sourceStates:states,skipSources,onProgress:()=>emit('progress')});emit('done',true);
 }catch(e){parentPort.postMessage({type:'failure',message:e.message});}}running=false;}
parentPort.postMessage({type:'ready'});
