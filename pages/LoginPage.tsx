import React, { useState } from 'react';
import { useAuth } from '../services/authContext';
import { Wrench } from 'lucide-react';

export default function LoginPage() {
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!auth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F7FA] text-slate-600">
        <p>Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.</p>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error: err } = await auth.signIn(email, password);
    setSubmitting(false);
    if (err) setError(err.message);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F5F7FA] p-4">
      <div className="w-full max-w-sm bg-white rounded-xl border border-slate-200 shadow-lg p-8">
        <div className="flex items-center gap-3 mb-8">
          <div className="bg-slate-900 p-2 rounded text-white">
            <Wrench size={24} />
          </div>
          <h1 className="text-xl font-black tracking-tight text-slate-900 uppercase">
            CK-Flow <span className="text-blue-600">2.0</span>
          </h1>
        </div>
        <p className="text-slate-500 text-sm mb-6">Sign in with your email</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg border border-slate-200 bg-slate-50 focus:border-blue-600 focus:ring-0 focus:bg-white text-slate-900 text-sm"
              required
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg border border-slate-200 bg-slate-50 focus:border-blue-600 focus:ring-0 focus:bg-white text-slate-900 text-sm"
              required
            />
          </div>
          {error && (
            <p className="text-red-600 text-sm" role="alert">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 rounded-lg bg-slate-900 text-white font-black text-xs uppercase tracking-widest hover:bg-slate-800 disabled:opacity-50 transition-all"
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
