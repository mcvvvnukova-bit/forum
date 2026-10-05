import {describe, it, expect} from 'vitest'
import {buildProfileSections} from './profile'

const scopes = ['name', 'birthdate', 'inn', 'maindoc', 'priority_doc', 'is_self_employed', 'address_reg']
function field(profile: Parameters<typeof buildProfileSections>[0], id: string, approved = scopes) {
  return buildProfileSections(profile, approved).flatMap(s => s.fields).find(f => f.id === id)
}

describe('Sber data at the profile boundary', () => {
  it('keeps absent values distinct from unapproved scopes', () => {
    expect(field({}, 'inn')).toMatchObject({value: 'Не передано', status: 'missing'})
    expect(field({inn: {number: '770123456789'}}, 'inn', [])).toMatchObject({value: 'Не запрошено', status: 'not-requested'})
    expect(JSON.stringify(buildProfileSections({inn: {number: '770123456789'}, given_name: 'Секрет'}, []))).not.toMatch(/770123456789|Секрет/)
  })
  it('does not lose a false self-employment flag', () => {
    expect(field({is_self_employed: false}, 'is_self_employed')?.value).toBe('Нет')
  })
  it('uses the priority document without claiming it is a Russian passport', () => {
    const sections = buildProfileSections({priority_doc: {type: 10, series: 'AB', number: '123456'}}, scopes)
    expect(sections.find(s => s.id === 'identity')?.title).toBe('Паспорт иностранного гражданина')
    expect(sections.flatMap(s => s.fields).find(f => f.id === 'document_number')?.value).toBe('AB 123456')
  })
  it('keeps a priority document with a missing or zero type neutral', () => {
    for (const doc of [{number: '12345'}, {type: 0, number: '12345'}]) {
      expect(buildProfileSections({priority_doc: doc}, scopes).find(s => s.id === 'identity')?.title).toBe('Документ, удостоверяющий личность')
    }
  })
  it('does not reuse an unapproved main document', () => {
    expect(field({identification: {series: '45 12', number: '987654'}}, 'document_number', ['priority_doc'])?.value).toBe('Не передано')
  })
  it('formats ISO dates in Russian without normalizing impossible dates', () => {
    expect(field({birthdate: '1988-03-14'}, 'birthdate')?.value).toBe('14 марта 1988')
    expect(field({birthdate: '2020-02-30'}, 'birthdate')?.value).toBe('Не передано')
  })
  it('constructs a supplied address without inventing missing parts', () => {
    expect(field({address_reg: {post_index: '125009', city: 'Москва', street: 'Тверская', house: '12'}}, 'address_reg')?.value).toBe('125009, Москва, Тверская, д. 12')
  })
})
