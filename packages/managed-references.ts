export const managedReferenceDefinitions={
 'regions':{title:'Субъекты РФ',description:false,symbol:false,numeric:true},
 'offer-types':{title:'Типы предложения',description:true,symbol:false,numeric:false},
 'business-segments':{title:'Бизнес-сегменты',description:true,symbol:false,numeric:false},
 'commercial-roles':{title:'Коммерческие роли',description:true,symbol:false,numeric:false},
 'units':{title:'Единицы измерения',description:true,symbol:true,numeric:false},
 'rejection-reasons':{title:'Причины отклонения',description:true,symbol:false,numeric:false},
 'company-statuses':{title:'Статусы организаций',description:false,symbol:false,numeric:false},
} as const
export type ManagedReferenceKind=keyof typeof managedReferenceDefinitions
export function managedReferencePath(path:string):ManagedReferenceKind|undefined{
 const match=/^\/cabinet\/references\/([a-z-]+)\/?$/.exec(path)
 return match&&Object.hasOwn(managedReferenceDefinitions,match[1])?match[1] as ManagedReferenceKind:undefined
}
