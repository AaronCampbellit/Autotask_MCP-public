import {z} from 'zod';
import type {PageCursor} from './contracts.js';
export const historyFilterSchema=z.object({
 kind:z.enum(['activity','audit']), user:z.string().uuid().optional(), action:z.string().regex(/^[a-z][a-z0-9_.-]{0,99}$/).optional(),
 state:z.enum(['ready','dispatching','succeeded_verified','accepted_unverified','failed','unknown_outcome','partial','queued','running','succeeded','cancelled','expired','uncertain']).optional(),
 from:z.iso.datetime().optional(),to:z.iso.datetime().optional(),q:z.string().trim().max(160).optional(),limit:z.number().int().min(1).max(100).default(50),
 cursor:z.object({at:z.iso.datetime(),id:z.string().uuid()}).strict().optional()
}).strict().refine(v=>!v.from||!v.to||v.from<=v.to,{message:'Start date must precede end date.'});
export type HistoryFilter=z.infer<typeof historyFilterSchema>;
export interface HistoryItem {id:string;userId:string;action:string;state?:string;at:string;updatedAt:string;targetType?:string;targetId?:string}
export const auditLabels:Record<string,string>={
 'diagnostic.detail_viewed':'Viewed diagnostic details','diagnostic.exported':'Exported sanitized diagnostics',
 'member.saved':'Updated employee permissions','template.saved':'Saved permission template','controls.saved':'Updated operation controls',
 'job.queued':'Queued background work','job.claimed':'Started background work','job.dispatched':'Sent background request','job.finished':'Finished background work',
 'job.cancelled':'Cancelled background work','job.cancel_requested':'Requested cancellation','job.expired':'Background work expired','job.uncertain':'Background outcome needs checking','job.payload_purged':'Removed expired background inputs'
};
const entities:Record<string,string>={opportunities:'opportunity',quotes:'quote',quoteitems:'quote item',companynotes:'opportunity note',quotelocations:'quote location',contracts:'contract',contractservices:'contract service',contractblocks:'contract block',contractcharges:'contract charge',contractserviceadjustments:'contract service adjustment',contractservicebundleadjustments:'contract bundle adjustment',contractservicebundleunits:'contract bundle units',contractserviceunits:'contract service units',invoices:'invoice',projects:'project',phases:'project phase',tasks:'project task',taskpredecessors:'task dependency',projectnotes:'project note',tasknotes:'task note',companytodos:'client to-do',configurationitems:'asset',configurationitemdnsrecords:'asset DNS record',configurationitemnotes:'asset note',subscriptions:'subscription',products:'product',inventoryproducts:'inventory product',inventoryitems:'inventory item',inventorystockeditems:'stocked item',inventorystockeditemsadd:'inventory addition',inventorystockeditemsremove:'inventory removal',inventorystockeditemstransfer:'inventory transfer',inventorytransfers:'inventory transfer record',purchaseorders:'purchase order',purchaseorderitems:'purchase order item',purchaseorderitemreceiving:'purchase receipt'};
export const historyActionLabels:Record<string,string>=Object.fromEntries(['sales','business'].flatMap(prefix=>Object.entries(entities).flatMap(([entity,label])=>['create','update','delete'].map(action=>[`${prefix}_${entity}_${action}`,`${action[0]!.toUpperCase()+action.slice(1)} ${label}`]))));
const searchLabels={...auditLabels,...historyActionLabels};
export function matchesHistory(row:HistoryItem,f:HistoryFilter){
 return (!f.user||row.userId===f.user)&&(!f.action||row.action===f.action)&&(!f.state||row.state===f.state)&&(!f.from||row.at>=f.from)&&(!f.to||row.at<=f.to)&&(!f.cursor||row.at<f.cursor.at||(row.at===f.cursor.at&&row.id<f.cursor.id))&&
 (f.q??'').toLowerCase().split(/\s+/).filter(Boolean).every(word=>`${row.id} ${row.action.replaceAll('_',' ')} ${searchLabels[row.action]??''} ${row.state??''} ${row.targetType??''} ${row.targetId??''}`.toLowerCase().includes(word));
}
