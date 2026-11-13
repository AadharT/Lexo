import React,{useState} from 'react';
import {Download,RefreshCw,Database,Loader2,Check,Globe} from 'lucide-react';
import {api,Button,date} from './ui';
export default function DirectoryPanel({status,onRefresh}){
 const[starting,setStarting]=useState(false),[error,setError]=useState('');const updating=starting||status?.updating,metadata=status?.metadata;
 async function update(){setStarting(true);setError('');try{await api.updateBankDirectory();}catch(e){setError(e.message.replace(/^Error invoking remote method '[^']+': Error: /,''));}finally{setStarting(false);await onRefresh();}}
 return <section className="settings-card directory-panel"><div className="directory-heading"><span className="directory-icon"><Globe size={20}/></span><div><h2>Bank directory</h2><p>Indian bank and branch reference data from Razorpay IFSC.</p></div><span className={`directory-chip ${status?.available?'ready':''}`}>{status?.available?<><Check size={12}/>Available offline</>:updating?'Connecting…':'Not downloaded'}</span></div>
 {metadata&&<><div className="directory-stats"><div><strong>{Number(metadata.bankCount).toLocaleString('en-IN')}</strong><small>Banks</small></div><div><strong>{Number(metadata.branchCount).toLocaleString('en-IN')}</strong><small>Branches</small></div><div><strong>{metadata.version}</strong><small>Source release · {date(metadata.publishedAt)}</small></div></div><p className="help">Downloaded {date(metadata.downloadedAt)}. Selecting a suggestion adds it to your firm’s list. Existing cases and manual entries are preserved.</p></>}
 {!metadata&&!updating&&<p className="help">Download the directory to search banks, branches, cities and IFSC codes from case forms. Your manual entries remain available.</p>}
 {updating&&<div className="directory-progress"><Loader2 size={15} className="spin"/><span>{status?.detail||'Connecting to the directory…'}</span>{status?.progress!=null&&<progress aria-label="Directory download progress" max={100} value={status.progress}/>}</div>}
 {(error||status?.error)&&<p className="error-text">{error||status.error}{status?.available?' Your previous offline directory is still available.':''}</p>}
 <Button icon={updating?Loader2:metadata?RefreshCw:Download} disabled={updating} onClick={update}>{updating?'Updating directory…':metadata?'Check for updates':'Download directory'}</Button>
 </section>;
}
