export const normalise=value=>String(value??'').normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('en-IN');
export const matchesOption=(option,query)=>{const text=normalise([option.label,option.description,...(option.aliases||[])].filter(Boolean).join(' '));return normalise(query).split(' ').filter(Boolean).every(word=>text.includes(word));};
export const exactOption=(option,query)=>!option.empty&&!option.create&&[option.label,...(option.aliases||[])].some(name=>normalise(name)===normalise(query));
