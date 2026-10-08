import {assertExecutionActive,traceStage} from '../../execution/src/index.js';
import {AppError} from '../../contracts/src/index.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Principal, PrincipalStore } from '../../contracts/src/index.js';
import type { ControlPlaneService } from './index.js';

/** Request-local tool identity is retained through queue waits and every reauthorization. */
export class ExecutionControls {
  private readonly context = new AsyncLocalStorage<readonly string[]>();
  private readonly guards = new AsyncLocalStorage<readonly (() => Promise<void>)[]>();
  private accepting=true;
  private readonly active=new Set<Promise<unknown>>();
  constructor(private readonly controls: ControlPlaneService) {}
  async run<T>(p: Principal, operations: readonly string[], action: () => Promise<T>): Promise<T> {
    assertExecutionActive();
    const parent=this.context.getStore();
    if(!this.accepting&&!parent)throw new AppError('dependency_unavailable','Connection settings are being applied. Retry shortly.');
    const combined = [...new Set([...(parent ?? []), ...operations])];
    const task=(async()=>{for (const name of combined) await this.controls.assertDispatchAllowed(p, name);return this.context.run(combined, action);})();
    this.active.add(task);try{return await task;}finally{this.active.delete(task);}
  }
  /** Includes work that outlives a disconnected HTTP client. */
  async drain(){this.accepting=false;await Promise.allSettled([...this.active]);}
  resume(){this.accepting=true;}
  withGuard<T>(guard: () => Promise<void>, action: () => Promise<T>): Promise<T> {
    return this.guards.run([...(this.guards.getStore() ?? []), guard], action);
  }
  principalStore(base: PrincipalStore): PrincipalStore {
    return { get: async (tenantId, objectId) => {
      assertExecutionActive();
      for (const guard of this.guards.getStore() ?? []) await guard();
      for (const operation of this.context.getStore() ?? []) await this.controls.assertDispatchAllowed({ tenantId, objectId }, operation);
      return base.get(tenantId, objectId);
    } };
  }
}
