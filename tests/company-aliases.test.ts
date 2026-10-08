import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalCompanyName,companyAliases} from '../packages/workflows/src/company-aliases.js';
test('every fictional company and channel alias resolves without substring guessing',()=>{
 for(const entry of companyAliases)for(const alias of [entry.company,...entry.aliases,...entry.channelAliases??[]])assert.equal(canonicalCompanyName(`  ${alias.toUpperCase()}  `),entry.company);
 assert.equal(canonicalCompanyName('AL|DER'),'Example Alder Systems Inc');
 assert.equal(canonicalCompanyName('EXW printer problem'),'EXW printer problem');
 assert.equal(canonicalCompanyName('unknown'),'unknown');
 assert.equal(canonicalCompanyName('OBS   Capital'),'Example Observatory Capital');
});
