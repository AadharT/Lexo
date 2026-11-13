const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const{buildCache,DirectoryCache,csvRows}=require('../electron/directory-cache.cjs');
const{BankDirectory}=require('../electron/bank-directory.cjs');
const{Store}=require('../electron/store.cjs');
const csv='BANK,IFSC,BRANCH,CITY,STATE,ADDRESS\r\n,SBIN0000001,FORT,MUMBAI,MAHARASHTRA,"1, Main Road"\r\n,SBIN0000002,FORT,PUNE,MAHARASHTRA,"First line\nSecond line"\r\n,HDFC0000001,LOCAL COOP,MUMBAI,MAHARASHTRA,"Say ""hello"""\r\n';
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'lexo-directory-'));return root;}
function seed(root){fs.mkdirSync(root,{recursive:true});const file=path.join(root,'bank-directory.sqlite');buildCache(file,csv,{SBIN:'State Bank of India',COOP:'Local Cooperative Bank'},{HDFC0000001:'COOP'},{version:'test-release',source:'Test',digest:'test'}, {minRows:1});return file;}
test('directory parser handles CSV quotes/newlines and preserves sublet bank ownership',t=>{
 const root=fixture(t),cache=new DirectoryCache(seed(root));t.after(()=>{cache.close();fs.rmSync(root,{recursive:true,force:true});});assert.equal([...csvRows(csv)].length,4);assert.equal(cache.metadata.branchCount,3);assert.equal(cache.bank('SBIN').name,'State Bank of India');assert.equal(cache.branches('SBIN','fort').length,2);assert.equal(cache.branches('SBIN','pune')[0].ifsc,'SBIN0000002');assert.equal(cache.branch('HDFC0000001').bank_code,'COOP');assert.equal(cache.branch('HDFC0000001').address,'Say "hello"');assert.notEqual(cache.branches('SBIN','fort')[0].label,cache.branches('SBIN','fort')[1].label);
});
test('bank search finds full names, all query words, mixed case and repeated spaces',t=>{
 const root=fixture(t),cache=new DirectoryCache(seed(root));t.after(()=>{cache.close();fs.rmSync(root,{recursive:true,force:true});});
 for(const query of ['state bank of india','State Bank of India','  STATE   BANK  of INDIA  ','india state bank','state india','state SBIN'])assert.equal(cache.banks(query)[0]?.code,'SBIN',query);
 assert.equal(cache.banks('State')[0].code,'SBIN');assert.equal(cache.banks('%').length,0);assert.equal(cache.banks('not a real bank').length,0);
});
test('directory import adds only selected records, deduplicates IFSC and backs up source metadata',async t=>{
 const root=fixture(t),cache=new DirectoryCache(seed(path.join(root,'reference'))),store=new Store(path.join(root,'workspace'));t.after(()=>{cache.close();store.close();fs.rmSync(root,{recursive:true,force:true});});
 store.addOption('banks','STATE   BANK OF INDIA');const bank=store.importDirectoryBank(cache.bank('SBIN'));assert.equal(bank,'STATE BANK OF INDIA');assert.equal(store.state().options.banks.length,1);
 store.addBranch(bank,'Manual branch');const a=store.importDirectoryBranch(cache.branch('SBIN0000001'),bank,'test-release'),b=store.importDirectoryBranch(cache.branch('SBIN0000002'),bank,'test-release');assert.notEqual(a,b);assert.equal(store.importDirectoryBranch(cache.branch('SBIN0000001'),bank,'test-release'),a);assert.equal(store.state().branches.length,3);
 assert.throws(()=>store.importDirectoryBranch(cache.branch('HDFC0000001'),bank,'test-release'),/does not belong/);
 store.saveCase({name:'Directory case',client:'Test',bank,branch:a,status:'Active'});const backup=await store.backup(path.join(root,'backups'),'directory backup password');store.restore(backup,'directory backup password');const row=store.state().branches.find(r=>r.ifsc==='SBIN0000001');assert.equal(row.city,'MUMBAI');assert.equal(row.source_version,'test-release');assert.equal(store.directoryBankCode(bank),'SBIN');assert.ok(store.state().branches.some(b=>b.name==='Manual branch'));
});
test('failed directory refresh preserves an existing offline cache',async t=>{
 const root=fixture(t);seed(root);const directory=new BankDirectory(root,{workerPath:path.join(__dirname,'fixtures/directory-error-worker.cjs')});t.after(()=>{directory.close();fs.rmSync(root,{recursive:true,force:true});});await assert.rejects(directory.update(),/Simulated network failure/);assert.equal(directory.status().available,true);assert.equal(directory.searchBanks('state')[0].code,'SBIN');assert.equal(directory.searchBranches('SBIN','PUNE')[0].ifsc,'SBIN0000002');
});
test('partial CSV imports fail completeness checks',t=>{const root=fixture(t);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));assert.throws(()=>buildCache(path.join(root,'bad.sqlite'),'IFSC,BRANCH,CITY,STATE,ADDRESS\nSBIN0000001,FORT,MUMBAI,MH,Street\n',{SBIN:'SBI'},{},{version:'bad'}),/completeness/);});
