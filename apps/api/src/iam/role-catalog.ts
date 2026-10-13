import {AuthError} from './auth-error.js';

export type RoleCode='individual'|'organization_employee'|'organization_admin'|'organization_signer'|'platform_moderator'|'platform_admin';
const employee=['organization.business.read','organization.business.draft'];
const moderator=['platform.moderation.review','platform.restrictions.manage','platform.audit.read'];
export const roleCatalogue:readonly {code:RoleCode;scope:'person'|'organization'|'platform';permissions:readonly string[];conditionalPermissions?:readonly string[]}[]=[
 {code:'individual',scope:'person',permissions:['personal.profile.read','personal.profile.update','personal.business.use','organization.add']},
 {code:'organization_employee',scope:'organization',permissions:employee},
 {code:'organization_admin',scope:'organization',permissions:[...employee,'organization.business.publish','organization.profile.update',
  'organization.verification.manage','organization.members.manage','organization.audit.read']},
 {code:'organization_signer',scope:'organization',permissions:employee,conditionalPermissions:['organization.documents.sign']},
 {code:'platform_moderator',scope:'platform',permissions:moderator},
 {code:'platform_admin',scope:'platform',permissions:[...moderator,'platform.roles.manage']},
];
export const permissionCatalogue:ReadonlySet<string>=new Set(roleCatalogue.flatMap(r=>[...r.permissions,...(r.conditionalPermissions??[])]));
export type AuthorizationContext={contextKey:string;participantId:string|null;roles:RoleCode[];permissions:string[];accessVersion:number};
export function permissionsFor(roles:readonly RoleCode[]):string[]{
 return [...new Set(roleCatalogue.filter(r=>roles.includes(r.code)).flatMap(r=>[...r.permissions]))];
}
export function requireAll(granted:readonly string[],required:readonly string[]):void{
 if(required.some(permission=>!permissionCatalogue.has(permission)||!granted.includes(permission)))throw new AuthError('forbidden',403);
}
