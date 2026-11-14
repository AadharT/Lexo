const fs=require('node:fs'),path=require('node:path');
const{safePath,hash}=require('./durable-io.cjs');
function checkedPath(root,relative){const target=safePath(root,relative);let current=path.resolve(root);for(const part of path.relative(current,target).split(path.sep)){current=path.join(current,part);if(fs.lstatSync(current,{throwIfNoEntry:false})?.isSymbolicLink())throw Error('Document extraction cannot follow symbolic links.');}return target;}
function textPaths(root,doc){
 if(!/^[a-zA-Z0-9-]{1,100}$/.test(doc.id))throw Error('Invalid document identifier.');
 if(doc.source_kind==='legacy'&&!/^[a-f0-9-]{36}$/.test(doc.source_id||''))throw Error('Invalid legacy source identifier.');
 if(doc.source_kind==='legacy'){const marker=JSON.parse(fs.readFileSync(checkedPath(root,`.lexo/legacy-text/${doc.source_id}/.source.json`),'utf8'));if(marker.format!==1||marker.source!=='Lexo'||marker.id!==doc.source_id)throw Error('Legacy text cache identity does not match.');}
 const folder=doc.case_folder||`cases/${doc.case_id}`,base=doc.source_kind==='legacy'?`.lexo/legacy-text/${doc.source_id}/${doc.id}`:`${folder}/.lexo/text/${doc.id}`;
 return{text:checkedPath(root,base+'.txt'),manifest:checkedPath(root,base+'.json'),relative:base+'.txt'};
}
function sourceFile(root,doc){if(doc.source_kind==='legacy'){if(typeof doc.source_root!=='string'||!path.isAbsolute(doc.source_root))throw Error('Invalid source directory.');if(fs.lstatSync(doc.source_root).isSymbolicLink())throw Error('Source directory cannot be a link.');return checkedPath(doc.source_root,doc.relative_path);}return checkedPath(root,doc.relative_path);}
function readTextInfo(root,doc){
 try{const files=textPaths(root,doc),info=JSON.parse(fs.readFileSync(files.manifest,'utf8')),stat=fs.statSync(sourceFile(root,doc));
  if(info.documentId!==doc.id||info.sourcePath!==doc.relative_path||doc.source_kind==='legacy'&&info.sourceRoot!==doc.source_root)return{status:'pending',fresh:false};
  const fresh=['ready','partial','empty'].includes(info.status)&&stat.size===info.size&&stat.mtimeMs===info.mtimeMs&&fs.existsSync(files.text)&&!!info.textHash&&hash(fs.readFileSync(files.text))===info.textHash;
  return{status:fresh?info.status:['ready','partial','empty'].includes(info.status)?'stale':info.status,fresh,textPath:fresh?files.relative:null,extractedAt:info.extractedAt||null,warning:info.warning||'',error:info.error||'',sourceHash:info.sourceHash||null};
 }catch{let available=false;try{available=fs.existsSync(sourceFile(root,doc));}catch{}return{status:available?'pending':'missing',fresh:false,textPath:null};}
}
module.exports={checkedPath,textPaths,readTextInfo,sourceFile};
