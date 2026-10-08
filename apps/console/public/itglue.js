export async function renderItGlue(content,{api,node,button,panel,table,notice,refresh}){
 const state=await api('api/itglue/status');
 const connection=panel('IT Glue connection','Save a regional API key, verify organization mappings, then enable documentation tools. Keys are encrypted and never displayed.');
 connection.append(node('p',state.configured?'Credentials saved':'No credentials saved'));
 const form=node('form'),regionLabel=node('label','Region'),region=node('select');
 for(const [value,label]of [['us','United States'],['eu','Europe'],['au','Australia']]){const o=node('option',label);o.value=value;o.selected=value===state.region;region.append(o);}regionLabel.append(region);form.append(regionLabel);
 const keyLabel=node('label',state.configured?'Replace API key (leave blank to retain)':'API key'),key=node('input');key.type='password';key.autocomplete='new-password';keyLabel.append(key);form.append(keyLabel);
 form.append(node('p','Changing the key or region disables tools and removes organization mappings. Verify mappings again before enabling access.'));
 const save=node('button','Save credentials');save.type='submit';form.append(save);
 form.addEventListener('submit',async e=>{e.preventDefault();save.disabled=true;try{const changed=region.value!==state.region||!!key.value;await api('api/itglue/connection',{version:state.version,region:region.value,...(key.value?{key:key.value}:{}),enabled:changed?false:state.enabled,writes_enabled:changed?false:state.writes_enabled});key.value='';notice('IT Glue credentials saved.');await refresh();}catch(error){notice(error.message,true);}finally{save.disabled=false;}});connection.append(form);content.append(connection);
 const mappings=panel('Verified company mappings','Companies load automatically using their native Autotask associations. Add the companies you want available to documentation tools.');
 const discovered=node('div');mappings.append(discovered);
 const loadCompanies=async()=>{discovered.replaceChildren(node('p','Loading IT Glue companies…'));try{
  const items=[];let offset=0,version=state.version;
  do{const page=await api('api/itglue/discover',{offset});if(page.version!==version)throw Error('Connection changed. Reload this page.');items.push(...page.items);offset=page.next_offset;}while(offset!==null);
  discovered.replaceChildren(node('p',items.length?`${items.length} linked organizations found.`:'No native Autotask associations found for your accessible companies. Check the Autotask integration in IT Glue.'));
  discovered.append(table(['IT Glue organization','Autotask company',''],items,v=>[v.name,String(v.companyId),state.organizations[v.id]?node('span','Mapped'):button('Verify and add',async()=>{await api('api/itglue/mapping',{version:state.version,organization_id:v.id,company:v.companyId,enabled:true});await refresh();})]));
 }catch(error){discovered.replaceChildren(node('p',error.message));discovered.append(button('Retry loading companies',loadCompanies));}};
 mappings.append(table(['IT Glue organization','Autotask company','Verified',''],Object.entries(state.organizations).map(([id,v])=>({id,...v})),v=>[v.id,String(v.companyId),v.verifiedAt,button('Remove mapping',async()=>{await api('api/itglue/mapping',{version:state.version,organization_id:v.id,company:v.companyId,enabled:false});await refresh();})]));
 const mapping=node('form'),field=(label)=>{const l=node('label',label),i=node('input');i.type='text';i.inputMode='numeric';i.required=true;l.append(i);mapping.append(l);return i;},organization=field('IT Glue organization ID'),company=field('Autotask company ID');
 const verify=node('button','Verify and add mapping');verify.type='submit';verify.disabled=!state.configured;mapping.append(verify);
 mapping.addEventListener('submit',async e=>{e.preventDefault();verify.disabled=true;try{if(!/^[1-9][0-9]*$/.test(organization.value)||!/^\d+$/.test(company.value)||!Number.isSafeInteger(Number(company.value)))throw Error('Enter exact numeric organization and company IDs.');await api('api/itglue/mapping',{version:state.version,organization_id:organization.value,company:Number(company.value),enabled:true});notice('Native Autotask association verified.');await refresh();}catch(error){notice(error.message,true);}finally{verify.disabled=!state.configured;}});mappings.append(mapping);content.append(mappings);
 const access=panel('Documentation access','Employees also need explicit documentation permissions and existing access to the mapped Autotask company.');
 const accessForm=node('form'),toggle=(label,checked)=>{const l=node('label',undefined,'check'),i=node('input');i.type='checkbox';i.checked=checked;l.append(i,node('span',label));accessForm.append(l);return i;};
 const enabled=toggle('Enable documentation reads',state.enabled),writes=toggle('Enable reviewed documentation writes',state.writes_enabled),submit=node('button','Save access settings');submit.type='submit';
 const update=()=>{enabled.disabled=!state.configured||!Object.keys(state.organizations).length;writes.disabled=enabled.disabled||!enabled.checked;if(!enabled.checked)writes.checked=false;submit.disabled=enabled.disabled;};enabled.addEventListener('change',update);update();
 accessForm.append(submit);accessForm.addEventListener('submit',async e=>{e.preventDefault();submit.disabled=true;try{await api('api/itglue/connection',{version:state.version,region:state.region,enabled:enabled.checked,writes_enabled:writes.checked});notice('Documentation access saved. Refresh MCP tool discovery.');await refresh();}catch(error){notice(error.message,true);}finally{update();}});access.append(accessForm);content.append(access);
 if(state.configured)await loadCompanies();
}
