import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import AccessoGestionale from './AccessoGestionale.jsx'
import './index.css'

// Il gestionale (/gestionale) si apre solo dopo l'accesso; la radio degli ascoltatori no.
// Stessa regola dell'indirizzo usata in App.jsx (isGestionale).
const isGestionale = window.location.pathname.replace(/\/+$/, "") === "/gestionale";

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isGestionale ? <AccessoGestionale><App /></AccessoGestionale> : <App />}
  </React.StrictMode>,
)
