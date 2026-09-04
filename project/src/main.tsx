import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router'
import './index.css'
import { bootstrapBundledProject } from './game/bundledProject'

async function start() {
  await bootstrapBundledProject()
  const { default: App } = await import('./App.tsx')
  createRoot(document.getElementById('root')!).render(
    <HashRouter>
      <App />
    </HashRouter>,
  )
}

void start()
