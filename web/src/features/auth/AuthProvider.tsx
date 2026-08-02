import type { Session, User } from '@supabase/supabase-js'
import { useQueryClient } from '@tanstack/react-query'
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import { clearTenantQueryCaches } from '@/lib/clearTenantQueryCaches'
import { supabaseBrowserClient } from '@/lib/supabase/browser-client'

type AuthContextValue = {
  session: Session | null
  user: User | null
  loading: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!supabaseBrowserClient) {
      setSession(null)
      setLoading(false)
      return
    }

    let mounted = true

    supabaseBrowserClient.auth
      .getSession()
      .then(({ data }) => {
        if (!mounted) return
        setSession(data.session ?? null)
      })
      .finally(() => {
        if (!mounted) return
        setLoading(false)
      })

    const { data } = supabaseBrowserClient.auth.onAuthStateChange(async (event, nextSession) => {
      setSession(nextSession)
      if (event === 'SIGNED_OUT') {
        await clearTenantQueryCaches(queryClient)
      }
    })

    return () => {
      mounted = false
      data.subscription.unsubscribe()
    }
  }, [queryClient])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      signOut: async () => {
        if (!supabaseBrowserClient) return
        await supabaseBrowserClient.auth.signOut()
        await clearTenantQueryCaches(queryClient)
      },
    }),
    [session, loading, queryClient],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return ctx
}
