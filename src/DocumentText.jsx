import React from 'react';
import {RefreshCw} from 'lucide-react';
import {api,Button} from './ui';
import './document-text.css';
export const textStatusLabels={ready:'Text searchable',partial:'Partly searchable',empty:'No text',pending:'Text pending',indexing:'Extracting text',stale:'Text stale',error:'Extraction failed',missing:'Original unavailable',unavailable:'Source unavailable',paused:'Indexing paused','needs-ocr':'Needs OCR'};
export default function DocumentTextTools({data,caseId,busy,action}){
 const legacy=caseId?[]:data.legacySources||[],sum=(...keys)=>legacy.reduce((n,s)=>n+keys.reduce((v,k)=>v+(s.counts?.[k]||0),0),0);const documents=data.documents.filter(d=>!caseId||d.case_id===caseId),ready=documents.filter(d=>['ready','partial'].includes(d.text?.status)).length+sum('ready','partial'),ocr=documents.filter(d=>['needs-ocr','partial'].includes(d.text?.status)).length+sum('needs-ocr','partial'),pending=documents.filter(d=>!d.text||['pending','indexing','stale'].includes(d.text.status)).length+sum('pending','indexing','stale'),failed=documents.filter(d=>d.text?.status==='error').length+sum('error');
 return <div className="document-text-tools"><div><strong>Document text</strong><span>{ready} searchable{pending?` · ${pending} pending`:''}{ocr?` · ${ocr} may need OCR`:''}{failed?` · ${failed} failed`:''}</span>{data.textIndex?.error&&<small className="error-text">{data.textIndex.error}</small>}</div><Button icon={RefreshCw} disabled={busy} onClick={()=>action(()=>api.refreshDocumentText(),'Text refresh started. Original documents are unchanged.')}>Refresh text</Button></div>;
}
