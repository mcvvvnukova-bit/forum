import React from 'react'
import {createRoot} from 'react-dom/client'
import {BaseStyles, ThemeProvider} from '@primer/react'
import '@primer/primitives/dist/css/functional/themes/light.css'
import './auth-screen.css'
import {AuthScreen} from './AuthScreen'

createRoot(document.getElementById('root')!).render(
  <ThemeProvider colorMode="light" dayScheme="light">
    <BaseStyles>
      <AuthScreen />
    </BaseStyles>
  </ThemeProvider>,
)
