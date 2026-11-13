const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),os=require('node:os');
function flushDirectory(folder){if(process.platform==='win32')return;let fd;try{fd=fs.openSync(folder,'r');fs.fsyncSync(fd);}finally{if(fd!==undefined)fs.closeSync(fd);}}
// Windows rejects recursive mkdir on an existing drive root (for example D:\).
function ensureDirectory(folder){if(!fs.existsSync(folder))fs.mkdirSync(folder,{recursive:true});else if(!fs.statSync(folder).isDirectory())throw Error('The destination folder is not a directory.');}
function atomicWrite(file,data,{replace=true,tempFile=file+`.partial-${crypto.randomUUID()}`}={}){
 ensureDirectory(path.dirname(file));if(!replace&&fs.existsSync(file))throw Error('The destination already exists.');let fd;
 try{fd=fs.openSync(tempFile,'wx');fs.writeFileSync(fd,data);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(tempFile,file);flushDirectory(path.dirname(file));}catch(e){if(fd!==undefined)fs.closeSync(fd);throw e;}
}
function atomicJson(file,value,{backup=false}={}){if(backup&&fs.existsSync(file))atomicWrite(file+'.bak',fs.readFileSync(file));atomicWrite(file,JSON.stringify(value,null,2));}
function safePath(root,relative){if(typeof relative!=='string'||path.isAbsolute(relative)||relative.includes('\0'))throw Error('Invalid relative workspace path.');const result=path.resolve(root,relative);if(!result.startsWith(path.resolve(root)+path.sep))throw Error('Path leaves the workspace.');return result;}
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
function acquireLease(root){
 const file=path.resolve(root)+'.lexo-lock',nonce=crypto.randomUUID();ensureDirectory(path.dirname(file));
 for(let attempt=0;attempt<2;attempt++){
  let fd;try{fd=fs.openSync(file,'wx');fs.writeFileSync(fd,JSON.stringify({pid:process.pid,host:os.hostname(),nonce,root:path.resolve(root),startedAt:new Date().toISOString()}));fs.fsyncSync(fd);fs.closeSync(fd);return {root:path.resolve(root),release(){if(fs.existsSync(file)){const owner=JSON.parse(fs.readFileSync(file,'utf8'));if(owner.nonce===nonce)fs.unlinkSync(file);}}};}
  catch(e){if(fd!==undefined)try{fs.closeSync(fd);}catch{}if(e.code!=='EEXIST')throw e;let owner;try{owner=JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw Error(`The workspace lock is unreadable. Preserve ${file} and contact support.`);}let alive=true;if(owner.host===os.hostname()&&Number.isInteger(owner.pid)){try{process.kill(owner.pid,0);}catch(error){if(error.code==='ESRCH')alive=false;}}
   if(alive)throw Error('This workspace is already open. Close every other Lexo window before continuing.');fs.renameSync(file,file+'.stale-'+crypto.randomUUID());
  }
 }
 throw Error('Could not lock the workspace.');
}
module.exports={atomicWrite,atomicJson,safePath,hash,acquireLease,flushDirectory};
