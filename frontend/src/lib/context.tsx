import { createContext, useContext, useState, type ReactNode } from 'react'

export interface ScreenContextValue {
  title?: string
  description?: string
  data?: any
  suggestions?: string[]
}

interface ScreenContextType {
  context: ScreenContextValue | null
  setContext: (ctx: ScreenContextValue | null) => void
}

const ScreenContext = createContext<ScreenContextType | undefined>(undefined)

export function ScreenContextProvider({ children }: { children: ReactNode }) {
  const [context, setContext] = useState<ScreenContextValue | null>(null)
  return (
    <ScreenContext.Provider value={{ context, setContext }}>
      {children}
    </ScreenContext.Provider>
  )
}

export function useScreenContext() {
  const ctx = useContext(ScreenContext)
  if (!ctx) throw new Error('useScreenContext must be used within a ScreenContextProvider')
  return ctx
}
