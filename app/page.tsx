'use client';

import { AuthProvider, useAuth } from '../services/authContext';
import App from '../App';
import LoginPage from '../pages/LoginPage';

function AuthGate() {
  const auth = useAuth();

  if (!auth || !auth.supabaseConfigured) return <App />;

  if (auth.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F7FA]">
        <p className="text-slate-500 text-sm">Loading...</p>
      </div>
    );
  }

  if (!auth.session || auth.signingOut) return <LoginPage />;

  return <App />;
}

export default function HomePage() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  );
}
