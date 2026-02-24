import React from 'react';
import ReactDOM from 'react-dom/client';
import { AuthProvider, useAuth } from './services/authContext';
import App from './App';
import LoginPage from './pages/LoginPage';

function AuthGate() {
  const auth = useAuth();
  if (!auth) return <App />;
  if (!auth.supabaseConfigured) return <App />;
  if (auth.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F7FA]">
        <p className="text-slate-500 text-sm">Loading…</p>
      </div>
    );
  }
  if (!auth.session) return <LoginPage />;
  return <App />;
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  </React.StrictMode>
);
