const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { Store } = require('./store.cjs');
const { BankDirectory } = require('./bank-directory.cjs');
const {DocumentTextService}=require('./document-text-service.cjs');
const {readTextInfo,textPaths,checkedPath,sourceFile}=require('./document-text-info.cjs');
const {addSource,setSourcePaused,removeSource,listSources}=require('./legacy-sources.cjs');
const {INDEX_FILE}=require('./text-index-engine.cjs');
const {prepareCodexCase,createDocumentWithAI}=require('./codex-case.cjs');
const {readProfile,writeProfile}=require('./workspace-profile.cjs');
const {atomicJson}=require('./durable-io.cjs');
const {BackupVault}=require('./backup-vault.cjs');
let win, store, directory, vault, textService, backupRemembered=false, backupPassword='', backupBusy=false, backupError='';
function startText(){textService=new DocumentTextService(store,{workerPath:app.isPackaged?path.join(process.resourcesPath,'app.asar.unpacked/electron/text-index-worker.cjs'):path.join(__dirname,'text-index-worker.cjs')});}
async function stopText(){if(textService){const previous=textService;textService=null;await previous.close();}}
function receipt(status,message){if(process.env.LEXO_STARTUP_RECEIPT)try{atomicJson(process.env.LEXO_STARTUP_RECEIPT,{status,appVersion:app.getVersion(),message:message||'',at:new Date().toISOString()});}catch{}}
function loadBackupKey(){backupPassword='';backupRemembered=false;try{backupPassword=vault.get(store.safety().workspaceId);backupRemembered=!!backupPassword;}catch(e){backupError='The saved backup password could not be unlocked. Enter it again in Settings.';}}
function windowHeaderOptions(){return{color:nativeTheme.shouldUseDarkColors?'#1d2027':'#ffffff',symbolColor:nativeTheme.shouldUseDarkColors?'#e7e8ed':'#272a32',height:64};}
function legacyFile(id){const doc=textService?.legacyDocument(id);if(!doc)throw Error('Search directory is unavailable.');const file=sourceFile(store.root,doc);if(!['.pdf','.docx'].includes(path.extname(file).toLowerCase())||!fs.existsSync(file)||!fs.statSync(file).isFile())throw Error('Original file unavailable. Reconnect its source directory or rescan.');return file;}
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
    startText();
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
        await stopText();try{store.relocateRoot(input.root,{onSwitch:()=>{store.savePreferences(input);writePointer();}});}finally{startText();}backupPassword='';loadBackupKey();
      }
      store.savePreferences(input);writePointer();nativeTheme.themeSource=input.theme;win.setTitle(`${input.firmName.trim()} — Lexo`);return true;
    };
    const handlers={
      state:()=>{const state=store.state(),text=textService?.status();const statuses=new Map((text?.documents||[]).map(d=>[d.id,d]));return {...state,documents:state.documents.map(d=>({...d,text:statuses.get(d.id)||{status:'pending'}})),legacySources:text?.sources||[],legacyDocumentCount:text?.legacyCount||0,textIndex:text,directory:directory.status(),requiresSetup:state.settings.setupComplete!=='true',backupUnlocked:!!backupPassword,backupRemembered,secureBackupStorage:vault.available(),backupError};},
      addLegacyDirectory:async(_,name)=>{const result=await dialog.showOpenDialog(win,{title:'Choose a legacy document directory to index',properties:['openDirectory']});if(result.canceled)return null;const source=addSource(store,result.filePaths[0],name);textService?.refresh(true,[source.id]);return source;},
      pauseLegacyDirectory:async(_,id,paused)=>{await stopText();try{setSourcePaused(store,id,paused);}finally{startText();}},
      removeLegacyDirectory:async(_,id)=>{await stopText();try{removeSource(store,id);}finally{startText();}},
      rescanLegacyDirectory:(_,id)=>{if(!listSources(store).some(s=>s.id===id&&!s.paused))throw Error('Resume this directory before rescanning.');textService?.refresh(false,[id]);return true;},
      openLegacyDocument:async(_,id)=>{const error=await shell.openPath(legacyFile(id));if(error)throw Error(error);},
      revealLegacyDocument:(_,id)=>shell.showItemInFolder(legacyFile(id)),
      openLegacyText:async(_,id)=>{const doc=textService?.legacyDocument(id);if(!doc||doc.source_paused||!readTextInfo(store.root,doc).fresh)throw Error('Text copy unavailable or stale. Reconnect the source and rescan.');const error=await shell.openPath(textPaths(store.root,doc).text);if(error)throw Error(error);},
      textStatus:()=>textService?.status()||{revision:0,busy:false,error:'',documents:[]},
      searchDocumentText:(_,input)=>textService?.search(input)||{results:[],limited:false},
      refreshDocumentText:async()=>{await stopText();try{for(const name of [INDEX_FILE,INDEX_FILE+'-wal',INDEX_FILE+'-shm']){const file=checkedPath(store.root,name);if(fs.existsSync(file))fs.unlinkSync(file);}}finally{startText();}return true;},
      openDocumentText:async(_,id)=>{const d=store.db.prepare('SELECT d.*,f.relative_path AS case_folder FROM documents d LEFT JOIN case_folders f ON f.case_id=d.case_id WHERE d.id=?').get(id);if(!d)throw Error('Document not found.');const info=readTextInfo(store.root,d);if(!info.fresh)throw Error('This text copy is unavailable or stale. Refresh text and check the original.');const error=await shell.openPath(textPaths(store.root,d).text);if(error)throw Error(error);},
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
        await stopText();store.close();store=next;startText();backupError='';loadBackupKey();const prefs=store.state().settings;nativeTheme.themeSource=prefs.theme||'system';win.setTitle(prefs.firmName?prefs.firmName+' — Lexo':'Lexo');return true;
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
      setCaseStatus:(_,id,status)=>store.setCaseStatus(id,status),
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
      createDocumentWithAI:(_,input)=>createDocumentWithAI(store,input,url=>shell.openExternal(url)),
      openCaseInCodex:async(_,caseId)=>{const prepared=prepareCodexCase(store,caseId);try{await shell.openExternal(prepared.url);}catch{throw Error('Could not open Codex. Install the Codex desktop app and try again. Your case context has been prepared.');}return true;},
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
        await stopText();let previous;try{previous=store.restore(picked.filePaths[0],password);}finally{startText();}backupPassword='';backupRemembered=false;backupError='';writePointer();const restored=store.state().settings;nativeTheme.themeSource=restored.theme||'system';win.setTitle(restored.firmName?`${restored.firmName} — Lexo`:'Lexo');return previous;
      }
    };
    for(const [name,fn]of Object.entries(handlers))ipcMain.handle(`lexo:${name}`,(event,...args)=>{
      if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame)throw Error('Untrusted request.');
      return fn(event,...args);
    });
    app.setAppUserModelId('in.lexo.desktop');
    const prefs=store.state().settings;
    win=new BrowserWindow({width:1440,height:940,minWidth:1050,minHeight:720,title:prefs.firmName?`${prefs.firmName} — Lexo`:'Lexo',icon:path.join(__dirname,'../assets/lexo.ico'),backgroundColor:nativeTheme.shouldUseDarkColors?'#16181d':'#f6f6f8',titleBarStyle:'hidden',...(process.platform==='win32'?{titleBarOverlay:windowHeaderOptions()}:{}),autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    nativeTheme.on('updated',()=>{if(process.platform==='win32'&&win&&!win.isDestroyed())win.setTitleBarOverlay(windowHeaderOptions());});
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    win.webContents.on('will-navigate',(event)=>event.preventDefault());
    if(process.env.LEXO_DEV==='1')win.loadURL('http://localhost:5173');else win.loadFile(path.join(__dirname,'../dist/index.html'));
    win.webContents.once('did-finish-load',()=>receipt('ready'));
    win.webContents.on('did-fail-load',(_,code,description)=>receipt('error',description));
    win.on('focus',()=>textService?.refresh(true));
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
    backupBusy=true;await stopText();try{const output=await store.backup(s.backupFolder,backupPassword);backupError='';return output;}finally{startText();backupBusy=false;}
  }
  app.on('window-all-closed',()=>app.quit());
  app.on('before-quit',()=>{stopText();directory?.close();if(store){store.close();store=null;}});
}
