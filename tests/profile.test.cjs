const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const{readProfile,writeProfile}=require('../electron/workspace-profile.cjs');
const{BackupVault}=require('../electron/backup-vault.cjs');
function sample(t){const folder=fs.mkdtempSync(path.join(os.tmpdir(),'lexo-profile-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));return folder;}
test('profile pointers keep a backup and never recreate a missing configured library',t=>{
 const profile=sample(t),root=path.join(profile,'elsewhere');assert.equal(readProfile(profile).allowCreate,true);
 writeProfile(profile,root);assert.deepEqual(readProfile(profile),{root,allowCreate:false});
 writeProfile(profile,root+'-next');assert.equal(JSON.parse(fs.readFileSync(path.join(profile,'workspace.json.bak'))).root,root);
 fs.unlinkSync(path.join(profile,'workspace.json'));assert.throws(()=>readProfile(profile),/pointer is missing/);
 fs.writeFileSync(path.join(profile,'workspace.json'),'broken');assert.throws(()=>readProfile(profile),/unreadable/);
});
test('remembered backup secrets are encrypted, workspace-specific and removable',t=>{
 const profile=sample(t),cipher={isEncryptionAvailable:()=>true,encryptString:p=>Buffer.from(p).reverse(),decryptString:b=>Buffer.from(b).reverse().toString()};
 const vault=new BackupVault(profile,cipher);vault.set('one','sample password only',true);
 assert.equal(vault.get('one'),'sample password only');assert.equal(vault.get('two'),'');assert.ok(!fs.readFileSync(vault.file,'utf8').includes('sample password only'));
 vault.set('one','',false);assert.equal(vault.get('one'),'');
 const unavailable=new BackupVault(profile,{isEncryptionAvailable:()=>false});assert.throws(()=>unavailable.set('one','anything',true),/unavailable/);
});
