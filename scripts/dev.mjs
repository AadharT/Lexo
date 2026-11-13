import {fileURLToPath} from 'node:url';
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import electron from 'electron';
const server=await createServer();await server.listen();
console.log('\nLexo development: renderer hot reload + Electron restart enabled.\n');
let child, timer, restarting=false, quitting=false;
function launch(){child=spawn(electron,['.'],{stdio:'inherit',env:{...process.env,LEXO_DEV:'1',LEXO_DATA_DIR:process.env.LEXO_DATA_DIR||fileURLToPath(new URL('../.test-data/development-profile',import.meta.url))}});child.on('exit',()=>{if(!restarting&&!quitting)shutdown();});}
function shutdown(){if(quitting)return;quitting=true;watcher.close();if(child)child.kill();server.close().then(()=>process.exit(0));}
const watcher=watch(new URL('../electron/',import.meta.url),{recursive:true},()=>{
  clearTimeout(timer);timer=setTimeout(()=>{restarting=true;child.once('exit',()=>{restarting=false;launch();});child.kill();},350);
});
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);launch();
