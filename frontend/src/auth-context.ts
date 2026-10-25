import { createContext, useContext } from 'react'
import type { User } from './api'

export interface AuthCtx {
  user: User | null
  loading: boolean
  /** The session probe never reached the server, so nothing can be submitted. */
  backendDown: boolean
  login: (username: string, password: string, role: 'teacher' | 'student') => Promise<User>
  register: (payload: Record<string, unknown>) => Promise<User>
  logout: () => Promise<void>
  /** Applies an edited profile to the session, so the rail updates at once. */
  setUser: (user: User) => void
}

export const AuthContext = createContext<AuthCtx | null>(null)

export function useAuth(): AuthCtx {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}