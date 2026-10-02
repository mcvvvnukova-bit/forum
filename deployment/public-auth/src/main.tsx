import {StrictMode} from 'react'
import {createRoot} from 'react-dom/client'
import {BaseStyles, ThemeProvider} from '@primer/react'
import '@primer/primitives/dist/css/base/size/size.css'
import '@primer/primitives/dist/css/base/typography/typography.css'
import '@primer/primitives/dist/css/base/motion/motion.css'
import '@primer/primitives/dist/css/functional/size/border.css'
import '@primer/primitives/dist/css/functional/size/radius.css'
import '@primer/primitives/dist/css/functional/spacing/space.css'
import '@primer/primitives/dist/css/functional/typography/typography.css'
import '@primer/primitives/dist/css/functional/motion/motion.css'
import '@primer/primitives/dist/css/functional/themes/light.css'
import './sber-tokens.css'
import './auth.css'
import {PublicAuth} from './PublicAuth'
let root = document.getElementById('public-auth-root')
if (!root) {root=document.createElement('div'); root.id='public-auth-root'; document.body.append(root)}
createRoot(root).render(<ThemeProvider colorMode="light" dayScheme="light"><BaseStyles><StrictMode><PublicAuth /></StrictMode></BaseStyles></ThemeProvider>)
