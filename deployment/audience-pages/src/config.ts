// External destinations can be supplied without altering the homepage's layout.
// Local transition previews are used until the actual destination URLs are verified.
const env = import.meta.env

export const destinations = {
  customers: env.VITE_CUSTOMERS_URL || '/customers/',
  suppliers: env.VITE_SUPPLIERS_URL || '/suppliers/',
  work: env.VITE_WORK_URL || '/work/',
  login: env.VITE_LOGIN_URL || '/participate/',
  cabinet: env.VITE_CABINET_URL || '/participate/',
  privacy: env.VITE_PRIVACY_URL || '/privacy/',
  cookies: env.VITE_COOKIES_URL || '/cookies/',
}
