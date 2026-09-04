import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import { bootstrapBundledProject } from './game/bundledProject'

// Vite 在本地使用根路径、在 GitHub Pages 使用仓库子路径；从实际页面地址解析
// 相对 base，确保 BrowserRouter 能匹配两种部署位置。
const routerBase = new URL(import.meta.env.BASE_URL, window.location.href).pathname.replace(/\/$/, '') || '/'

async function start() {
  await bootstrapBundledProject()
  const { default: App } = await import('./App.tsx')
  createRoot(document.getElementById('root')!).render(
    <BrowserRouter basename={routerBase}>
      <App />
    </BrowserRouter>,
  )
}

void start()
