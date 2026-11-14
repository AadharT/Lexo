import React from 'react';
import {ChevronLeft,ChevronRight} from 'lucide-react';
import {Button,Dropdown} from './ui';
import './pagination.css';
export default function Pagination({total,page=1,pageSize=25,onPage,onPageSize,busy=false,label='Documents'}){
 const pages=Math.max(1,Math.ceil(total/pageSize)),current=Math.min(page,pages),start=total?(current-1)*pageSize+1:0,end=Math.min(current*pageSize,total),unit=total===1?label.toLowerCase().replace(/s$/,''):label.toLowerCase();
 return <nav className="pagination" aria-label={`${label} pagination`}><span aria-live="polite">{start.toLocaleString()}–{end.toLocaleString()} of {total.toLocaleString()} {unit}</span><div className="pagination-controls">{onPageSize&&<Dropdown compact label="Documents per page" value={String(pageSize)} options={[25,50,100].map(n=>({value:String(n),label:`${n} per page`}))} onChange={n=>onPageSize(Number(n))} disabled={busy}/>}<Button icon={ChevronLeft} disabled={busy||current<=1} onClick={()=>onPage(current-1)} aria-label={`Previous ${label.toLowerCase()} page`}>Previous</Button><span>Page {current.toLocaleString()} of {pages.toLocaleString()}</span><Button disabled={busy||current>=pages} onClick={()=>onPage(current+1)} aria-label={`Next ${label.toLowerCase()} page`}>Next<ChevronRight size={16}/></Button></div></nav>;
}
