import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import { api } from '../api/client.js';
import { useAnnounce } from '../hooks/useAnnounce.jsx';

const ROLE_HELP = {
  admin: 'Can do everything, including inviting people',
  caregiver: 'Can record doses and edit medications',
  viewer: 'Can see the schedule but not change it',
};

export default function People() {
  const { circleId } = useParams();
  const announce = useAnnounce();

  const [members, setMembers] = useState(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('caregiver');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { members } = await api.get(`/api/circles/${circleId}/members`);
      setMembers(members);
    } catch (err) {
      setError(err.message);
    }
  }, [circleId]);

  useEffect(() => { load(); }, [load]);

  async function invite(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/circles/${circleId}/members`, { email: email.trim(), role });
      announce(`${email} added to the circle`);
      setEmail('');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(member, nextRole) {
    setError(null);
    try {
      await api.patch(`/api/circles/${circleId}/members/${member.id}`, { role: nextRole });
      announce(`${member.user.name} is now a ${nextRole}`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(member) {
    if (!globalThis.confirm(`Remove ${member.user.name} from this circle?`)) return;
    setError(null);
    try {
      await api.del(`/api/circles/${circleId}/members/${member.id}`);
      announce(`${member.user.name} removed`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      <h1>People</h1>
      {error && <p className="alert" role="alert">{error}</p>}

      {members === null ? (
        <p className="empty" role="status">Loading…</p>
      ) : (
        <ul className="list-plain card" style={{ marginBottom: '2rem' }}>
          {members.map((member) => (
            <li key={member.id} className="row">
              <div className="grow">
                <div className="dose-name">{member.user.name}</div>
                <div className="dose-meta">{member.user.email}</div>
              </div>
              <label className="sr-only" htmlFor={`role-${member.id}`}>
                Role for {member.user.name}
              </label>
              <select
                id={`role-${member.id}`}
                value={member.role}
                onChange={(e) => changeRole(member, e.target.value)}
                style={{ minHeight: 'var(--tap)', padding: '0.4rem 0.6rem', border: '2px solid var(--line)', borderRadius: 10, background: 'var(--surface)', color: 'var(--ink)', font: 'inherit' }}
              >
                {Object.keys(ROLE_HELP).map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
              <button type="button" className="btn btn-small" onClick={() => remove(member)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <form className="card" onSubmit={invite}>
        <h2 style={{ marginTop: 0 }}>Add someone</h2>
        <div className="field">
          <label htmlFor="invite-email">Their email</label>
          <input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <span className="hint">
            They need a Kin account already — there is no invitation email yet.
          </span>
        </div>
        <div className="field">
          <label htmlFor="invite-role">Role</label>
          <select id="invite-role" value={role} onChange={(e) => setRole(e.target.value)}>
            {Object.entries(ROLE_HELP).map(([r, help]) => (
              <option key={r} value={r}>{r} — {help}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Adding…' : 'Add to circle'}
        </button>
      </form>
    </>
  );
}
