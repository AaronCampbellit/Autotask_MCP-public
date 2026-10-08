import {AppError} from '../../contracts/src/index.js';

// Contacts.isActive is an integer in REST. Accept booleans from compatible
// adapters too, but never turn missing/malformed status into an inactive claim.
export function contactIsActive(value:unknown):boolean {
 if(value===1||value===true)return true;
 if(value===0||value===false)return false;
 throw new AppError('dependency_unavailable','The contact active status is unavailable or invalid.');
}
