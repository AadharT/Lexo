import React, {useEffect,useRef} from 'react';
import {X,Loader2,FolderOpen} from 'lucide-react';
import Dropdown from './Dropdown';
export {default as Dropdown} from './Dropdown';
export const api=window.lexo;
export const date=v=>v?new Date(v).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}):'—';
export const bytes=v=>v==null?'Unavailable':v<1024?`${v} B`:v<1048576?`${Math.round(v/1024)} KB`:`${(v/1048576).toFixed(1)} MB`;
export function Logo({small=false}){return <span className={`logo ${small?'small':''}`}><svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="17" fill="currentColor"/><path d="M17 15h9v29h22v8H17z" fill="#fff7ef"/><path d="M36 15h12v21H36z" fill="#582b24"/></svg>{!small&&<strong>lexo</strong>}</span>;}
export function Button({children,primary=false,danger=false,icon:Icon,className='',...props}){return <button className={`button ${primary?'primary':''} ${danger?'danger':''} ${className}`} {...props}>{Icon&&<Icon size={16}/>} {children}</button>;}
export function IconButton({icon:Icon,label,...props}){return <button className="icon-button" aria-label={label} title={label} {...props}><Icon size={17}/></button>;}
export function Field({label,hint,children,...props}){return <label className="field"><span>{label}</span>{children||<input {...props}/>} {hint&&<small>{hint}</small>}</label>;}
export function Select({label,...props}){return <div className="field"><span>{label}</span><Dropdown label={label} {...props}/></div>;}
export function Check({children,...props}){return <label className="check"><input type="checkbox" {...props}/><span>{children}</span></label>;}
export function Heading({title,description,children}){return <div className="page-heading"><div><h1>{title}</h1>{description&&<p>{description}</p>}</div><div className="button-group">{children}</div></div>;}
export function Empty({title,description,children,icon:Icon=FolderOpen}){return <div className="empty"><span><Icon size={25}/></span><h3>{title}</h3><p>{description}</p>{children}</div>;}
export function Badge({status}){const tone=status==='Closed'?'neutral':/review/i.test(status)?'violet':/await/i.test(status)?'amber':'green';return <span className={`badge ${tone}`}><i/>{status}</span>;}
export function Modal({title,onClose,children,wide=false,busy=false}){
 const ref=useRef(null),closeRef=useRef(onClose),busyRef=useRef(busy);closeRef.current=onClose;busyRef.current=busy;
 useEffect(()=>{const before=document.activeElement;const node=ref.current;node?.querySelector('input,select,textarea,button')?.focus();const handler=e=>{if(e.key==='Escape'&&!busyRef.current)closeRef.current();if(e.key==='Tab'){const nodes=[...node.querySelectorAll('button,input,select,textarea,[tabindex]')].filter(n=>n.tabIndex>=0&&!n.disabled&&n.offsetParent!==null),first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}};document.addEventListener('keydown',handler);return()=>{document.removeEventListener('keydown',handler);before?.focus();};},[]);
 return <div className="modal-backdrop"><section ref={ref} className={`modal ${wide?'wide':''}`} role="dialog" aria-modal="true" aria-label={title}><div className="modal-heading"><h2>{title}</h2><IconButton icon={X} label="Close dialog" disabled={busy} onClick={onClose}/></div>{children}</section></div>;
}
export const fieldTypes={text:'Text',longtext:'Long text',number:'Number',currency:'Currency (₹)',date:'Date',select:'Dropdown',checkbox:'Checkbox'};
export function displayValue(field,value){if(value===null||value===undefined||value==='')return '—';if(field.type==='checkbox')return value?'Yes':'No';if(field.type==='currency')return new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(Number(value));if(field.type==='date')return date(`${value}T00:00:00`);return String(value);}
export function CustomInput({field,value,onChange,onCreate}){
 const label=field.label+(field.required?' *':'');
 if(field.type==='checkbox')return <Check checked={!!value} required={!!field.required} onChange={e=>onChange(e.target.checked)}>{label}</Check>;
 if(field.type==='select')return <Select label={label} value={value??''} onChange={onChange} onCreate={onCreate} required={!!field.required} options={field.choices} placeholder="Select an option"/>;
 if(field.type==='longtext')return <Field label={label}><textarea value={value??''} onChange={e=>onChange(e.target.value)} required={!!field.required} maxLength={20000} rows={3}/></Field>;
 return <Field label={label} type={field.type==='date'?'date':['currency','number'].includes(field.type)?'number':'text'} step={['currency','number'].includes(field.type)?'any':undefined} value={value??''} onChange={e=>onChange(e.target.value)} required={!!field.required} maxLength={2000}/>;
}
