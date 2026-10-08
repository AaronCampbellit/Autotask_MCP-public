/** Fictional example shorthand for offline demos/tests. Replace this roster for your own tenant; aliases grant no access. */
export const companyAliases: ReadonlyArray<{company:string;aliases:readonly string[];channelAliases?:readonly string[]}>= [
 {company:'Example Alder Systems Inc',aliases:['ALDER','AL|DER','ALIDER']},
 {company:'Example Birch Climate',aliases:['Birch']},
 {company:'Example Cedar Arts League',aliases:['EXCAL']},
 {company:'Example Dogwood Design LLC',aliases:['Dogwood','Dogwood Design','EXDD']},
 {company:'Example Elm Manufacturing',aliases:['Elm']},
 {company:'Example Fir Partners',aliases:['Fir','FIR']},
 {company:'Example Hazel Cooling',aliases:['Hazel Air','Hazel']},
 {company:'Example Hawthorn Architects Inc',aliases:['EXHA']},
 {company:'Example Linden Household',aliases:['Linden']},
 {company:'Example Maple Planning',aliases:['Maple']},
 {company:'Example Oak Engineering',aliases:['Oak']},
 {company:'Example Willow Architects',aliases:['EXA']},
 {company:'Example Redwood Metals',aliases:['Redwood Metals','EXRM']},
 {company:'Example Sequoia Services',aliases:['Sequoia'],channelAliases:['EXSEQ']},
 {company:'Example Tamarack Inc',aliases:['EXTAM']},
 {company:'Example Northstar Community Events Authority',aliases:['EXNCEA']},
 {company:'Example Walnut Company Ltd',aliases:['Walnut']},
 {company:'Example Observatory Capital',aliases:['OBS','OBS Capital','Observatory','Obs capital']},
 {company:'Example Larch MEP Consultants',aliases:['Example Larch MEP','EXMEP']},
 {company:'Example Juniper and Redwood',aliases:['EXW']},
 {company:'Example Magnolia Valve Sales Inc',aliases:['EXValve','EX Valve']},
 {company:'Example Spruce',aliases:[],channelAliases:['Spruce PM']},
 {company:'Example Beech Motors Inc',aliases:['Beech Motors']},
 {company:'Example Sycamore Energy',aliases:['Sycamore']},
 {company:'Example Cypress Holdings LLC',aliases:['EXCY','Cypress Holdings']},
 {company:'Example Hemlock Resources',aliases:['Hemlock']},
 {company:'Example Poplar Advisory',aliases:['EXPA','Poplar']},
 {company:'Example Acacia Design Studio',aliases:['Acacia','AcaciaDesignStudio']},
 {company:'Example Chestnut Associates',aliases:['EXCA']},
];
const normalize=(name:string)=>name.trim().replace(/\s+/g,' ').toLowerCase();
const aliases=new Map<string,string>();
for(const entry of companyAliases)for(const name of [entry.company,...entry.aliases,...entry.channelAliases??[]]){
 const key=normalize(name),prior=aliases.get(key);
 if(prior&&prior!==entry.company)throw new Error('Conflicting company alias');
 aliases.set(key,entry.company);
}
/** Exact shorthand only: never replace substrings in titles or infer unknown abbreviations. */
export function canonicalCompanyName(name:string):string{return aliases.get(normalize(name))??name.trim();}
