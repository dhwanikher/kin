import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import { api } from '../api/client.js';
import { useAnnounce } from '../hooks/useAnnounce.jsx';

const WEEKDAYS = [
  ['Sun', 0], ['Mon', 1], ['Tue', 2], ['Wed', 3], ['Thu', 4], ['Fri', 5], ['Sat', 6],
];

const blank = () => ({
  name: '',
  dose: '',
  instructions: '',
  timesOfDay: ['08:00'],
  daysOfWeek: [],
  startDate: new Date().toISOString().slice(0, 10),
  endDate: '',
});

export default function Medications() {
  const { circleId } = useParams();
  const announce = useAnnounce();

  const [medications, setMedications] = useState(null);
  const [form, setForm] = useState(blank);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { medications } = await api.get(`/api/circles/${circleId}/medications`);
      setMedications(medications);
    } catch (err) {
      setError(err.message);
    }
  }, [circleId]);

  useEffect(() => { load(); }, [load]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  function setTime(index, value) {
    setForm((f) => ({ ...f, timesOfDay: f.timesOfDay.map((t, i) => (i === index ? value : t)) }));
  }
  const addTime = () => setForm((f) => ({ ...f, timesOfDay: [...f.timesOfDay, '20:00'] }));
  const removeTime = (index) =>
    setForm((f) => ({ ...f, timesOfDay: f.timesOfDay.filter((_, i) => i !== index) }));

  function toggleDay(day) {
    setForm((f) => ({
      ...f,
      daysOfWeek: f.daysOfWeek.includes(day)
        ? f.daysOfWeek.filter((d) => d !== day)
        : [...f.daysOfWeek, day].sort(),
    }));
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      await api.post(`/api/circles/${circleId}/medications`, {
        ...form,
        endDate: form.endDate || null,
      });
      announce(`${form.name} added to the schedule`);
      setForm(blank());
      await load();
    } catch (err) {
      setError(err.message);
      // Field-level messages from the server land next to the field that
      // caused them, rather than as one banner the user has to decode.
      setFieldErrors(err.details ?? {});
    } finally {
      setBusy(false);
    }
  }

  async function stop(medication) {
    if (!globalThis.confirm(`Stop ${medication.name}? Doses already recorded are kept.`)) return;
    try {
      await api.del(`/api/circles/${circleId}/medications/${medication._id}`);
      announce(`${medication.name} stopped`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      <h1>Medications</h1>
      {error && <p className="alert" role="alert">{error}</p>}

      {medications === null ? (
        <p className="empty" role="status">Loading…</p>
      ) : medications.length === 0 ? (
        <p className="dose-meta">Nothing on the schedule yet.</p>
      ) : (
        <ul className="list-plain" style={{ marginBottom: '2rem' }}>
          {medications.map((m) => (
            <li key={m._id} className="card">
              <div className="row" style={{ borderBottom: 0, padding: 0 }}>
                <div className="grow">
                  <div className="dose-name">
                    {m.name} {!m.active && <span className="tag">stopped</span>}
                  </div>
                  <div className="dose-meta">
                    {m.dose} · {m.timesOfDay.join(', ')}
                    {m.daysOfWeek?.length ? ` · ${m.daysOfWeek.map((d) => WEEKDAYS[d][0]).join(' ')}` : ' · every day'}
                  </div>
                  {m.instructions && <div className="dose-meta">{m.instructions}</div>}
                </div>
                {m.active && (
                  <button type="button" className="btn btn-small" onClick={() => stop(m)}>
                    Stop
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <form className="card" onSubmit={submit}>
        <h2 style={{ marginTop: 0 }}>Add a medication</h2>

        <div className="field">
          <label htmlFor="med-name">Name</label>
          <input id="med-name" value={form.name} onChange={set('name')} required
                 aria-describedby={fieldErrors.name ? 'err-name' : undefined} />
          {fieldErrors.name && <span className="error" id="err-name">{fieldErrors.name}</span>}
        </div>

        <div className="field">
          <label htmlFor="med-dose">One dose is</label>
          <input id="med-dose" value={form.dose} onChange={set('dose')} placeholder="1 tablet" required />
          <span className="hint">Written however the prescription puts it — “half a tablet with food” is fine.</span>
        </div>

        <fieldset style={{ border: 0, padding: 0, margin: '0 0 0.9rem' }}>
          <legend style={{ fontWeight: 650, fontSize: 'var(--step--1)', padding: 0 }}>Times of day</legend>
          {form.timesOfDay.map((time, i) => (
            <div key={i} className="toolbar" style={{ marginBottom: '0.4rem' }}>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(i, e.target.value)}
                aria-label={`Dose time ${i + 1}`}
                required
                style={{ minHeight: 'var(--tap)', padding: '0.6rem 0.8rem', border: '2px solid var(--line)', borderRadius: 10, background: 'var(--surface)', color: 'var(--ink)', font: 'inherit' }}
              />
              {form.timesOfDay.length > 1 && (
                <button type="button" className="btn btn-small" onClick={() => removeTime(i)}
                        aria-label={`Remove dose time ${i + 1}`}>
                  Remove
                </button>
              )}
            </div>
          ))}
          <button type="button" className="btn btn-small" onClick={addTime}>Add another time</button>
        </fieldset>

        <fieldset style={{ border: 0, padding: 0, margin: '0 0 0.9rem' }}>
          <legend style={{ fontWeight: 650, fontSize: 'var(--step--1)', padding: 0 }}>
            Days (leave all unticked for every day)
          </legend>
          <div className="toolbar">
            {WEEKDAYS.map(([label, day]) => (
              <label key={day} className="tag" style={{ display: 'inline-flex', gap: '0.35rem', alignItems: 'center', minHeight: '2.5rem', padding: '0 0.7rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.daysOfWeek.includes(day)} onChange={() => toggleDay(day)} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="field">
          <label htmlFor="med-start">Starts</label>
          <input id="med-start" type="date" value={form.startDate} onChange={set('startDate')} required />
        </div>

        <div className="field">
          <label htmlFor="med-end">Ends (optional)</label>
          <input id="med-end" type="date" value={form.endDate} onChange={set('endDate')} />
        </div>

        <div className="field">
          <label htmlFor="med-notes">Notes (optional)</label>
          <textarea id="med-notes" rows="2" value={form.instructions} onChange={set('instructions')}
                    placeholder="After food" />
        </div>

        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Adding…' : 'Add medication'}
        </button>
      </form>
    </>
  );
}
