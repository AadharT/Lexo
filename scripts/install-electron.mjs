// Fetch through Node's system-aware fetch; verify the checksums shipped by Electron.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { unzipSync } from 'fflate';
const require=createRequire(import.meta.url);
const root=path.dirname(require.resolve('electron/package.json'));
const {version}=require('electron/package.json');
const executable=path.join(root,'dist','electron.exe');
if(process.platform!=='win32'||process.arch!=='x64')throw Error('Use the standard Electron installer on platforms other than Windows x64.');
if(!fs.existsSync(executable)){
 const name=`electron-v${version}-win32-x64.zip`;
 console.log(`Downloading official Electron ${version} Windows runtime…`);
 const url=`https://github.com/electron/electron/releases/download/v${version}/${name}`;
 const head=await fetch(url,{method:'HEAD',signal:AbortSignal.timeout(30000)});
 if(!head.ok)throw Error(`Electron download failed: ${head.status}`);
 const length=Number(head.headers.get('content-length'));
 let bytes;
 if(length>1000000){
  const chunks=8, part=Math.ceil(length/chunks);
  bytes=Buffer.concat(await Promise.all(Array.from({length:chunks},async(_,index)=>{
   const start=index*part,end=Math.min(length-1,start+part-1);
   const response=await fetch(head.url,{headers:{Range:`bytes=${start}-${end}`},signal:AbortSignal.timeout(240000)});
   if(response.status!==206)throw Error('Electron server did not honour a download range.');
   const data=Buffer.from(await response.arrayBuffer());if(data.length!==end-start+1)throw Error('Incomplete runtime download.');
   console.log(`Downloaded runtime part ${index+1}/${chunks}`);return data;
  })));
 }else{
  const result=await fetch(url,{signal:AbortSignal.timeout(240000)});
  if(!result.ok)throw Error(`Electron download failed: ${result.status}`);
  bytes=Buffer.from(await result.arrayBuffer());
 }
 const expected=require('electron/checksums.json')[name];
 if(!expected||crypto.createHash('sha256').update(bytes).digest('hex')!==expected)throw Error('Electron checksum mismatch.');
 const dist=path.join(root,'dist');fs.mkdirSync(dist,{recursive:true});
 for(const [name,data]of Object.entries(unzipSync(bytes))){
  const target=path.resolve(dist,name);if(!target.startsWith(dist+path.sep))throw Error('Unsafe runtime archive.');
  if(name.endsWith('/'))fs.mkdirSync(target,{recursive:true});else{fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,data);}
 }
 fs.writeFileSync(path.join(root,'path.txt'),'electron.exe');
}
console.log(`Electron ready: ${executable}`);
