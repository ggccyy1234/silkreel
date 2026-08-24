import React from 'react'
import { createRoot } from 'react-dom/client'

const App: React.FC = () => {
  return React.createElement('main', null, 'silk-reel studio lands in m3')
}

const el = document.getElementById('root')
if (el) createRoot(el).render(React.createElement(App))
