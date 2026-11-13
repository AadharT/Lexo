const{parentPort,workerData}=require('node:worker_threads');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const{buildCache}=require('./directory-cache.cjs');
const API='https://api.github.com/repos/razorpay/ifsc/releases/latest';
const headers={'User-Agent':'Lexo-Desktop','Accept':'application/vnd.github+json'};
const report=(phase,detail,progress)=>parentPort.postMessage({type:'progress',phase,detail,progress});
async function json(url,maxBytes=5000000){const r=await fetch(url,{headers,signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error(`Directory service returned HTTP ${r.status}.`);const data=Buffer.from(await r.arrayBuffer());if(data.length>maxBytes)throw Error('Directory metadata exceeds its size limit.');return JSON.parse(data.toString('utf8'));}
async function download(asset){
 if(asset.size<1000||asset.size>150000000||!/^sha256:[a-f0-9]{64}$/.test(asset.digest||''))throw Error('The published directory has no valid size/checksum.');
 const url=new URL(asset.browser_download_url);if(url.origin!=='https://github.com'||!url.pathname.startsWith('/razorpay/ifsc/releases/download/'))throw Error('Untrusted directory download URL.');
 const head=await fetch(url,{method:'HEAD',signal:AbortSignal.timeout(30000)});if(!head.ok)throw Error(`Directory download returned HTTP ${head.status}.`);
 if(Number(head.headers.get('content-length'))!==asset.size)throw Error('Directory download size does not match its release.');
 const host=new URL(head.url).hostname;if(!['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(host))throw Error('Unexpected directory download host.');
 const chunks=8,part=Math.ceil(asset.size/chunks);let received=0;
 const data=Buffer.concat(await Promise.all(Array.from({length:chunks},async(_,index)=>{
  const start=index*part,end=Math.min(asset.size-1,start+part-1),r=await fetch(head.url,{headers:{Range:`bytes=${start}-${end}`},signal:AbortSignal.timeout(180000)});
  if(r.status!==206)throw Error('The directory server did not honour its download range.');const result=Buffer.from(await r.arrayBuffer());if(result.length!==end-start+1)throw Error('Directory download was interrupted.');received+=result.length;report('downloading',`${Math.round(received/1048576)} of ${Math.ceil(asset.size/1048576)} MB`,Math.round(received/asset.size*100));return result;
 })));
 const digest=crypto.createHash('sha256').update(data).digest('hex');if(`sha256:${digest}`!==asset.digest)throw Error('The directory checksum did not match.');return data.toString('utf8');
}
(async()=>{
 report('checking','Checking the published IFSC directory…');const release=await json(API);if(!/^v\d+\.\d+\.\d+$/.test(release.tag_name))throw Error('Unsupported directory release version.');
 const csv=release.assets?.find(a=>a.name==='IFSC.csv');if(!csv)throw Error('The published release has no branch directory.');
 if(workerData.current?.version===release.tag_name&&workerData.current?.digest===csv.digest){parentPort.postMessage({type:'unchanged'});return;}
 report('downloading','Downloading bank and branch reference data…',0);
 const [content,names,sublets]=await Promise.all([download(csv),json(`https://raw.githubusercontent.com/razorpay/ifsc/${release.tag_name}/src/banknames.json`),json(`https://raw.githubusercontent.com/razorpay/ifsc/${release.tag_name}/src/sublet.json`)]);
 if(!names||Array.isArray(names)||Object.keys(names).length<100||!sublets||Array.isArray(sublets))throw Error('Invalid bank-name reference data.');
 report('indexing','Building the offline directory…');fs.mkdirSync(path.dirname(workerData.file),{recursive:true});
 const metadata=buildCache(workerData.file,content,names,sublets,{source:'Razorpay IFSC',sourceUrl:'https://github.com/razorpay/ifsc',version:release.tag_name,publishedAt:release.published_at,digest:csv.digest},{onProgress:count=>report('indexing',`${count.toLocaleString('en-IN')} branches indexed`)});
 parentPort.postMessage({type:'ready',metadata});
})().catch(e=>{try{if(fs.existsSync(workerData.file))fs.unlinkSync(workerData.file);}catch{}parentPort.postMessage({type:'error',message:e.message});process.exitCode=1;});
