import {beforeEach, describe, expect, it} from 'vitest'
import {preserveCustomerIntent, rememberCustomerAuth, restoreCustomerAuthReturn} from './customer-intent'

beforeEach(() => sessionStorage.clear())

describe('customer authentication return', () => {
  it('returns a cancelled customer sign-in to the same audience page', () => {
    rememberCustomerAuth()
    expect(restoreCustomerAuthReturn('?auth_error=access_denied')).toBe('/customers/?auth_error=access_denied')
    expect(restoreCustomerAuthReturn('?auth_error=access_denied')).toBeUndefined()
    expect(JSON.parse(sessionStorage.getItem('forum.customer-intent')!)).toEqual({audience: 'customer', action: 'create-order', returnTo: '/customers/'})
  })
  it('does not hijack general sign-in after viewing the customer page', () => {
    preserveCustomerIntent()
    expect(restoreCustomerAuthReturn('?auth=success')).toBeUndefined()
  })
  it('restores customer sign-in without forwarding arbitrary callback parameters', () => {
    rememberCustomerAuth()
    expect(restoreCustomerAuthReturn('?auth=success&code=secret&returnTo=https://example.com')).toBe('/customers/?auth=success')
  })
})
