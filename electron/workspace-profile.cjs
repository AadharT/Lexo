const fs=require('node:fs'),path=require('node:path');
const {atomicJson}=require('./durable-io.cjs');
function readProfile(profile){
 const pointer=path.join(profile,'workspace.json'),configured=path.join(profile,'workspace-configured.json');
 function read(file){const value=JSON.parse(fs.readFileSync(file,'utf8'));if(typeof value.root!=='string'||!path.isAbsolute(value.root))throw Error('Invalid workspace path.');return path.resolve(value.root);}
 if(fs.existsSync(pointer)){try{return{root:read(pointer),allowCreate:false};}catch{throw Error('The workspace pointer is unreadable. Preserve workspace.json and workspace.json.bak; no empty library was created.');}}
 if(fs.existsSync(configured)||fs.existsSync(pointer+'.bak'))throw Error('The configured workspace pointer is missing. Preserve this profile and reconnect your existing workspace; no empty library was created.');
 const root=path.join(profile,'library');return{root,allowCreate:!fs.existsSync(path.join(root,'lexo.sqlite'))};
}
function writeProfile(profile,root){
 // The marker prevents a lost pointer being mistaken for a first launch.
 atomicJson(path.join(profile,'workspace-configured.json'),{format:1});
 atomicJson(path.join(profile,'workspace.json'),{root:path.resolve(root)},{backup:true});
}
module.exports={readProfile,writeProfile};
