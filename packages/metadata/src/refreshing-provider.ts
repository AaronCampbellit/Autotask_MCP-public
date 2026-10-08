import type { Principal, TicketTimeCreate } from '../../contracts/src/index.js';
import type { ReferenceContext, ReferenceKind } from '../../technician/src/index.js';
import { metadataError, metadataHash, validateSnapshot, readOnlyDefinitionDigest } from './index.js';
import type { MetadataSnapshot } from './contracts.js';
import { loadMetadataSnapshot, verifyLocalSources } from './files.js';
import { MetadataSnapshotProvider, type MetadataProviderOptions } from './provider.js';

export interface RefreshingMetadataProviderOptions extends MetadataProviderOptions {
  allowReadOnlyRenewal?:boolean;
  snapshotPath:string;workspaceRoot:string;refreshIntervalMs?:number;
}
/** A fixed local path is re-read and all evidence is verified before an atomic provider replacement. */
export class RefreshingMetadataSnapshotProvider {
  private current:MetadataSnapshotProvider|undefined;
  private readonly expectedDigest:string;
  private readonly expectedReadDefinition?:string;
  private readonly expectedQualifications:string;
  private checkedAt:number;
  private readonly interval:number;
  private pending:Promise<MetadataSnapshotProvider>|undefined;
  constructor(initialSnapshot:unknown,private readonly options:RefreshingMetadataProviderOptions) {
    this.checkedAt=options.clock?.()??Date.now();this.interval=options.refreshIntervalMs??30_000;
    if(!Number.isSafeInteger(this.interval)||this.interval<1||this.interval>30_000)throw metadataError();
    const snapshot=validateSnapshot(initialSnapshot,{inventory:options.inventory,now:this.checkedAt});this.expectedDigest=snapshot.metadataDigest;
    if(options.allowReadOnlyRenewal)this.expectedReadDefinition=readOnlyDefinitionDigest(snapshot);
    this.expectedQualifications=this.qualificationFingerprint(snapshot);
    this.current=new MetadataSnapshotProvider(snapshot,options);
  }
  private qualificationFingerprint(snapshot:MetadataSnapshot):string {
    const sourceIds=new Set(snapshot.qualifications.flatMap(row=>row.sourceIds));
    return metadataHash({qualifications:snapshot.qualifications,sources:snapshot.content.sources.filter(source=>sourceIds.has(source.id))});
  }
  private async provider():Promise<MetadataSnapshotProvider> {
    const now=this.options.clock?.()??Date.now();
    if(this.pending)return this.pending;
    if(now>=this.checkedAt&&now-this.checkedAt<this.interval) {if(!this.current)throw metadataError();return this.current;}
    // Once due, no caller may continue using the old provider, including after a failed load.
    this.current=undefined;
    this.pending=(async()=>{
      try {
        const snapshot=await loadMetadataSnapshot(this.options.snapshotPath,{inventory:this.options.inventory,now});
        if((this.expectedReadDefinition?readOnlyDefinitionDigest(snapshot)!==this.expectedReadDefinition:snapshot.metadataDigest!==this.expectedDigest)||this.qualificationFingerprint(snapshot)!==this.expectedQualifications)throw metadataError();
        const verifiedSources=await verifyLocalSources(snapshot,this.options.workspaceRoot);
        const replacement=new MetadataSnapshotProvider(snapshot,{...this.options,verifiedSources});
        this.current=replacement;return replacement;
      } finally {this.checkedAt=this.options.clock?.()??Date.now();this.pending=undefined;}
    })();
    return this.pending;
  }
  readonly resolveTicketWork=async(p:Principal,ticketId:number)=>(await this.provider()).resolveTicketWork(p,ticketId);
  readonly resolveTechnicianMetadata=async(p:Principal,ticketId:number)=>(await this.provider()).resolveTechnicianMetadata(p,ticketId);
  readonly resolveCatalog=async(p:Principal,kind:ReferenceKind,context:ReferenceContext={})=>(await this.provider()).resolveCatalog(p,kind,context);
  readonly resolveSchedulingMetadata=async(p:Principal,ticketId:number)=>(await this.provider()).resolveSchedulingMetadata(p,ticketId);
  readonly resolveResources=async(p:Principal)=>(await this.provider()).resolveResources(p);
  readonly validateTicketTimeEligibility=async(p:Principal,ticketId:number,payload:Readonly<TicketTimeCreate>)=>(await this.provider()).validateTicketTimeEligibility(p,ticketId,payload);
  readonly getResourceVerification=async(tenantId:string,resourceId:number)=>(await this.provider()).getResourceVerification(tenantId,resourceId);
  readonly verifyResource=async(tenantId:string,resourceId:number)=>(await this.provider()).verifyResource(tenantId,resourceId);
}
