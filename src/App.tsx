import './index.css'
import { AuthProvider } from './auth'
import { useAuth } from './auth-context'
import { PrefsProvider } from './prefs'
import { ToastProvider } from './components/feedback'
import { BootScreen } from './components/ui'
import { AuthScreen } from './pages/AuthScreen'
import { TeacherApp } from './pages/TeacherApp'
import { StudentApp } from './pages/StudentApp'
import { AIAssistantBubble } from './components/patterns'
import { ScreenContextProvider } from './lib/context'

function Root() {
  const { user, loading } = useAuth()

  if (loading) return <BootScreen line="Opening the hall" />

  return (
    <>
      {!user ? <AuthScreen /> : user.role === 'teacher' ? <TeacherApp /> : <StudentApp />}
      {user && <AIAssistantBubble />}
    </>
  )
}

function App() {
  return (
    <PrefsProvider>
      <ToastProvider>
        <AuthProvider>
          <ScreenContextProvider>
            <Root />
          </ScreenContextProvider>
        </AuthProvider>
      </ToastProvider>
    </PrefsProvider>
  )
}

export default App