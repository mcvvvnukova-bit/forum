import React from 'react'
import {createRoot} from 'react-dom/client'
import {BaseStyles, ThemeProvider} from '@primer/react'
import '@primer/primitives/dist/css/base/size/size.css'
import '@primer/primitives/dist/css/functional/size/border.css'
import '@primer/primitives/dist/css/functional/size/radius.css'
import '@primer/primitives/dist/css/functional/spacing/space.css'
import '@primer/primitives/dist/css/functional/typography/typography.css'
import '@primer/primitives/dist/css/functional/themes/light.css'
import '../forum-tokens.css'
import './landing-screen.css'
import {LandingApp} from './LandingApp'

createRoot(document.getElementById('root')!).render(
  <ThemeProvider colorMode="light" dayScheme="light">
    <BaseStyles>
      <LandingApp />
    </BaseStyles>
  </ThemeProvider>,
)
