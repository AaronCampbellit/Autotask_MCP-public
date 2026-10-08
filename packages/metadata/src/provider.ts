import { AppError, type Principal, type TicketTimeCreate, type TicketWorkMetadata } from '../../contracts/src/index.js';
import { actorBinding, scopeOptions, type ReferenceCatalog, type ReferenceContext, type ReferenceKind, type TechnicianMetadata } from '../../technician/src/index.js';
import type { SchedulingMetadata, SchedulingResource } from '../../scheduling/src/contracts.js';
import { bindingLookupKey, canonicalMetadata, metadataError, validateMetadataBinding, validateSnapshot } from './index.js';
import type { EntityInventory, MetadataBinding, MetadataSnapshot, ResourceVerification } from './contracts.js';
import { eligibilityPayloadSchema, reviewedTimeEligibility, validateResourceEvidence } from './eligibility.js';

export interface MetadataProviderOptions {
  tenantId:string;source:'fixture'|'Autotask';clock?:()=>number;inventory?:EntityInventory;
  /** Populated only by local evidence-file verification; never from tool arguments. */
  verifiedSources?:Readonly<Record<string,string>>;
}
/** Immutable provider callbacks perform exact lookups. Missing contexts never inherit another employee's defaults. */
export class MetadataSnapshotProvider {
  private readonly snapshot:MetadataSnapshot;
  private readonly verifiedSources:Readonly<Record<string,string>>;
  constructor(value:unknown,private readonly options:MetadataProviderOptions) {
    this.snapshot=validateSnapshot(value,{inventory:options.inventory,now:options.clock?.()??Date.now()});
    this.verifiedSources={...options.verifiedSources};
    if(this.snapshot.content.tenantId!==options.tenantId||this.snapshot.content.source!==options.source)throw metadataError();
  }
  private lookup(p:Principal,kind:MetadataBinding['kind'],context:{ticketId?:number;referenceKind?:ReferenceKind;context?:ReferenceContext;workDate?:string}={}):MetadataBinding {
    const now=this.options.clock?.()??Date.now();validateSnapshot(this.snapshot,{inventory:this.options.inventory,now});
    if(!p.active||!p.capabilities.includes('operational.read')||p.tenantId!==this.options.tenantId||p.policyVersion!==this.snapshot.content.policyVersion)throw metadataError();
    const wanted=bindingLookupKey({kind,actor:actorBinding(p),...context});
    const binding=this.snapshot.content.bindings.find(row=>bindingLookupKey(row)===wanted);if(!binding)throw metadataError();
    if(canonicalMetadata([...new Set(p.companyIds)].sort((a,b)=>a-b))!==canonicalMetadata([...binding.companyIds].sort((a,b)=>a-b)))throw metadataError();
    if(this.options.source==='Autotask') {
      const requiredSources=new Set([...binding.sourceIds,...binding.requires.flatMap(requirement=>this.snapshot.content.entities.find(entity=>entity.entity===requirement.entity)!.sourceIds)]);
      for(const id of requiredSources) {const source=this.snapshot.content.sources.find(source=>source.id===id)!;
        if(source.kind!=='documentation'&&this.verifiedSources[id]!==source.sha256)throw new AppError('missing_metadata','The selected metadata evidence files have not been verified.');
      }
    }
    validateMetadataBinding(binding,this.snapshot.content,now);return structuredClone(binding);
  }
  private versioned<T extends {version:string;validUntil:string}>(binding:MetadataBinding):T {
    return{...(binding.value as T),version:this.snapshot.version,validUntil:new Date(Math.min(Date.parse(binding.validUntil),Date.parse(this.snapshot.content.expiresAt),Date.parse((binding.value as T).validUntil))).toISOString()};
  }
  readonly resolveTicketWork=async(p:Principal,ticketId:number):Promise<TicketWorkMetadata>=>this.versioned(this.lookup(p,'ticket-work',{ticketId}));
  readonly resolveTechnicianMetadata=async(p:Principal,ticketId:number):Promise<TechnicianMetadata>=>this.versioned(this.lookup(p,'technician',{ticketId}));
  readonly resolveCatalog=async(p:Principal,kind:ReferenceKind,context:ReferenceContext={}):Promise<ReferenceCatalog>=>{
    const catalog=this.versioned<ReferenceCatalog>(this.lookup(p,'catalog',{referenceKind:kind,context}));
    return{...catalog,items:scopeOptions(catalog.items,p,context)};
  };
  readonly resolveSchedulingMetadata=async(p:Principal,ticketId:number):Promise<SchedulingMetadata>=>this.versioned(this.lookup(p,'scheduling',{ticketId}));
  readonly resolveResources=async(p:Principal):Promise<SchedulingResource[]>=>structuredClone(this.lookup(p,'resources').value as SchedulingResource[]);
  readonly validateTicketTimeEligibility=async(p:Principal,ticketId:number,value:Readonly<TicketTimeCreate>):Promise<boolean>=>{
    const parsed=eligibilityPayloadSchema.safeParse(value);if(!parsed.success)throw metadataError();const payload=parsed.data,now=this.options.clock?.()??Date.now();
    if(payload.resourceID!==p.resourceId||!p.capabilities.includes('time.self'))throw metadataError();
    const binding=this.lookup(p,'time-eligibility',{ticketId,workDate:payload.dateWorked.slice(0,10)}),evidence=reviewedTimeEligibility(binding,this.snapshot.content,now);
    const assignment=evidence.assignments.find(row=>row.roleId===payload.roleID&&row.workTypeId===payload.billingCodeID);
    for(const [name,text] of [['summaryNotes',payload.summaryNotes],['internalNotes',payload.internalNotes]] as const) {
      const field=this.snapshot.content.entities.find(e=>e.entity==='TimeEntries')!.fields.find(f=>f.name===name)!;
      if(text!==undefined&&field.maxLength!==undefined&&text.length>field.maxLength)return false;
    }
    return evidence.period.status==='open'&&evidence.resourceActive&&evidence.ticketAllowsTime&&evidence.contractAllowsTime&&evidence.dateContainerVerified
      &&!!assignment&&assignment.roleEffective&&assignment.workTypeEffective&&payload.hoursWorked<=assignment.remainingHours;
  };
  readonly getResourceVerification=async(tenantId:string,resourceId:number):Promise<ResourceVerification>=>{
    const now=this.options.clock?.()??Date.now();validateSnapshot(this.snapshot,{inventory:this.options.inventory,now});
    const evidence=this.snapshot.content.resourceVerifications.find(row=>row.tenantId===tenantId&&row.resourceId===resourceId);
    if(tenantId!==this.options.tenantId||!evidence||!evidence.active)throw metadataError();
    validateResourceEvidence(evidence,this.snapshot.content,now,true);
    if(this.options.source==='Autotask')for(const id of evidence.sourceIds) {
      const source=this.snapshot.content.sources.find(source=>source.id===id)!;
      if(source.kind!=='documentation'&&this.verifiedSources[id]!==source.sha256)throw metadataError();
    }
    return structuredClone(evidence);
  };
  readonly verifyResource=async(tenantId:string,resourceId:number):Promise<boolean>=>{await this.getResourceVerification(tenantId,resourceId);return true;};
}
