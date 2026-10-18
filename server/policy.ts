import {HttpException} from '@nestjs/common';
export type Context={userId:string;workspaceId:string;memberId:string;baseLevel:string;permissions:Set<string>};
export const permissionCodes=['crm.view','crm.view_all','crm.create','crm.edit','crm.delete','crm.export','opportunity.value','assignment.manage','integration.manage','audit.view','workspace.manage','config.manage'];
export function permissionsFor(level:string,granted:string[]):Set<string>{return new Set(level==='Owner'?permissionCodes:level==='Admin'?permissionCodes.filter(p=>p!=='workspace.manage'):granted);}
export function requirePermission(ctx:Context,permission:string){if(!ctx.permissions.has(permission))throw new HttpException('You do not have permission to perform this action.',403);}
export function requireRecord(ctx:Context,ownerId:string){if(ownerId!==ctx.memberId&&!ctx.permissions.has('crm.view_all'))throw new HttpException('Record not found.',404);}
export function redactOpportunity(ctx:Context,record:Record<string,unknown>){const copy={...record};if(!ctx.permissions.has('opportunity.value')){delete copy.value_minor;delete copy.currency;}return copy;}
