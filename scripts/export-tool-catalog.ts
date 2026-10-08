import {effectMetadata} from '../apps/server/src/discovery.js';
import {writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {operationCatalog} from '../apps/server/src/tool-runtime.js';
import {outputJsonSchema,OUTPUT_CONTRACT_VERSION} from '../apps/server/src/output-contracts.js';
// Repeated contracts are stored once. Each entry is a standalone JSON Schema
// document (its local $defs/$refs must not be resolved against the catalog root).
const output_contracts:Record<string,ReturnType<typeof outputJsonSchema>>={};
const operations=Object.entries(operationCatalog).sort(([a],[b])=>a.localeCompare(b)).map(([name,entry])=>{
 const schema=outputJsonSchema(name),contract_id=createHash('sha256').update(JSON.stringify(schema)).digest('hex');
 output_contracts[contract_id]=schema;
 const effect=effectMetadata({name,write:entry.write});
 return{name,effect:effect.readOnly?'read':'write',effect_kind:effect.kind,capabilities:entry.capabilities,output_schema_version:OUTPUT_CONTRACT_VERSION,output_contract_id:contract_id};
});
await writeFile('docs/TOOL-CATALOG.json',JSON.stringify({schema_version:'runtime-catalog-v2',purpose:'Declared runtime catalog; configuration, member permissions and tool switches determine actual availability. Not evidence of live tests or authorization.',output_contract_usage:'Resolve each operation output_contract_id in output_contracts. Validate structuredContent against that standalone JSON Schema document. MCP isError results also include application error contracts; protocol/SDK errors may be text-only.',operations,output_contracts},null,2)+'\n');
console.log(`Exported ${operations.length} declared operations and ${Object.keys(output_contracts).length} distinct output contracts.`);
