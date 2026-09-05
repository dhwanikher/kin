import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { api } from '../api/client.js';

export default function Circles() {
  const navigate = useNavigate();
  const [circles, setCircles] = useState(null);
  const [error, setError] = useState(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const { circles } = await api.get('/api/circles');
      setCircles(circles);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function create(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { circle } = await api.post('/api/circles', {
        name: name.trim(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      navigate(`/c/${circle.id ?? circle._id}/today`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>Care circles</h1>
      {error && <p className="alert" role="alert">{error}</p>}

      {circles === null ? (
        <p className="empty" role="status">Loading…</p>
      ) : circles.length === 0 ? (
        <p className="dose-meta">
          You are not in a circle yet. Create one for the person you are looking after.
        </p>
      ) : (
        <ul className="list-plain" style={{ marginBottom: '2rem' }}>
          {circles.map((circle) => (
            <li key={circle.id ?? circle._id} className="card">
              <div className="row" style={{ borderBottom: 0, padding: 0 }}>
                <div className="grow">
                  <div className="dose-name">{circle.name}</div>
                  <div className="dose-meta">
                    {circle.timezone} · you are {circle.role === 'admin' ? 'an admin' : `a ${circle.role}`}
                  </div>
                </div>
                <Link className="btn btn-primary btn-small" to={`/c/${circle.id ?? circle._id}/today`}>
                  Open
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form className="card" onSubmit={create}>
        <h2 style={{ marginTop: 0 }}>Start a new circle</h2>
        <div className="field">
          <label htmlFor="circle-name">Who are you looking after?</label>
          <input
            id="circle-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Dad"
            required
          />
          <span className="hint">
            Times are read in {Intl.DateTimeFormat().resolvedOptions().timeZone}, so a dose at 08:00
            means eight in the morning where they live.
          </span>
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Creating…' : 'Create circle'}
        </button>
      </form>
    </>
  );
}
