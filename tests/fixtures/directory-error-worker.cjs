const{parentPort}=require('node:worker_threads');parentPort.postMessage({type:'error',message:'Simulated network failure'});
