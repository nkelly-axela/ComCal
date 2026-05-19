import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

// React.StrictMode deliberately double-mounts components in development,
// which causes Supabase's auth lock to time out (both mounts race for the
// same localStorage lock). Removed here — if you need StrictMode for other
// reasons, proxy auth calls through a singleton instead.
ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
