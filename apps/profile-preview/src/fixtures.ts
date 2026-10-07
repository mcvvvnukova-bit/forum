import type {SberProfile} from './profile'
export const approvedScopes = ['openid', 'name', 'birthdate', 'gender', 'email', 'mobile', 'maindoc', 'priority_doc', 'inn', 'snils', 'place_of_birth', 'citizenship', 'address_reg', 'address_of_actual_residence', 'work_address', 'delivery_address', 'is_self_employed', 'place_of_work', 'job_title', 'education', 'driving_license', 'international_passport', 'sts', 'previous_identification', 'previous_name', 'marital_status'] as const
/** Fictional design fixture. Never replace with real userinfo or authentication tokens. */
export const demoProfile: SberProfile = {
  family_name: 'Смирнов', given_name: 'Алексей', middle_name: 'Сергеевич', birthdate: '1988-03-14', gender: 1,
  place_of_birth: 'г. Москва', citizenship: {country_name: 'Российская Федерация', country_code: 'RUS'},
  email: 'alexey.smirnov@example.test', phone_number: '+7 900 000-00-00',
  identification: {series: '45 12', number: '345678', issued_by: 'ГУ МВД России по г. Москве', issued_date: '2008-06-22', code: '770-001'},
  inn: {number: '770123456789'}, snils: {number: '123-456-789 01'},
  address_reg: {full_address: '125009, г. Москва, ул. Тверская, д. 12, кв. 34'},
  address_of_actual_residence: {full_address: '125009, г. Москва, ул. Тверская, д. 12, кв. 34'},
  work_address: {full_address: 'г. Москва, ул. Садовая, д. 8'},
  delivery_address: {full_address: '125009, г. Москва, ул. Тверская, д. 12, кв. 34'},
  place_of_work: 'ООО «Пример»', job_title: 'Специалист по закупкам', education: {code: '4', description: 'Высшее'},
  is_self_employed: false,
}
export const partialProfile: SberProfile = {family_name: 'Смирнов', given_name: 'Алексей', email: 'alexey.smirnov@example.test'}
