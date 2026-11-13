import type { Session } from '@supabase/supabase-js'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { fetchMyContext, signOut as apiSignOut } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import { SessionContext, type SessionValue } from './session'

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => data.subscription.unsubscribe()
  }, [])

  const userId = session?.user.id
  const contextQuery = useQuery({
    queryKey: ['my-context', userId],
    queryFn: fetchMyContext,
    enabled: Boolean(userId),
    staleTime: 60_000,
  })

  const signOut = useCallback(async () => {
    await apiSignOut()
    queryClient.clear()
  }, [queryClient])

  const value = useMemo<SessionValue>(
    () => ({
      session,
      context: userId ? contextQuery.data : null,
      contextError: contextQuery.error,
      refreshContext: () => contextQuery.refetch(),
      signOut,
    }),
    [session, userId, contextQuery, signOut],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}
