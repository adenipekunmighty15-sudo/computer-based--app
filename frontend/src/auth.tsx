import { useEffect, useState, type ReactNode } from 'react'
import { api, isBackendDown, type User } from './api'
import { AuthContext } from './auth-context'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  // Whether the session probe could reach the server at all. The login form says
  // so plainly, because "Failed to fetch" from an unreachable API looks exactly
  // like a wrong password to anyone who has not read the network tab.
  const [backendDown, setBackendDown] = useState(false)

  useEffect(() => {
    let cancelled = false
    const probe = async () => {
      try {
        const r = await api.me()
        if (!cancelled) {
          setUserState(r.user)
          setBackendDown(false)
        }
      } catch (err) {
        if (cancelled) return
        setUserState(null)
        // Only a connection failure means the server is gone. A 401 is the
        // normal answer for "nobody is signed in".
        setBackendDown(isBackendDown(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void probe()
    return () => {
      cancelled = true
    }
  }, [])

  const login = async (username: string, password: string, role: 'teacher' | 'student') => {
    const r = await api.login(username, password, role)
    setUserState(r.user)
    return r.user
  }

  const register = async (payload: Record<string, unknown>) => {
    const r = await api.register({
      ...payload,
      name: String(payload.name || '').trim(),
      username: String(payload.username || '').trim(),
      studentId: String(payload.studentId || '').trim(),
      cls: String(payload.cls || '').trim(),
    })
    setUserState(r.user)
    return r.user
  }

  const logout = async () => {
    try {
      await api.logout()
    } catch {
      /* token may already be invalid */
    }
    setUserState(null)
  }

  const setUser = (next: User) => setUserState(next)

  return (
    <AuthContext.Provider value={{ user, loading, backendDown, login, register, logout, setUser }}>
      {children}
    </AuthContext.Provider>
  )
}