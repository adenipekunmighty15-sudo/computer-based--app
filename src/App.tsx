import './index.css'
import { AuthProvider } from './auth'
import { useAuth } from './auth-context'
import { PrefsProvider } from './prefs'
import { ToastProvider } from './components/feedback'
import { BootScreen } from './components/ui'
import { AuthScreen } from './pages/AuthScreen'
import { LandingPage } from './pages/LandingPage'
import { TeacherApp } from './pages/TeacherApp'
import { StudentApp } from './pages/StudentApp'
import { AIAssistantBubble } from './components/patterns'
import { navigate } from './lib/router'
import { ScreenContextProvider } from './lib/context'

function Root() {
  const { user, loading } = useAuth()

  if (loading) return <BootScreen line="Opening the hall" />

  // Already signed in — go to the right portal.
  if (user) {
    if (window.location.pathname === '/' || window.location.pathname === '/login') {
      navigate(user.role === 'teacher' ? '/' : '/exams', { replace: true })
    }
    return user.role === 'teacher' ? <TeacherApp /> : <StudentApp />
  }

  // Not signed in: show the landing page at "/", the auth form at "/login".
  if (window.location.pathname === '/login') {
    return <AuthScreen />
  }
  return <LandingPage />
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
