const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { Store } = require('./store.cjs');
const { BankDirectory } = require('./bank-directory.cjs');
const {readProfile,writeProfile}=require('./workspace-profile.cjs');
const {atomicJson}=require('./durable-io.cjs');
const {BackupVault}=require('./backup-vault.cjs');
let win, store, directory, vault, backupRemembered=false, backupPassword='', backupBusy=false, backupError='';
function receipt(status,message){if(process.env.LEXO_STARTUP_RECEIPT)try{atomicJson(process.env.LEXO_STARTUP_RECEIPT,{status,appVersion:app.getVersion(),message:message||'',at:new Date().toISOString()});}catch{}}
function loadBackupKey(){backupPassword='';backupRemembered=false;try{backupPassword=vault.get(store.safety().workspaceId);backupRemembered=!!backupPassword;}catch(e){backupError='The saved backup password could not be unlocked. Enter it again in Settings.';}}
// Reliable rendering on Windows systems with incompatible GPU drivers/virtual GPUs.
if(process.platform==='win32')app.disableHardwareAcceleration();
app.setPath('userData',process.env.LEXO_DATA_DIR?path.resolve(process.env.LEXO_DATA_DIR):path.join(app.getPath('appData'),'lexo'));
if(!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.focus();}});
  app.whenReady().then(()=>{
    const profile=app.getPath('userData');
    const selected=readProfile(profile);
    store=new Store(selected.root,{allowCreate:selected.allowCreate,appVersion:app.getVersion()});
    vault=new BackupVault(profile,safeStorage);loadBackupKey();
    if(store.state().settings.setupComplete==='true')writeProfile(profile,store.root);
    directory=new BankDirectory(path.join(app.getPath('userData'),'reference'),{workerPath:app.isPackaged?path.join(process.resourcesPath,'app.asar.unpacked/electron/directory-worker.cjs'):path.join(__dirname,'directory-worker.cjs')});
    if(!directory.status().available&&process.env.LEXO_SKIP_DIRECTORY_DOWNLOAD!=='1')directory.update().catch(()=>{});
    nativeTheme.themeSource=store.state().settings.theme||'system';
    const writePointer=()=>writeProfile(profile,store.root);
    const saveWorkspace=async(_,input)=>{
      if(!input||typeof input.firmName!=='string'||!input.firmName.trim()||input.firmName.length>120||typeof input.workspaceName!=='string'||!input.workspaceName.trim()||input.workspaceName.length>120||!['light','dark','system'].includes(input.theme))throw Error('Enter firm and workspace names and select an appearance.');
      if(typeof input.root!=='string'||!path.isAbsolute(input.root))throw Error('Choose a workspace folder.');
      if(path.resolve(input.root)!==store.root){
        if(backupBusy)throw Error('Wait for the backup to finish.');
        if(store.state().documents.length){const confirm=await dialog.showMessageBox(win,{type:'question',buttons:['Cancel','Copy workspace'],defaultId:0,cancelId:0,message:'Save and close documents in Word before changing folders.',detail:'Lexo copies the library to the selected empty folder and keeps the original as a recovery copy.'});if(confirm.response!==1)return null;}
        store.relocateRoot(input.root,{onSwitch:()=>{store.savePreferences(input);writePointer();}});backupPassword='';loadBackupKey();
      }
      store.savePreferences(input);writePointer();nativeTheme.themeSource=input.theme;win.setTitle(`${input.firmName.trim()} — Lexo`);return true;
    };
    const handlers={
      state:()=>{const state=store.state();return {...state,directory:directory.status(),requiresSetup:state.settings.setupComplete!=='true',backupUnlocked:!!backupPassword,backupRemembered,secureBackupStorage:vault.available(),backupError};},
      directoryStatus:()=>directory.status(),
      updateBankDirectory:()=>directory.update(),
      searchDirectoryBanks:(_,query)=>directory.searchBanks(typeof query==='string'?query:'').map(b=>({value:`directory-bank:${b.code}`,label:b.name,description:`${b.code} · Bank directory`,aliases:[b.code],reference:{kind:'bank',code:b.code}})),
      searchDirectoryBranches:(_,bank,query)=>{
        if(typeof bank!=='string')return[];const code=store.directoryBankCode(bank)||directory.bankByName(bank)?.code;if(!code)return[];
        return directory.searchBranches(code,typeof query==='string'?query:'').map(b=>({value:`directory-branch:${b.ifsc}`,label:b.label,description:`${b.city}, ${b.state}`,aliases:[b.ifsc,b.branch],reference:{kind:'branch',ifsc:b.ifsc}}));
      },
      selectDirectoryEntry:(_,reference,bank)=>{
        if(reference?.kind==='bank'){const record=directory.bank(reference.code);if(!record)throw Error('This bank is no longer in the cached directory.');return store.importDirectoryBank(record);}
        if(reference?.kind==='branch'){const record=directory.branch(reference.ifsc),code=store.directoryBankCode(bank)||directory.bankByName(bank)?.code;if(!record||record.bank_code!==code)throw Error('This branch does not belong to the selected bank.');return store.importDirectoryBranch(record,bank,directory.status().metadata.version);}
        throw Error('Invalid directory selection.');
      },
      saveWorkspace,
      openExistingWorkspace:async()=>{
        if(backupBusy)throw Error('Wait for the backup to finish.');
        const picked=await dialog.showOpenDialog(win,{title:'Open an existing Lexo workspace',properties:['openDirectory']});if(picked.canceled)return null;
        const target=path.resolve(picked.filePaths[0]);if(target===store.root)return true;
        const next=new Store(target,{allowCreate:false,appVersion:app.getVersion()});
        try{writeProfile(profile,next.root);}catch(e){next.close();throw e;}
        store.close();store=next;backupError='';loadBackupKey();const prefs=store.state().settings;nativeTheme.themeSource=prefs.theme||'system';win.setTitle(prefs.firmName?prefs.firmName+' — Lexo':'Lexo');return true;
      },
      revealRecovery:async()=>{const folder=store.safety().recoveryFolder;if(!fs.existsSync(folder))throw Error('No upgrade recovery copies have been needed yet.');const error=await shell.openPath(folder);if(error)throw Error(error);},
      chooseWorkspaceFolder:async()=>{const result=await dialog.showOpenDialog(win,{title:'Choose an empty folder for this workspace',properties:['openDirectory','createDirectory']});return result.canceled?null:result.filePaths[0];},
      setTheme:(_,theme)=>{if(!['light','dark','system'].includes(theme))throw Error('Invalid appearance.');store.setting('theme',theme);nativeTheme.themeSource=theme;},
      addBranch:(_,bank,name)=>store.addBranch(bank,name),
      addFieldChoice:(_,id,value)=>store.addFieldChoice(id,value),
      removeBranch:(_,id)=>store.removeBranch(id),
      removeOption:(_,kind,value)=>store.removeOption(kind,value),
      saveField:(_,input)=>store.saveField(input),
      archiveField:(_,id,archived)=>store.archiveField(id,archived),
      saveCase:(_,input)=>store.saveCase(input),
      archiveCase:(_,id,value)=>store.archiveCase(id,value),
      addOption:(_,kind,value)=>store.addOption(kind,value),
      importDocuments:async(_,caseId,type)=>{
        store.getCase(caseId);
        const result=await dialog.showOpenDialog(win,{title:'Add case documents',properties:['openFile','multiSelections'],filters:[{name:'Case documents',extensions:['pdf','docx']}]});
        if(result.canceled)return 0;
        let count=0;
        for(const file of result.filePaths) { try {await store.importDocument(caseId,file,type);count++;}catch(e){throw Error(`${count} document(s) imported. ${path.basename(file)}: ${e.message}`);} }
        return count;
      },
      createDocument:(_,caseId,title,type)=>store.createDocument(caseId,title,type),
      openDocument:async(_,id)=>{const error=await shell.openPath(store.documentPath(id));if(error)throw Error(error);},
      revealDocument:(_,id)=>shell.showItemInFolder(store.documentPath(id)),
      revealLibrary:async()=>{const error=await shell.openPath(store.root);if(error)throw Error(error);},
      chooseBackupFolder:async()=>{const result=await dialog.showOpenDialog(win,{title:'Choose backup folder (Google Drive, external drive, or local folder)',properties:['openDirectory','createDirectory']});return result.canceled?null:result.filePaths[0];},
      configureBackup:(_,folder,password,automatic,remember=false)=>{
        if(typeof folder!=='string'||!folder.trim())throw Error('Choose a backup folder.');
        if(typeof password!=='string'||password.length<12)throw Error('Use a password of at least 12 characters.');
        const resolved=path.resolve(folder);if(resolved===store.root||resolved.startsWith(store.root+path.sep))throw Error('Choose a folder outside the live library.');
        vault.set(store.safety().workspaceId,password,remember);backupRemembered=!!remember;backupPassword=password;store.setting('backupFolder',resolved);store.setting('automaticBackup',automatic?'true':'false');backupError='';
      },
      backup:async()=>runBackup(),
      restore:async(_,password)=>{
        if(backupBusy)throw Error('Wait for the current backup to finish.');
        const picked=await dialog.showOpenDialog(win,{title:'Restore encrypted Lexo backup',properties:['openFile'],filters:[{name:'Lexo backup',extensions:['lexobak']}]});if(picked.canceled)return null;
        const answer=await dialog.showMessageBox(win,{type:'warning',buttons:['Cancel','Restore backup'],defaultId:0,cancelId:0,title:'Restore this library?',message:'Save and close all case documents in Word before continuing.',detail:'The backup will replace the active library. Your current library will be preserved in a separate recovery folder.'});
        if(answer.response!==1)return null;
        const previous=store.restore(picked.filePaths[0],password);backupPassword='';backupRemembered=false;backupError='';writePointer();const restored=store.state().settings;nativeTheme.themeSource=restored.theme||'system';win.setTitle(restored.firmName?`${restored.firmName} — Lexo`:'Lexo');return previous;
      }
    };
    for(const [name,fn]of Object.entries(handlers))ipcMain.handle(`lexo:${name}`,(event,...args)=>{
      if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame)throw Error('Untrusted request.');
      return fn(event,...args);
    });
    app.setAppUserModelId('in.lexo.desktop');
    const prefs=store.state().settings;
    win=new BrowserWindow({width:1440,height:940,minWidth:1050,minHeight:720,title:prefs.firmName?`${prefs.firmName} — Lexo`:'Lexo',icon:path.join(__dirname,'../assets/lexo.ico'),backgroundColor:nativeTheme.shouldUseDarkColors?'#16181d':'#f6f6f8',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    win.webContents.on('will-navigate',(event)=>event.preventDefault());
    if(process.env.LEXO_DEV==='1')win.loadURL('http://localhost:5173');else win.loadFile(path.join(__dirname,'../dist/index.html'));
    win.webContents.once('did-finish-load',()=>receipt('ready'));
    win.webContents.on('did-fail-load',(_,code,description)=>receipt('error',description));
    const timer=setInterval(async()=>{
      const s=store.state().settings;
      if(s.automaticBackup==='true'&&backupPassword&&(!s.lastBackup||Date.now()-Date.parse(s.lastBackup)>=86400000)){
        try {await runBackup();}catch(e){backupError=e.message;}
      }
    },60000);timer.unref();
  }).catch(e=>{receipt('error',e.message);dialog.showErrorBox('Lexo could not open the workspace',e.message+'\n\nYour existing data has been preserved. Reconnect the workspace drive or contact support.');app.quit();});
  async function runBackup(){
    if(backupBusy)throw Error('A backup is already running.');
    const s=store.state().settings;if(!s.backupFolder||!backupPassword)throw Error('Choose a folder and unlock backups with your password.');
    backupBusy=true;try{const output=await store.backup(s.backupFolder,backupPassword);backupError='';return output;}finally{backupBusy=false;}
  }
  app.on('window-all-closed',()=>app.quit());
  app.on('before-quit',()=>{directory?.close();if(store){store.close();store=null;}});
}
