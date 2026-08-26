import React from 'react'
import { createRoot } from 'react-dom/client'
import { StudioApp } from './StudioApp'
import './styles.css'

const el = document.getElementById('root')
if (el) {
  createRoot(el).render(
    <React.StrictMode>
      <StudioApp />
    </React.StrictMode>
  )
}
