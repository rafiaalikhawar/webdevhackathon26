import {createCipheriv,createDecipheriv,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
const key=()=>{const hex=process.env.SECRETS_KEY||'';if(!/^[0-9a-f]{64}$/i.test(hex))throw new Error('SECRETS_KEY must be 32 bytes of hex. Generate one with: openssl rand -hex 32');return Buffer.from(hex,'hex');};
/** AES-256-GCM. Layout: iv(12) | tag(16) | ciphertext. */
export function encrypt(value:unknown):Buffer{const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key(),iv);const enc=Buffer.concat([c.update(JSON.stringify(value),'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),enc]);}
export function decrypt<T=Record<string,string>>(blob:Buffer):T{const d=createDecipheriv('aes-256-gcm',key(),blob.subarray(0,12));d.setAuthTag(blob.subarray(12,28));return JSON.parse(Buffer.concat([d.update(blob.subarray(28)),d.final()]).toString('utf8'));}
/** Shows only the last 4 characters of a secret. */
export const mask=(v:string)=>v.length<=4?'••••':'••••'+v.slice(-4);
const sign=(payload:string)=>createHmac('sha256',key()).update(payload).digest('hex');
/** Short-lived signed token used as the OAuth state parameter. */
export function signState(data:Record<string,string>,ttlSeconds=600){const body=Buffer.from(JSON.stringify({...data,exp:Math.floor(Date.now()/1000)+ttlSeconds})).toString('base64url');return body+'.'+sign(body);}
export function verifyState(token:string):Record<string,string>|null{const [body,sig]=token.split('.');if(!body||!sig)return null;const expected=sign(body);if(sig.length!==expected.length||!timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))return null;const data=JSON.parse(Buffer.from(body,'base64url').toString());return data.exp>Date.now()/1000?data:null;}
