import {usePublicSession} from '../SessionProvider'
export function useForumSession(): boolean {
  return !!usePublicSession(import.meta.env.VITE_FORUM_SESSION === 'true').session
}
