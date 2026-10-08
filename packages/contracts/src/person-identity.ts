import {z} from 'zod';
import {AppError} from './index.js';
export const personIdentitySchema=z.object({name:z.string().trim().min(1).max(250).optional(),email:z.string().email().max(254).optional()}).strict().refine(v=>Boolean(v.name||v.email),{message:'Supply the intended full name or email.'});
export const ownerIdentitySchema=z.object({name:z.string().trim().min(1).max(250)}).strict();
export type PersonIdentity=z.infer<typeof personIdentitySchema>;
const normalize=(s:string)=>s.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('en-US');
export function assertPersonIdentity(expected:PersonIdentity|undefined,actual:{name?:string;email?:string},field:string){
 if(!expected)throw new AppError('invalid_input',`${field} requires the intended person name or email alongside the ID. Resolve the person from the user request before writing; do not reuse an unrelated ID.`);
 if((expected.name&&normalize(expected.name)!==normalize(actual.name??''))||(expected.email&&normalize(expected.email)!==normalize(actual.email??'')))throw new AppError('conflict',`${field} does not match the intended person. This person assignment was not authorized. Resolve the intended person again; do not change the intended name to fit the ID.`);
}
