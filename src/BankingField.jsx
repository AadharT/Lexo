import React from 'react';
import {api,Select} from './ui';
export default function BankingField({kind='bank',data,bank='',onCreateChoice,onRefresh,...props}){
 const options=kind==='bank'?data.options.banks.map(name=>({value:name,label:name,description:'Firm list'})):data.branches.filter(b=>b.bank===bank).map(b=>({value:b.name,label:b.name,description:b.ifsc?`${b.ifsc} · ${b.city}, ${b.state}`:'Firm list'}));
 return <Select {...props} options={options} lookupKey={kind==='bank'?'banks':bank} loadOptions={query=>kind==='bank'?api.searchDirectoryBanks(query):api.searchDirectoryBranches(bank,query)} onCreate={name=>onCreateChoice(kind==='bank'?'banks':'branches',name,bank)} onResolve={async reference=>{const canonical=await api.selectDirectoryEntry(reference,bank);await onRefresh();return canonical;}}/>;
}
