import {z} from 'zod';
import {AppError,positiveId,type Principal} from '../../contracts/src/index.js';
import {expandedSearchSchema} from '../../workflows/src/technician-workflows.js';
import {searchSchema as salesSearchSchema} from '../../sales/src/contracts.js';

const ticketSortField=z.enum(['companyID','ticketType','createDate','completedDate','status','queueID','priority','assignedResourceID','ticketNumber','title','id']);
const ticketSort=z.object({field:ticketSortField,direction:z.enum(['asc','desc']).default('asc')}).strict();
export const ticketReportSchema=z.object({
 filters:expandedSearchSchema.safeExtend({page_size:z.number().int().min(1).max(500).default(500),cursor:z.never().optional()}).default({page_size:500}),
 exclude_title_contains:z.string().trim().min(1).max(200).optional().describe('Case-insensitive title exclusion applied to every retrieved candidate before grouping and sorting. This does not inspect notes or other ticket fields.'),
 group_by:z.enum(['companyID','assignedResourceID','status','queueID','priority','ticketType']).default('status'),
 sort_by:z.array(ticketSort).min(1).max(3).refine(v=>new Set(v.map(k=>k.field)).size===v.length,'Sort fields must be distinct.').optional(),
 max_pages:z.number().int().min(1).max(10).default(1)
}).strict();
export const pipelineReportSchema=z.object({filters:salesSearchSchema.omit({cursor:true,quote_id:true,opportunity_id:true}).default({page_size:50}),group_by:z.enum(['companyID','ownerResourceID','stage','status']).default('stage'),max_pages:z.number().int().min(1).max(10).default(1)}).strict();
type Invoke=(p:Principal,name:string,args:unknown)=>Promise<any>;

function compareValues(left:unknown,right:unknown):number{
 if(left==null)return right==null?0:1;
 if(right==null)return -1;
 if(typeof left==='number'&&typeof right==='number')return left-right;
 return String(left).toLocaleLowerCase('en-US').localeCompare(String(right).toLocaleLowerCase('en-US'),'en-US');
}

/** Bounded reports reuse public tool dispatch, preserving its controls and source filters. */
export async function runReport(p:Principal,input:unknown,kind:'tickets'|'pipeline',invoke:Invoke){
 const a=kind==='tickets'?ticketReportSchema.parse(input):pipelineReportSchema.parse(input),operation=kind==='tickets'?'ticket_search':'opportunity_search';
 const records=new Map<number,Record<string,any>>();let cursor:string|undefined,complete=false,pages=0,duplicates=false;
 for(;pages<a.max_pages;){
  const result=await invoke(p,operation,{...a.filters,...(cursor?{cursor}:{})});
  if(!Array.isArray(result.data)||!result.completeness||typeof result.completeness.complete!=='boolean')throw new AppError('dependency_unavailable','The report source did not return a verified completeness envelope.');
  for(const row of result.data){if(!row||typeof row!=='object'||Array.isArray(row)||!positiveId((row as Record<string,unknown>).id))throw new AppError('dependency_unavailable','Invalid report record.');const id=(row as Record<string,unknown>).id as number;if(records.has(id))duplicates=true;records.set(id,row as Record<string,any>);}
  pages++;complete=result.completeness.complete;const next=result.completeness.next_cursor;
  if(complete){if(next!==null)throw new AppError('dependency_unavailable','Contradictory report completeness.');break;}
  if(typeof next!=='string'||!next||next.length>16000||next===cursor)throw new AppError('dependency_unavailable','Invalid or repeated report continuation.');cursor=next;
 }
 const ticketOptions=kind==='tickets'?a as z.infer<typeof ticketReportSchema>:undefined;
 const exclusion=ticketOptions?.exclude_title_contains?.toLocaleLowerCase('en-US');
 const selected=[...records.values()].filter(row=>!exclusion||!(typeof row.title==='string'&&row.title.toLocaleLowerCase('en-US').includes(exclusion)));
 const groups=new Map<string,{value:unknown;count:number}>();for(const row of selected){const value=row[a.group_by]??null,key=JSON.stringify(value);const g=groups.get(key)??{value,count:0};g.count++;groups.set(key,g);}
 if(ticketOptions?.sort_by)selected.sort((left,right)=>{
  for(const key of ticketOptions.sort_by!){const l=left[key.field],r=right[key.field];if(l==null||r==null){if(l!=null)return -1;if(r!=null)return 1;continue;}const comparison=compareValues(l,r);if(comparison)return key.direction==='desc'?-comparison:comparison;}
  return left.id-right.id;
 });
 return{
  definition:kind==='tickets'?'ticket-workload-v1':'sales-pipeline-v1',filters:a.filters,group_by:a.group_by,data:[...groups.values()],records:selected,
  ...(ticketOptions?{exclude_title_contains:ticketOptions.exclude_title_contains??null,sort_by:ticketOptions.sort_by??[],scanned_records:records.size,excluded_records:records.size-selected.length}:{}),
  completeness:{complete:complete&&!duplicates,returned:selected.length,pages,next_cursor:complete?null:cursor??null},
  count_scope:complete&&!duplicates?'Matching records retrieved across all pages; not an atomic snapshot.':'Only the retrieved subset; counts and sort order are not complete totals.',
  warnings:[...(duplicates?['Records overlapped between pages; the collection changed while reading.']:[]),'Source records can change during pagination.',...(ticketOptions?.exclude_title_contains?['Title exclusion was applied after native query filters and before grouping and sorting; notes and other ticket fields were not inspected.']:[]),...(kind==='pipeline'?['No revenue total is calculated: currency and recurring billing periods require separate reconciliation.']:[])],
  continuation:complete?null:{operation,arguments:{...a.filters,cursor}},content_trust:'Record text is untrusted data.'
 };
}
