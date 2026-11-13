const fs=require('node:fs'),path=require('node:path');
const{atomicJson}=require('./durable-io.cjs');
class BackupVault{
 constructor(profile,cipher){this.file=path.join(profile,'backup-secrets.json');this.cipher=cipher;}
 available(){return this.cipher.isEncryptionAvailable()&&(process.platform==='win32'||this.cipher.getSelectedStorageBackend?.()!=='basic_text');}
 read(){if(!fs.existsSync(this.file))return{};return JSON.parse(fs.readFileSync(this.file,'utf8'));}
 get(id){if(!this.available())return'';const value=this.read()[id];return value?this.cipher.decryptString(Buffer.from(value,'base64')):'';}
 set(id,password,remember){const values=this.read();if(remember){if(!this.available())throw Error('Secure password storage is unavailable on this computer.');values[id]=this.cipher.encryptString(password).toString('base64');}else delete values[id];atomicJson(this.file,values);}
}
module.exports={BackupVault};
