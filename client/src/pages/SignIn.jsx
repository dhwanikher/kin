import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../hooks/useAuth.jsx';

export default function SignIn() {
  const { signIn, register } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode] = useState('signin');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const creating = mode === 'register';
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (creating) await register(form.name, form.email, form.password);
      else await signIn(form.email, form.password);
      navigate('/circles', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card centre-card">
      <h1>{creating ? 'Create an account' : 'Sign in'}</h1>
      <p className="dose-meta">
        Kin keeps one shared medication schedule for a family looking after someone.
      </p>

      {/* role="alert" so a failure is announced, not just coloured red. */}
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}

      <form onSubmit={submit} noValidate>
        {creating && (
          <div className="field">
            <label htmlFor="name">Your name</label>
            <input id="name" value={form.name} onChange={set('name')} autoComplete="name" required />
          </div>
        )}

        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={form.email}
            onChange={set('email')}
            autoComplete="email"
            required
          />
        </div>

        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={form.password}
            onChange={set('password')}
            autoComplete={creating ? 'new-password' : 'current-password'}
            required
          />
          {creating && <span className="hint">At least 8 characters.</span>}
        </div>

        <button type="submit" className="btn btn-primary" disabled={busy} style={{ width: '100%' }}>
          {busy ? 'Just a moment…' : creating ? 'Create account' : 'Sign in'}
        </button>
      </form>

      <p style={{ marginBottom: 0 }}>
        <button
          type="button"
          className="btn btn-ghost btn-small"
          onClick={() => {
            setMode(creating ? 'signin' : 'register');
            setError(null);
          }}
        >
          {creating ? 'I already have an account' : 'I need an account'}
        </button>
      </p>
    </div>
  );
}
