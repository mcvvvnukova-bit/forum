/** Optional keys returned by Sber userinfo. No banking data or organizational permissions. */
type NumberDocument = {number?: string}
type IdentityDocument = {type?: number; series?: string; number?: string; issued_by?: string; issued_date?: string; code?: string}
type InternationalPassport = IdentityDocument & {planned_end_date?: string; name?: string; surname?: string}
type Description = {code?: string; description?: string}
type Address = {full_address?: string; fias_code?: string; post_index?: string; country?: string; region?: string; district?: string; city?: string; settlement?: string; street?: string; house?: string; building?: string; bulk?: string; apartment?: string}
export type SberProfile = {
  sub?: string; email?: string; phone_number?: string; family_name?: string; given_name?: string; middle_name?: string;
  birthdate?: string; gender?: number; identification?: IdentityDocument; priority_doc?: IdentityDocument;
  inn?: NumberDocument; snils?: NumberDocument; citizenship?: {country_code?: string; country_name?: string}; place_of_birth?: string;
  address_reg?: Address; address_of_actual_residence?: Address; work_address?: Address; delivery_address?: Address;
  driving_license?: NumberDocument; international_passport?: InternationalPassport; sts?: NumberDocument;
  previous_identification?: IdentityDocument; previous_family_name?: string; previous_given_name?: string; previous_middle_name?: string;
  education?: Description; place_of_work?: string; job_title?: string; marital_status?: Description; is_self_employed?: boolean;
}
export type ProfileField = {id: string; label: string; value: string; status: 'provided' | 'missing' | 'not-requested'}
export type ProfileSection = {id: string; title: string; fields: ProfileField[]}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
function name(...parts: unknown[]) {return parts.map(text).filter(Boolean).join(' ') || undefined}
function date(value: unknown): string | undefined {
  const raw = text(value)
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw) || raw.startsWith('0000')) return undefined
  const parsed = new Date(`${raw}T12:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) return undefined
  return new Intl.DateTimeFormat('ru-RU', {day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'}).format(parsed).replace(' г.', '')
}
function address(value?: Address): string | undefined {
  if (!value) return undefined
  if (text(value.full_address)) return text(value.full_address)
  const part = (prefix: string, val: unknown) => text(val) ? `${prefix}${text(val)}` : undefined
  return [value.post_index, value.country, value.region, value.district, value.city, value.settlement, value.street,
    part('д. ', value.house), part('стр. ', value.building), part('корп. ', value.bulk), part('кв. ', value.apartment)]
    .map(text).filter(Boolean).join(', ') || undefined
}
const documentTitles: Record<number, string> = {
  17: 'Паспорт', 18: 'Заграничный паспорт', 7: 'Военный билет', 21: 'Удостоверение личности моряка',
  14: 'Временное удостоверение личности', 10: 'Паспорт иностранного гражданина', 75: 'Вид на жительство',
}
export function buildProfileSections(p: SberProfile, approvedScopes: readonly string[]): ProfileSection[] {
  const scopes = new Set(approvedScopes)
  const f = (id: string, label: string, scope: string, value: unknown): ProfileField => {
    if (!scopes.has(scope)) return {id, label, value: 'Не запрошено', status: 'not-requested'}
    return text(value) ? {id, label, value: text(value)!, status: 'provided'} : {id, label, value: 'Не передано', status: 'missing'}
  }
  // Never use maindoc or even its type unless that scope is approved.
  const hasMain = scopes.has('maindoc') && p.identification && Object.values(p.identification).some(v => text(v))
  const primary = hasMain ? p.identification : scopes.has('priority_doc') ? p.priority_doc : undefined
  const primaryScope = hasMain || !scopes.has('priority_doc') ? 'maindoc' : 'priority_doc'
  const identityTitle = hasMain ? 'Паспорт' : primary ? documentTitles[primary.type ?? -1] ?? 'Документ, удостоверяющий личность' : 'Паспорт'
  const section = (id: string, title: string, fields: ProfileField[]): ProfileSection => ({id, title, fields})
  return [
    section('personal', 'Личные данные', [
      f('full_name', 'Фамилия, имя, отчество', 'name', name(p.family_name, p.given_name, p.middle_name)),
      f('birthdate', 'Дата рождения', 'birthdate', date(p.birthdate)),
      f('gender', 'Пол', 'gender', p.gender === 1 ? 'Мужской' : p.gender === 2 ? 'Женский' : undefined),
      f('place_of_birth', 'Место рождения', 'place_of_birth', p.place_of_birth),
      f('citizenship', 'Гражданство', 'citizenship', p.citizenship?.country_name),
      f('previous_name', 'Предыдущие ФИО', 'previous_name', name(p.previous_family_name, p.previous_given_name, p.previous_middle_name)),
      f('marital_status', 'Семейное положение', 'marital_status', p.marital_status?.description),
    ]),
    section('identity', identityTitle, [
      f('document_number', 'Серия и номер', primaryScope, name(primary?.series, primary?.number)),
      f('issued_by', 'Кем выдан', primaryScope, primary?.issued_by),
      f('issued_date', 'Дата выдачи', primaryScope, date(primary?.issued_date)),
      f('document_code', 'Код подразделения', primaryScope, primary?.code),
    ]),
    section('addresses', 'Адреса', [
      f('address_reg', 'Адрес регистрации', 'address_reg', address(p.address_reg)),
      f('address_of_actual_residence', 'Адрес проживания', 'address_of_actual_residence', address(p.address_of_actual_residence)),
    ]),
    section('tax', 'ИНН', [f('inn', 'ИНН физического лица', 'inn', p.inn?.number)]),
    section('contacts', 'Контакты', [f('phone', 'Номер телефона', 'mobile', p.phone_number), f('email', 'Электронная почта', 'email', p.email)]),
    section('pension', 'СНИЛС', [f('snils', 'Страховой номер', 'snils', p.snils?.number)]),
    section('work', 'Работа и образование', [
      f('place_of_work', 'Место работы', 'place_of_work', p.place_of_work),
      f('job_title', 'Должность', 'job_title', p.job_title),
      f('education', 'Образование', 'education', p.education?.description),
      f('is_self_employed', 'Самозанятость', 'is_self_employed', typeof p.is_self_employed === 'boolean' ? p.is_self_employed ? 'Да' : 'Нет' : undefined),
    ]),
    section('extra-documents', 'Дополнительные документы', [
      f('driving_license', 'Водительское удостоверение', 'driving_license', p.driving_license?.number),
      f('international_passport', 'Заграничный паспорт', 'international_passport', name(p.international_passport?.series, p.international_passport?.number)),
      f('international_issued_by', 'Загранпаспорт: кем выдан', 'international_passport', p.international_passport?.issued_by),
      f('international_issued_date', 'Загранпаспорт: дата выдачи', 'international_passport', date(p.international_passport?.issued_date)),
      f('international_end', 'Загранпаспорт: действует до', 'international_passport', date(p.international_passport?.planned_end_date)),
      f('international_name', 'Имя в загранпаспорте', 'international_passport', name(p.international_passport?.surname, p.international_passport?.name)),
      f('sts', 'Свидетельство о регистрации ТС', 'sts', p.sts?.number),
      f('previous_identification', 'Предыдущий паспорт', 'previous_identification', name(p.previous_identification?.series, p.previous_identification?.number)),
      f('previous_issued_by', 'Предыдущий паспорт: кем выдан', 'previous_identification', p.previous_identification?.issued_by),
      f('previous_issued_date', 'Предыдущий паспорт: дата выдачи', 'previous_identification', date(p.previous_identification?.issued_date)),
    ]),
    section('extra-addresses', 'Другие адреса', [f('work_address', 'Рабочий адрес', 'work_address', address(p.work_address)), f('delivery_address', 'Адрес доставки', 'delivery_address', address(p.delivery_address))]),
  ]
}
