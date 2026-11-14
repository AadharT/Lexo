const fs=require('node:fs'),path=require('node:path');
const{DatabaseSync}=require('node:sqlite');
const{atomicWrite,atomicJson,hash}=require('./durable-io.cjs');
const{checkedPath,textPaths,sourceFile}=require('./document-text-info.cjs');
const{VERSION,extractDocument}=require('./document-extractor.cjs');
const INDEX_FILE='.lexo-search.sqlite';
function openIndex(root){
 const db=new DatabaseSync(checkedPath(root,INDEX_FILE));db.exec(`PRAGMA journal_mode=WAL;PRAGMA busy_timeout=5000;CREATE TABLE IF NOT EXISTS document_text(id TEXT PRIMARY KEY,case_id TEXT,title TEXT,type TEXT,case_name TEXT,reference TEXT,bank TEXT,branch TEXT,created_at TEXT,archived INTEGER,status TEXT NOT NULL,source_path TEXT,source_hash TEXT,size INTEGER,mtime REAL,extractor TEXT,extracted_at TEXT,warning TEXT,error TEXT,cache_hash TEXT);CREATE VIRTUAL TABLE IF NOT EXISTS text_sections USING fts5(document_id UNINDEXED,location UNINDEXED,body,tokenize='unicode61 remove_diacritics 2');`);if(!db.prepare('PRAGMA table_info(document_text)').all().some(c=>c.name==='cache_hash'))db.exec('ALTER TABLE document_text ADD COLUMN cache_hash TEXT');for(const [name,type]of Object.entries({source_kind:"TEXT NOT NULL DEFAULT 'case'",source_id:'TEXT',source_name:'TEXT',source_root:'TEXT',extension:'TEXT'}))if(!db.prepare('PRAGMA table_info(document_text)').all().some(c=>c.name===name))db.exec(`ALTER TABLE document_text ADD COLUMN ${name} ${type}`);db.exec('CREATE INDEX IF NOT EXISTS document_text_sources ON document_text(source_kind,source_id,status);CREATE TABLE IF NOT EXISTS legacy_source_state(id TEXT PRIMARY KEY,details TEXT NOT NULL)');return db;
}
class TextIndexEngine{
 constructor(root,{stableMs=1200}={}){this.root=root;this.db=openIndex(root);this.stableMs=stableMs;}
 close(){this.db?.close();this.db=null;}
 prepareSources(sources){const allowed=new Set(sources.map(s=>s.id));this.db.exec('BEGIN IMMEDIATE');try{for(const row of this.db.prepare("SELECT DISTINCT source_id FROM document_text WHERE source_kind='legacy'").all())if(!allowed.has(row.source_id)){this.db.prepare('DELETE FROM text_sections WHERE document_id IN (SELECT id FROM document_text WHERE source_id=?)').run(row.source_id);this.db.prepare('DELETE FROM document_text WHERE source_id=?').run(row.source_id);}for(const row of this.db.prepare('SELECT id FROM legacy_source_state').all())if(!allowed.has(row.id))this.db.prepare('DELETE FROM legacy_source_state WHERE id=?').run(row.id);this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}}
 sourceState(state){this.db.prepare('INSERT OR REPLACE INTO legacy_source_state VALUES(?,?)').run(state.id,JSON.stringify(state));}
 record(doc,status,details={}){
  const old=this.db.prepare('SELECT * FROM document_text WHERE id=?').get(doc.id)||{},d={...old,...details};
  const values={id:doc.id,case_id:doc.case_id??null,title:doc.title,type:doc.type,case_name:doc.case_name,reference:doc.reference,bank:doc.bank,branch:doc.branch,created_at:doc.created_at,archived:doc.archived,status,source_path:doc.relative_path,source_hash:d.source_hash??null,size:d.size??null,mtime:d.mtime??null,extractor:VERSION,extracted_at:d.extracted_at??null,warning:d.warning||'',error:d.error||'',cache_hash:d.cache_hash??null,source_kind:doc.source_kind||'case',source_id:doc.source_id||null,source_name:doc.source_name||null,source_root:doc.source_root||null,extension:doc.extension};this.db.prepare(`INSERT OR REPLACE INTO document_text (${Object.keys(values).join(',')}) VALUES (${Object.keys(values).map(()=>'?').join(',')})`).run(...Object.values(values));
  const files=textPaths(this.root,doc);atomicJson(files.manifest,{format:1,documentId:doc.id,sourcePath:doc.relative_path,sourceKind:doc.source_kind||'case',sourceRoot:doc.source_root||null,status,sourceHash:d.source_hash||null,size:d.size??null,mtimeMs:d.mtime??null,extractorVersion:VERSION,textHash:d.cache_hash||null,extractedAt:d.extracted_at||null,warning:d.warning||'',error:d.error||'',textPath:['ready','partial','empty'].includes(status)?files.relative:null});
 }
 async scan(documents,{force=false,forceSources=[],sourceStates=[],skipSources=[],onProgress=()=>{}}={}){
  const skipped=new Set(skipSources),ids=new Set(documents.map(d=>d.id));for(const row of this.db.prepare('SELECT * FROM document_text').all())if(!ids.has(row.id)&&!skipped.has(row.source_id)){if(row.source_kind==='legacy'){const state=sourceStates.find(s=>s.id===row.source_id);if(!state)continue;const status=state.state==='paused'?'paused':state.complete?'missing':'unavailable';if(row.status!==status){try{this.record({...row,relative_path:row.source_path},status,{error:status==='paused'?'Indexing is paused.':status==='missing'?'Original file was not found during the last complete scan.':state.error||'Source directory is unavailable.'});}catch{}}}else{this.db.prepare('DELETE FROM text_sections WHERE document_id=?').run(row.id);this.db.prepare('DELETE FROM document_text WHERE id=?').run(row.id);}}
  for(const doc of documents){
   let fingerprint,observed;try{
    const verify=(force&&doc.source_kind!=='legacy')||forceSources.includes(doc.source_id),source=sourceFile(this.root,doc),before=fs.statSync(source);observed=before;if(!before.isFile())throw Error('Original document is not a regular file.');
    const old=this.db.prepare('SELECT * FROM document_text WHERE id=?').get(doc.id),files=textPaths(this.root,doc);const cacheOK=!!old?.cache_hash&&fs.existsSync(files.text)&&hash(fs.readFileSync(files.text))===old.cache_hash;
    // Always refresh metadata so bank/branch and title filters track case edits.
    if(old)this.db.prepare('UPDATE document_text SET title=?,type=?,case_name=?,reference=?,bank=?,branch=?,created_at=?,archived=?,source_path=?,source_name=?,source_root=?,extension=? WHERE id=?').run(doc.title,doc.type,doc.case_name,doc.reference,doc.bank,doc.branch,doc.created_at,doc.archived,doc.relative_path,doc.source_name||null,doc.source_root||null,doc.extension,doc.id);
    if(this.stableMs>0&&Date.now()-before.mtimeMs<this.stableMs){this.record(doc,'pending',{error:'Waiting for the document to finish saving.'});onProgress();continue;}
    if(before.size>100*1024*1024)throw Error('Document exceeds the 100 MB extraction limit.');
    if(!verify&&old&&old.source_path===doc.relative_path&&old.size===before.size&&old.mtime===before.mtimeMs&&old.extractor===VERSION&&fs.existsSync(files.manifest)&&(['error','needs-ocr'].includes(old.status)||cacheOK&&['ready','partial','empty'].includes(old.status)))continue;
    const bytes=fs.readFileSync(source);fingerprint=hash(bytes);
    if(old&&old.source_hash===fingerprint&&old.extractor===VERSION&&['ready','partial','empty'].includes(old.status)&&cacheOK){this.record(doc,old.status,{size:before.size,mtime:before.mtimeMs,error:''});continue;}
    this.record(doc,old?.source_hash?'stale':'indexing',{error:''});onProgress();
    const result=await extractDocument(bytes,doc.extension),after=fs.statSync(source);
    if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||hash(fs.readFileSync(source))!==fingerprint){this.record(doc,'stale',{error:'Original changed during extraction; retrying after it finishes saving.'});onProgress();continue;}
    const now=new Date().toISOString();
    const output=`Document: ${doc.title}\nOriginal: ${doc.source_kind==='legacy'?path.join(doc.source_root,doc.relative_path):doc.relative_path}\nExtracted: ${now}\nSHA-256: ${fingerprint}\nCheck the adjacent JSON manifest for freshness. Verify quotations against the original.\n\n`+result.sections.map(s=>`[${s.location}]\n${s.text||'(No extractable text; check the original page.)'}`).join('\n\n');
    // Each copy is atomic. A failed DB commit is retried because it never becomes ready in the index.
    if(result.status!=='needs-ocr')atomicWrite(files.text,output);
    this.db.exec('BEGIN IMMEDIATE');try{
     this.db.prepare('DELETE FROM text_sections WHERE document_id=?').run(doc.id);
     if(['ready','partial'].includes(result.status))for(const section of result.sections)if(section.text)this.db.prepare('INSERT INTO text_sections(document_id,location,body) VALUES(?,?,?)').run(doc.id,section.location,section.text);
     if(['ready','partial'].includes(result.status)&&result.sections.filter(s=>s.text).length>1)this.db.prepare('INSERT INTO text_sections(document_id,location,body) VALUES(?,?,?)').run(doc.id,'Whole document',result.sections.map(s=>s.text).join('\n\n'));
     this.record(doc,result.status,{source_hash:fingerprint,size:after.size,mtime:after.mtimeMs,extracted_at:now,cache_hash:result.status==='needs-ocr'?null:hash(Buffer.from(output)),warning:result.warning,error:''});this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}
   }catch(e){try{this.record(doc,e.code==='ENOENT'?'missing':'error',{source_hash:fingerprint,size:observed?.size,mtime:observed?.mtimeMs,error:e.message});}catch{} }
   onProgress();
  }
 }
}
function queryIndex(db,{query='',bank='',branch='',type='',from='',to='',caseId='',sourceKind='all',sourceId='',allowedSourceIds=null,pausedSourceIds=[]}={}){
 if(typeof query!=='string'||query.length>300)throw Error('Use a search of at most 300 characters.');
 const clauses=['archived=0'],params=[];for(const[key,value]of Object.entries({bank,branch,type,case_id:caseId}))if(value){if(typeof value!=='string'||value.length>500)throw Error('Invalid search filter.');clauses.push(`${key}=?`);params.push(value);}
 for(const[key,value]of [['from',from],['to',to]])if(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('Invalid search date.');clauses.push(`created_at${key==='from'?'>=':'<='}?`);params.push(new Date(value+(key==='from'?'T00:00:00':'T23:59:59.999')).toISOString());}
 if(!['all','case','legacy'].includes(sourceKind))throw Error('Invalid document source filter.');if(sourceKind!=='all'){clauses.push('source_kind=?');params.push(sourceKind);}if(sourceId){clauses.push('source_id=?');params.push(sourceId);}const access=Array.isArray(allowedSourceIds)?` AND (d.source_kind='case' OR d.source_id IN (${allowedSourceIds.map(()=>'?').join(',')||'NULL'}))`:'';if(Array.isArray(allowedSourceIds))params.push(...allowedSourceIds);
 const where=clauses.map(x=>'d.'+x).join(' AND ')+access,terms=query.match(/[\p{L}\p{N}\p{M}_]+/gu)?.slice(0,20)||[],match=terms.map(t=>'"'+t+'"*').join(' AND '),results=new Map();
 const contentAccess=pausedSourceIds.length?` AND (d.source_id IS NULL OR d.source_id NOT IN (${pausedSourceIds.map(()=>'?').join(',')}))`:'';
 if(match){const rows=db.prepare(`WITH hits AS MATERIALIZED (SELECT d.*,text_sections.location,snippet(text_sections,2,'','',' … ',45) AS excerpt,bm25(text_sections) AS rank FROM text_sections JOIN document_text d ON d.id=text_sections.document_id WHERE text_sections MATCH ? AND d.status IN ('ready','partial') AND ${where}${contentAccess}), best AS (SELECT *,row_number() OVER(PARTITION BY id ORDER BY CASE WHEN location='Whole document' THEN 1 ELSE 0 END,rank) AS position FROM hits) SELECT * FROM best WHERE position=1 ORDER BY rank LIMIT 101`).all(match,...params,...pausedSourceIds);for(const row of rows)results.set(row.id,{...row,match:'content'});}
 const escaped=query.trim().replace(/[\\%_]/g,c=>'\\'+c),metadata=db.prepare(`SELECT d.* FROM document_text d WHERE ${where} AND (?='' OR d.title LIKE ? ESCAPE '\\' OR d.case_name LIKE ? ESCAPE '\\' OR d.reference LIKE ? ESCAPE '\\' OR d.type LIKE ? ESCAPE '\\' OR d.source_name LIKE ? ESCAPE '\\' OR d.source_path LIKE ? ESCAPE '\\') ORDER BY d.created_at DESC LIMIT 200`).all(...params,query.trim(),...Array(6).fill('%'+escaped+'%'));
 for(const row of metadata)if(!results.has(row.id))results.set(row.id,{...row,match:'metadata',location:null,excerpt:null});
 return{results:[...results.values()].slice(0,100),limited:results.size>100};
}
module.exports={TextIndexEngine,INDEX_FILE,queryIndex};
