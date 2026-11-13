import React,{useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Check,ChevronDown,Search,X,Plus,Loader2} from 'lucide-react';
import {normalise,matchesOption,exactOption} from './search.mjs';

export default function Dropdown({label,value='',onChange,options,placeholder,required=false,disabled=false,compact=false,searchable:searchableProp,name,onCreate,loadOptions,onResolve,lookupKey=''}){
 const id=useId(),root=useRef(null),trigger=useRef(null),popup=useRef(null),search=useRef(null),typeahead=useRef({text:'',time:0}),restoreAfterCreate=useRef(false);
 const[open,setOpen]=useState(false),[query,setQuery]=useState(''),[active,setActive]=useState(-1),[position,setPosition]=useState(null),[invalid,setInvalid]=useState(false);
 const[creating,setCreating]=useState(false),[createError,setCreateError]=useState('');
 const[remoteOptions,setRemoteOptions]=useState([]),[remoteQuery,setRemoteQuery]=useState(null),[loadingOptions,setLoadingOptions]=useState(false),[lookupError,setLookupError]=useState('');const loader=useRef(loadOptions);loader.current=loadOptions;
 const localItems=options.map(o=>typeof o==='string'?{value:o,label:o}:{...o,value:String(o.value)});
 const items=[...localItems,...remoteOptions.filter(remote=>!localItems.some(local=>local.value===remote.value)).map(option=>({...option,searchQuery:remoteQuery}))];
 const choices=placeholder!==undefined?[{value:'',label:placeholder,empty:true},...items]:items;
 const selected=choices.find(o=>o.value===String(value??''));
 const searchable=!!onCreate||!!loadOptions||(searchableProp??items.length>6);
 const cleanQuery=query.normalize('NFKC').trim().replace(/\s+/g,' ');
 const canCreate=!!onCreate&&!loadingOptions&&!!cleanQuery&&!items.some(o=>exactOption(o,cleanQuery));
 const matches=(option,text)=>option.searchQuery===normalise(text)||matchesOption(option,text);
 const filteredChoices=choices.filter(o=>matches(o,query));
 const filtered=[...filteredChoices,...(canCreate?[{value:'',label:`Create “${cleanQuery}”`,create:true}]:[])];
 const optionId=i=>`${id}-option-${i}`;
 function close(restoreFocus=false){setOpen(false);setPosition(null);setQuery('');setCreateError('');if(restoreFocus)trigger.current?.focus();}
 function show(last=false){if(disabled||creating)return;setQuery('');setCreateError('');const index=choices.findIndex(o=>o.value===String(value??'')&&!o.disabled);setActive(index>=0?index:last?choices.findLastIndex(o=>!o.disabled):choices.findIndex(o=>!o.disabled));setOpen(true);}
 async function choose(item){if(!item||item.disabled||creating)return;if(item.create||item.reference&&onResolve){setCreating(true);setCreateError('');try{const result=item.create?await onCreate(cleanQuery):await onResolve(item.reference);if(typeof result!=='string'||!result)throw Error('The option could not be saved.');onChange(result);setInvalid(false);close();}catch(e){setCreateError(e.message.replace(/^Error invoking remote method '[^']+': Error: /,''));}finally{restoreAfterCreate.current=true;setCreating(false);}return;}onChange(item.value);setInvalid(required&&!item.value);close(true);}
 function changeQuery(next){setQuery(next);setCreateError('');if(loadOptions)setLoadingOptions(true);const nextList=choices.filter(o=>matches(o,next));const exact=nextList.findIndex(o=>!o.disabled&&exactOption(o,next));const first=nextList.findIndex(o=>!o.disabled);setActive(exact>=0?exact:first>=0?first:!loadOptions&&onCreate&&normalise(next)?nextList.length:-1);}
 useEffect(()=>{
  if(!open||!loader.current)return;let alive=true;setLoadingOptions(true);setLookupError('');
  const timer=setTimeout(async()=>{try{const rows=await loader.current(query);if(alive){setRemoteOptions(Array.isArray(rows)?rows:[]);setRemoteQuery(normalise(query));}}catch(e){if(alive){setRemoteOptions([]);setLookupError('Directory search unavailable. Manual entries are still available.');}}finally{if(alive)setLoadingOptions(false);}},120);
  return()=>{alive=false;clearTimeout(timer);};
 },[open,query,lookupKey,!!loadOptions]);
 useEffect(()=>{if(open&&!loadingOptions&&loadOptions){const exact=filtered.findIndex(o=>!o.disabled&&exactOption(o,query));setActive(exact>=0?exact:filtered.findIndex(o=>!o.disabled));}},[loadingOptions,remoteOptions]);
 useLayoutEffect(()=>{
  if(!open||disabled)return;
  const update=()=>{
   const r=trigger.current.getBoundingClientRect(),gap=6,pad=10,below=innerHeight-r.bottom-gap-pad,above=r.top-gap-pad;
   const desired=Math.min(260,Math.max(loadOptions?4:1,choices.length+(onCreate?1:0))*36+12)+(searchable?49:0)+(createError?35:0),up=below<desired&&above>below;
   const height=Math.max(0,Math.min(desired,up?above:below));
   const width=Math.min(Math.max(r.width,compact?220:200),innerWidth-2*pad);
   setPosition({left:Math.max(pad,Math.min(r.left,innerWidth-width-pad)),top:up?undefined:r.bottom+gap,bottom:up?innerHeight-r.top+gap:undefined,width,maxHeight:height,listHeight:Math.max(0,height-(searchable?49:0)-(createError?35:0)-10),side:up?'above':'below'});
  };
  update();const scroll=e=>{if(!popup.current?.contains(e.target))update();};
  window.addEventListener('resize',update);window.addEventListener('scroll',scroll,true);
  const observer=new ResizeObserver(update);observer.observe(trigger.current);
  return()=>{window.removeEventListener('resize',update);window.removeEventListener('scroll',scroll,true);observer.disconnect();};
 },[open,disabled,compact,searchable,choices.length,!!onCreate,createError,!!loadOptions]);
 useEffect(()=>{if(disabled&&open)close();},[disabled,open]);
 useEffect(()=>{
  if(!open)return;
  const outside=e=>{if(!creating&&!root.current?.contains(e.target)&&!popup.current?.contains(e.target))close();};
  document.addEventListener('pointerdown',outside,true);
  return()=>document.removeEventListener('pointerdown',outside,true);
 },[open,creating]);
 useEffect(()=>{if(open&&position&&searchable)search.current?.focus();},[open,!!position,searchable]);
 useEffect(()=>{if(!creating&&restoreAfterCreate.current){restoreAfterCreate.current=false;if(open)search.current?.focus();else trigger.current?.focus();}},[creating,open]);
 useEffect(()=>{if(open&&active>=0)document.getElementById(optionId(active))?.scrollIntoView({block:'nearest'});},[open,active,query]);
 function move(direction){const enabled=filtered.map((o,i)=>!o.disabled?i:-1).filter(i=>i>=0);if(!enabled.length){setActive(-1);return;}const current=enabled.indexOf(active);setActive(enabled[(current+direction+enabled.length)%enabled.length]);}
 function tab(event){
  event.preventDefault();event.stopPropagation();const scope=trigger.current.closest('[role="dialog"]')||document;
  const nodes=[...scope.querySelectorAll('button,input,textarea,select,a[href],[tabindex]')].filter(n=>n.tabIndex>=0&&!n.disabled&&n.getClientRects().length&&!popup.current?.contains(n));
  const index=nodes.indexOf(trigger.current),next=nodes[(index+(event.shiftKey?-1:1)+nodes.length)%nodes.length];close();queueMicrotask(()=>next?.focus());
 }
 function key(event){
  if(disabled)return;const inSearch=event.target===search.current;
  if(creating){if(['Escape','Enter','Tab','ArrowDown','ArrowUp',' '].includes(event.key)){event.preventDefault();event.stopPropagation();}return;}
  if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();close(true);return;}
  if(event.key==='Tab'&&open){tab(event);return;}
  if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();event.stopPropagation();if(!open)show(event.key==='ArrowUp');else move(event.key==='ArrowDown'?1:-1);return;}
  if((event.key==='Enter'||event.key===' '&&!inSearch)){event.preventDefault();event.stopPropagation();if(open)choose(filtered[active]);else show();return;}
  if(open&&['Home','End'].includes(event.key)&&!inSearch){event.preventDefault();event.stopPropagation();setActive(event.key==='Home'?filtered.findIndex(o=>!o.disabled):filtered.findLastIndex(o=>!o.disabled));return;}
  if(!inSearch&&event.key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey){
   if(searchable){event.preventDefault();if(!open)show();changeQuery((open?query:'')+event.key);return;}
   event.preventDefault();const now=Date.now();const previous=now-typeahead.current.time<700?typeahead.current.text:'';let text=previous+event.key.toLocaleLowerCase();if([...text].every(c=>c===text[0]))text=text[0];typeahead.current={text,time:now};
   if(!open)show();const list=open?filtered:choices;const start=open?active+1:0;
   for(let offset=0;offset<list.length;offset++){const index=(start+offset)%list.length;if(!list[index].disabled&&list[index].label.toLocaleLowerCase().startsWith(text)){setActive(index);break;}}
  }
 }
 return <div ref={root} className={`dropdown ${compact?'compact':''}`} onKeyDown={key}>
  <button ref={trigger} type="button" role="combobox" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open?`${id}-list`:undefined} aria-activedescendant={open&&active>=0&&filtered[active]?optionId(active):undefined} aria-required={required||undefined} aria-invalid={invalid||undefined} aria-describedby={invalid?`${id}-error`:undefined} disabled={disabled||creating} data-open={open} className={`dropdown-trigger ${!value&&!compact?'placeholder':''}`} title={selected?.label||placeholder} onClick={()=>open?close(true):show()}>
   <span>{selected?.label||placeholder||'Select an option'}</span><ChevronDown className="dropdown-chevron" size={15} strokeWidth={1.8}/>
  </button>
  {required&&<input className="dropdown-validation" aria-hidden="true" tabIndex={-1} name={name} value={value??''} required disabled={disabled} onChange={()=>{}} onInvalid={e=>{e.preventDefault();setInvalid(true);trigger.current?.focus();}}/>}
  {invalid&&<small id={`${id}-error`} className="dropdown-error" role="alert">Select an option.</small>}
  {open&&position&&createPortal(<div ref={popup} className="dropdown-popup" data-select-popup="true" data-side={position.side} style={{left:position.left,top:position.top,bottom:position.bottom,width:position.width,maxHeight:position.maxHeight}}>
   {searchable&&<div className="dropdown-search"><Search size={15}/><input ref={search} aria-label={`Search ${label.replace(/\s*\*$/,'').toLowerCase()} options`} aria-controls={`${id}-list`} aria-activedescendant={active>=0&&filtered[active]?optionId(active):undefined} autoComplete="off" spellCheck={false} value={query} disabled={creating} maxLength={onCreate?100:2000} placeholder={onCreate?'Search or create…':'Search options…'} onChange={e=>changeQuery(e.target.value)}/>{query&&<button type="button" tabIndex={-1} disabled={creating} className="dropdown-clear" aria-label="Clear dropdown search" onMouseDown={e=>e.preventDefault()} onClick={()=>{setQuery('');setCreateError('');setActive(choices.findIndex(o=>o.value===String(value??'')));search.current?.focus();}}><X size={13}/></button>}</div>}
   <div role="listbox" id={`${id}-list`} aria-label={`${label} options`} aria-busy={creating||undefined} className="dropdown-options" style={{maxHeight:position.listHeight}}>
    {filtered.map((item,index)=><button key={item.create?'create':`option-${item.value}`} id={optionId(index)} type="button" role="option" tabIndex={-1} aria-label={item.create?`Create ${cleanQuery}`:undefined} aria-selected={!item.create&&item.value===String(value??'')} aria-disabled={item.disabled||undefined} disabled={item.disabled||creating} data-active={index===active} className={`dropdown-option ${item.empty?'empty-option':''} ${item.create?'create-option':''}`} onPointerMove={()=>!item.disabled&&setActive(index)} onMouseDown={e=>e.preventDefault()} onClick={()=>choose(item)}>{item.create&&(creating?<Loader2 className="spin" size={15}/>:<Plus size={15}/>)}<span><span>{item.create&&creating?'Creating…':item.label}</span>{item.description&&<small>{item.description}</small>}</span><span className="dropdown-tick">{!item.create&&item.value===String(value??'')&&<Check size={15} strokeWidth={2}/>}</span></button>)}
    {!filtered.length&&!loadingOptions&&<div className="dropdown-no-results">{query?'No matching options':'No options available'}</div>}
    {loadingOptions&&<div className="dropdown-directory-note"><Loader2 size={13} className="spin"/>Searching directory…</div>}
   </div>
   {lookupError&&<div className="dropdown-directory-note">{lookupError}</div>}
   {createError&&<div className="dropdown-create-error" role="alert">{createError}</div>}
  </div>,document.body)}
 </div>;
}
