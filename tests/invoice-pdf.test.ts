import assert from 'node:assert/strict';
import test from 'node:test';
import {decodeInvoicePdf} from '../packages/business/src/invoice-pdf.js';
const bytes=Buffer.from('%PDF-1.7\nfixture\n%%EOF');
const envelope={id:123,contentType:'application/pdf',fileName:'invoice-123.pdf',fileSize:bytes.length,data:[...bytes]};
test('invoice export decodes the native file envelope rather than JSON bytes',()=>{assert.equal(decodeInvoicePdf(envelope,123).data_base64,bytes.toString('base64'));assert.equal(decodeInvoicePdf({...envelope,data:bytes.toString('base64')},123).bytes,bytes.length);});
test('invoice export rejects wrong identity, corrupt bytes, mismatched size and non-PDF responses',()=>{for(const invalid of [{...envelope,id:124},{...envelope,fileSize:1},{...envelope,data:[...bytes.slice(0,-1),256]},{...envelope,data:[...bytes.slice(0,-1),null]},{...envelope,contentType:'text/html'},{...envelope,data:[...Buffer.alloc(bytes.length)]},{errors:['not found']}])assert.throws(()=>decodeInvoicePdf(invalid,123));});
