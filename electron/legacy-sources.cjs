const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const{atomicJson}=require('./durable-io.cjs');
const{checkedPath}=require('./document-text-info.cjs');
const KEY='legacySearchDirectories';
const validId=id=>typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id);
const key=p=>process.platform==='win32'?path.resolve(p).toLowerCase():path.resolve(p);
function overlaps(a,b){a=key(a);b=key(b);return a===b||a.startsWith(b.endsWith(path.sep)?b:b+path.sep)||b.startsWith(a.endsWith(path.sep)?a:a+path.sep);}
function listSources(store){
 const raw=store.db.prepare('SELECT value FROM settings WHERE key=?').get(KEY)?.value;
 if(!raw)return[];const list=JSON.parse(raw);
 if(!Array.isArray(list)||list.some(s=>!validId(s.id)||typeof s.name!=='string'||typeof s.root!=='string'||!path.isAbsolute(s.root)))throw Error('Search-directory settings are invalid. Preserve the workspace and contact support.');
 return list;
}
function addSource(store,root,name=''){
 if(typeof root!=='string'||!path.isAbsolute(root))throw Error('Choose an existing absolute directory.');
 if(fs.lstatSync(root).isSymbolicLink())throw Error('Choose the original folder rather than a directory link.');
 root=fs.realpathSync(root);if(!fs.statSync(root).isDirectory())throw Error('Choose a directory.');fs.accessSync(root,fs.constants.R_OK);
 if(overlaps(root,fs.realpathSync(store.root)))throw Error('Choose a directory outside the workspace and its parent directories.');
 const sources=listSources(store);if(sources.some(s=>overlaps(root,s.root)))throw Error('This directory overlaps an existing search directory. Choose a separate folder.');
 if(sources.length>=50)throw Error('Use at most 50 search directories.');
 if(typeof name!=='string'||name.length>120)throw Error('Use a directory name of at most 120 characters.');
 const source={id:crypto.randomUUID(),name:name.trim()||path.basename(root)||root,root,paused:false,addedAt:new Date().toISOString()};store.setting(KEY,JSON.stringify([...sources,source]));return source;
}
function setSourcePaused(store,id,paused){const sources=listSources(store),source=sources.find(s=>s.id===id);if(!source)throw Error('Search directory not found.');source.paused=!!paused;store.setting(KEY,JSON.stringify(sources));}
function cacheFolder(workspace,id){if(!validId(id))throw Error('Invalid search directory identifier.');return checkedPath(workspace,`.lexo/legacy-text/${id}`);}
function prepareCache(workspace,source){
 const folder=cacheFolder(workspace,source.id),marker=path.join(folder,'.source.json');
 if(fs.existsSync(folder)&&fs.readdirSync(folder).length&&!fs.existsSync(marker))throw Error('Existing legacy text cache has no ownership marker. It was preserved.');
 if(fs.existsSync(marker)){const value=JSON.parse(fs.readFileSync(marker,'utf8'));if(value.format!==1||value.source!=='Lexo'||value.id!==source.id)throw Error('Legacy text cache identity does not match.');}
 atomicJson(marker,{format:1,source:'Lexo',id:source.id});
}
function removeSource(store,id){
 const sources=listSources(store);if(!sources.some(s=>s.id===id))throw Error('Search directory not found.');const folder=cacheFolder(store.root,id);
 if(fs.existsSync(folder)){
  const marker=JSON.parse(fs.readFileSync(path.join(folder,'.source.json'),'utf8'));if(marker.format!==1||marker.source!=='Lexo'||marker.id!==id)throw Error('Cache ownership could not be verified. No files were deleted.');
  // The cache is flat and has a verified source marker. Never traverse original folders.
  for(const entry of fs.readdirSync(folder,{withFileTypes:true})){const file=path.join(folder,entry.name);if(entry.isSymbolicLink()||entry.isDirectory()||fs.lstatSync(file).isSymbolicLink()||!(entry.name.startsWith('legacy-'+id+'-')&&/\.(txt|json)(\.partial-[a-f0-9-]+)?$/.test(entry.name)||/^\.source\.json(\.partial-[a-f0-9-]+)?$/.test(entry.name)))throw Error('Unexpected files in the generated cache. They were preserved.');}
  const parent=checkedPath(store.root,'.lexo/legacy-text');if(path.dirname(folder)!==parent)throw Error('Invalid cache cleanup target.');fs.rmSync(folder,{recursive:true});
 }
 store.setting(KEY,JSON.stringify(sources.filter(s=>s.id!==id)));
}
function legacyId(sourceId,relative){return 'legacy-'+sourceId+'-'+crypto.createHash('sha256').update(process.platform==='win32'?relative.toLowerCase():relative).digest('hex').slice(0,24);}
function collectSource(workspace,source,{onProgress=()=>{},maxFiles=100000}={}){
 const state={id:source.id,state:source.paused?'paused':'scanning',scanned:0,supported:0,unsupported:0,ignored:0,error:'',lastScan:new Date().toISOString(),complete:false},documents=[];let lastProgress=0;
 if(source.paused)return{state,documents};
 try{
  if(overlaps(source.root,workspace))throw Error('Source overlaps the current workspace. Choose a separate directory.');
  if(fs.lstatSync(source.root).isSymbolicLink()||!fs.statSync(source.root).isDirectory())throw Error('Source is not an available ordinary directory.');
  prepareCache(workspace,source);
  function walk(relative,depth){
   if(depth>128)throw Error('Directory depth limit reached. Select a smaller source folder.');
   let entries;try{entries=fs.readdirSync(relative?checkedPath(source.root,relative):source.root,{withFileTypes:true});}catch(e){state.error='Some directories could not be read: '+e.message;return;}
   for(const entry of entries){
    const rel=relative?relative+'/'+entry.name:entry.name;
    if(entry.name.startsWith('.')||entry.name.startsWith('~$')||['$recycle.bin','system volume information','node_modules'].includes(entry.name.toLowerCase())||entry.isSymbolicLink()){state.ignored++;continue;}
    if(entry.isDirectory()){walk(rel,depth+1);continue;}if(!entry.isFile()){state.ignored++;continue;}
    state.scanned++;if(state.scanned>maxFiles)throw Error('File limit reached. Select smaller source directories.');
    const extension=path.extname(entry.name).toLowerCase();if(!['.pdf','.docx'].includes(extension)){state.unsupported++;continue;}
    try{
     const stat=fs.statSync(checkedPath(source.root,rel));documents.push({id:legacyId(source.id,rel),source_kind:'legacy',source_id:source.id,source_name:source.name,source_root:source.root,relative_path:rel,case_id:null,case_name:'',reference:'',bank:'',branch:'',archived:0,title:path.basename(entry.name,path.extname(entry.name)),type:'',extension,created_at:stat.mtime.toISOString()});state.supported++;
    }catch(e){state.error='Some files could not be read: '+e.message;}
    if(Date.now()-lastProgress>250){lastProgress=Date.now();onProgress({...state});}
   }
  }
  walk('',0);state.complete=!state.error;state.state=state.error?'partial':'indexed';
 }catch(e){state.state=documents.length?'partial':'unavailable';state.error=e.message;}
 return{state,documents};
}
module.exports={listSources,addSource,setSourcePaused,removeSource,collectSource,legacyId,overlaps,validId};
