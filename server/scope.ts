import type {Request} from 'express';
import {transaction,DB} from './db.js';
import {context} from './auth.js';
import {Context,requirePermission} from './policy.js';
/** Runs fn inside a workspace-scoped transaction after authenticating and checking one permission. */
export async function scoped<T>(req:Request,permission:string,fn:(db:DB,ctx:Context)=>Promise<T>){const ctx=await context(req);requirePermission(ctx,permission);return transaction(ctx.workspaceId,db=>fn(db,ctx));}
