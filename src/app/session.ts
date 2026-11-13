import type { Session } from '@supabase/supabase-js'
import { createContext, useContext } from 'react'
import type { MyContext } from '@/lib/types'

export interface SessionValue {
  /** undefined while the stored session is being read. */
  session: Session | null | undefined
  /** Profile + shops of the signed-in user; null if the account is locked or missing. */
  context: MyContext | null | undefined
  contextError: unknown
  refreshContext: () => Promise<unknown>
  signOut: () => Promise<void>
}

export const SessionContext = createContext<SessionValue | null>(null)

export function useSession(): SessionValue {
  const value = useContext(SessionContext)
  if (!value) throw new Error('useSession must be used inside SessionProvider')
  return value
}

/** Profile + shops of the signed-in user. Only use below RequireAuth. */
export function useMe(): MyContext {
  const { context } = useSession()
  if (!context) throw new Error('useMe must be used below RequireAuth')
  return context
}
