import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource-variable/archivo/wdth.css'
import '@fontsource-variable/jetbrains-mono'
// Optional reading faces, loaded eagerly because they are two files and only
// matter to the person who picks them in settings.
import '@fontsource/source-serif-4/latin-400.css'
import '@fontsource/source-serif-4/latin-600.css'
import '@fontsource/atkinson-hyperlegible/latin-400.css'
import '@fontsource/atkinson-hyperlegible/latin-700.css'
import 'katex/dist/katex.min.css'

// Design system, in cascade order. tokens first: everything below reads from
// these variables.
import './styles/tokens.css'
import './styles/base.css'
import './styles/canvas.css'
import './styles/primitives.css'
import './styles/shell.css'
import './styles/data.css'
import './styles/exam.css'
import './styles/ailab.css'
import './styles/onboarding.css'
import './styles/motion.css'
import './styles/auth.css'

import App from './App'
import { ErrorBoundary } from './components/feedback'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
