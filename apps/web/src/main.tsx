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
import './home/forum-tokens.css'
import './audience/layout.css'
import './auth/sber-tokens.css'
import './auth/sber-fonts.css'
import './auth/auth.css'
import {App} from './App'

createRoot(document.getElementById('root')!, {identifierPrefix:'forum-web-'}).render(
  <ThemeProvider colorMode="light" dayScheme="light"><BaseStyles><App /></BaseStyles></ThemeProvider>,
)
