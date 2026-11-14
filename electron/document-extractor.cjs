const path=require('node:path');
const {unzipSync}=require('fflate');
const sax=require('sax');
const VERSION=`text-v2-pdfjs-${require('pdfjs-dist/package.json').version}-sax-${require('sax/package.json').version}`;
const clean=s=>s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').replace(/\r/g,'').trim();
function extractDocx(buffer){
 let total=0;
 const entries=unzipSync(buffer,{filter:f=>{if(!/^word\/(document|header\d+|footer\d+|footnotes|endnotes|comments)\.xml$/.test(f.name))return false;total+=f.originalSize;if(f.originalSize>20*1024*1024||total>60*1024*1024)throw Error('Word text exceeds extraction limits.');return true;}});
 if(!entries['word/document.xml'])throw Error('Word document has no document body.');
 const names=Object.keys(entries).sort((a,b)=>a==='word/document.xml'?-1:b==='word/document.xml'?1:a.localeCompare(b,undefined,{numeric:true})),sections=[];
 for(const name of names){
  const part=name==='word/document.xml'?'Body':path.basename(name,'.xml');let number=0,paragraph=null,inText=false,deleted=0,tableCount=0,tables=[],note='';
  const parser=sax.parser(true,{xmlns:true,strictEntities:true});
  parser.ondoctype=()=>{throw Error('Document XML with a DTD is unsupported.');};
  parser.onopentag=node=>{
   const tag=node.local;if(tag==='del')deleted++;
   if(tag==='tbl'){tables.push({id:++tableCount,row:0,cell:0});}if(tag==='tr'&&tables.length){tables.at(-1).row++;tables.at(-1).cell=0;}if(tag==='tc'&&tables.length)tables.at(-1).cell++;
   if(['footnote','endnote','comment'].includes(tag))note=Object.values(node.attributes).find(a=>a.local==='id')?.value||'';
   if(tag==='p'){const t=tables.at(-1);paragraph={location:`${part}${note?' note '+note:''} paragraph ${++number}${t?` · table ${t.id}, row ${t.row}, cell ${t.cell}`:''}`,text:''};}
   if(tag==='t'&&!deleted)inText=true;if((tag==='tab'||tag==='br'||tag==='cr')&&paragraph&&!deleted)paragraph.text+=tag==='tab'?'\t':'\n';
  };
  parser.ontext=t=>{if(inText&&paragraph&&!deleted)paragraph.text+=t;};
  parser.onclosetag=name=>{const tag=name.split(':').at(-1);if(tag==='t')inText=false;if(tag==='del')deleted--;if(tag==='p'&&paragraph){paragraph.text=clean(paragraph.text);if(paragraph.text)sections.push(paragraph);paragraph=null;}if(tag==='tbl')tables.pop();if(['footnote','endnote','comment'].includes(tag))note='';};
  parser.write(Buffer.from(entries[name]).toString('utf8')).close();
 }
 return{sections,status:sections.length?'ready':'empty',warning:'DOCX locations refer to XML paragraphs and tables, not rendered page numbers. Tracked deletions and field codes are omitted; check originals for layout, drawings and revisions.'};
}
let pdfModule;
async function extractPdf(buffer){
 pdfModule??=import('pdfjs-dist/legacy/build/pdf.mjs');const pdfjs=await pdfModule;
 const base=path.dirname(require.resolve('pdfjs-dist/package.json'));
 const resource=folder=>path.join(base,folder).split(path.sep).join('/')+'/';
 const task=pdfjs.getDocument({data:new Uint8Array(buffer),isEvalSupported:false,useSystemFonts:false,useWorkerFetch:false,disableFontFace:true,cMapUrl:resource('cmaps'),cMapPacked:true,standardFontDataUrl:resource('standard_fonts'),wasmUrl:resource('wasm')});
 let pdf;try{
  pdf=await task.promise;if(pdf.numPages>2000)throw Error('PDF exceeds the 2,000 page extraction limit.');const sections=[];let empty=0,total=0;
  for(let i=1;i<=pdf.numPages;i++){
   const page=await pdf.getPage(i),content=await page.getTextContent();let text='',previous=null;
   for(const item of content.items){if(typeof item.str!=='string')continue;if(previous&&Math.abs(item.transform[5]-previous.transform[5])>2)text+='\n';else if(previous&&item.transform[4]-(previous.transform[4]+previous.width)>1)text+=' ';text+=item.str;if(item.hasEOL)text+='\n';previous=item;}
   text=clean(text);total+=text.length;if(total>12*1024*1024)throw Error('PDF text exceeds extraction limits.');if(!text)empty++;sections.push({location:`PDF page ${i}`,text});page.cleanup();
  }
  return{sections,status:empty===pdf.numPages?'needs-ocr':empty?'partial':'ready',warning:empty?`${empty} of ${pdf.numPages} pages have no extractable text. They may contain scans or be blank; OCR is not available yet.`:'PDF reading order and tables may differ from the visual layout. Verify quoted text against the original page.'};
 }finally{await task.destroy();}
}
async function extractDocument(buffer,extension){
 const result=extension.toLowerCase()==='.docx'?extractDocx(buffer):extension.toLowerCase()==='.pdf'?await extractPdf(buffer):(()=>{throw Error('Unsupported document format.');})();
 if(result.sections.reduce((n,s)=>n+s.text.length,0)>12*1024*1024)throw Error('Document text exceeds extraction limits.');return result;
}
module.exports={VERSION,extractDocument,extractDocx};
