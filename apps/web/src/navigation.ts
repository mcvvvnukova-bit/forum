import {useEffect, useState} from 'react'
import {publicNavigationEvent, publicPageUrl} from '../../../packages/public-navigation'

export function usePublicPageUrl() {
  const [url, setUrl] = useState(publicPageUrl)
  useEffect(() => {
    const update = () => setUrl(publicPageUrl())
    window.addEventListener('popstate', update)
    window.addEventListener('hashchange', update)
    window.addEventListener(publicNavigationEvent, update)
    return () => {
      window.removeEventListener('popstate', update)
      window.removeEventListener('hashchange', update)
      window.removeEventListener(publicNavigationEvent, update)
    }
  }, [])
  return url
}
