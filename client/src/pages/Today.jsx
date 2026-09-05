import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';

import { api, ApiError } from '../api/client.js';
import { useCircleSocket } from '../hooks/useSocket.js';
import { useAnnounce } from '../hooks/useAnnounce.jsx';

/** Time of day in the circle's timezone, not the phone's. */
function formatTime(iso, timezone) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
  }).format(new Date(iso));
}

const STATUS_WORD = { given: 'Given', skipped: 'Skipped', missed: 'Missed' };

export default function Today() {
  const { circleId } = useParams();
  const announce = useAnnounce();

  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [busyId, setBusyId] = useState(null);
  const [conflict, setConflict] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await api.get(`/api/circles/${circleId}/occurrences`);
      setState({ loading: false, error: null, data });
    } catch (err) {
      setState({ loading: false, error: err.message, data: null });
    }
  }, [circleId]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Someone else in the family acted. Patch that one dose in place rather than
   * refetching, so the list does not jump under whoever is reading it.
   */
  const applyRemote = useCallback(
    ({ occurrence }) => {
      setState((prev) => {
        if (!prev.data) return prev;
        const exists = prev.data.occurrences.some((o) => o._id === occurrence._id);
        if (!exists) return prev;
        return {
          ...prev,
          data: {
            ...prev.data,
            occurrences: prev.data.occurrences.map((o) => (o._id === occurrence._id ? occurrence : o)),
          },
        };
      });

      const who = occurrence.resolvedBy?.name;
      const drug = occurrence.medication?.name ?? 'A dose';
      announce(
        occurrence.status === 'due'
          ? `${drug} was put back to due`
          : `${who ?? 'Someone'} marked ${drug} as ${occurrence.status}`
      );
    },
    [announce]
  );

  useCircleSocket(circleId, { onResolved: applyRemote, onMedicationChanged: load });

  async function resolve(occurrence, status) {
    setBusyId(occurrence._id);
    setConflict(null);
    try {
      const { occurrence: updated } = await api.post(
        `/api/circles/${circleId}/occurrences/${occurrence._id}/resolve`,
        { status }
      );
      setState((prev) => ({
        ...prev,
        data: {
          ...prev.data,
          occurrences: prev.data.occurrences.map((o) => (o._id === updated._id ? updated : o)),
        },
      }));
      announce(`${updated.medication?.name ?? 'Dose'} marked as ${status}`);
    } catch (err) {
      // The race actually happening. Tell them who won and show the dose in the
      // state it really is, rather than a generic failure they cannot act on.
      if (err instanceof ApiError && err.status === 409) {
        const theirs = err.body?.details?.occurrence;
        setConflict(err.message);
        announce(err.message);
        if (theirs) {
          setState((prev) => ({
            ...prev,
            data: {
              ...prev.data,
              occurrences: prev.data.occurrences.map((o) => (o._id === theirs._id ? theirs : o)),
            },
          }));
        }
      } else {
        setConflict(err.message);
        announce(err.message);
      }
    } finally {
      setBusyId(null);
    }
  }

  async function undo(occurrence) {
    setBusyId(occurrence._id);
    setConflict(null);
    try {
      const { occurrence: updated } = await api.post(
        `/api/circles/${circleId}/occurrences/${occurrence._id}/undo`
      );
      setState((prev) => ({
        ...prev,
        data: {
          ...prev.data,
          occurrences: prev.data.occurrences.map((o) => (o._id === updated._id ? updated : o)),
        },
      }));
      announce(`${updated.medication?.name ?? 'Dose'} put back to due`);
    } catch (err) {
      setConflict(err.message);
      announce(err.message);
    } finally {
      setBusyId(null);
    }
  }

  const groups = useMemo(() => {
    const all = state.data?.occurrences ?? [];
    return {
      overdue: all.filter((o) => o.status === 'due' && o.overdue),
      upcoming: all.filter((o) => o.status === 'due' && !o.overdue),
      done: all.filter((o) => o.status !== 'due'),
    };
  }, [state.data]);

  if (state.loading) return <p className="empty" role="status">Loading today’s doses…</p>;
  if (state.error) return <p className="alert" role="alert">{state.error}</p>;

  const { timezone } = state.data;
  const nothing = groups.overdue.length + groups.upcoming.length + groups.done.length === 0;

  return (
    <>
      <h1 className="sr-only">Today’s doses</h1>

      {conflict && (
        <p className="alert" role="alert">
          {conflict}
        </p>
      )}

      {nothing && (
        <div className="empty">
          <p>Nothing scheduled today.</p>
          <p>Add a medication and its doses will appear here.</p>
        </div>
      )}

      <DoseGroup
        title="Overdue"
        className="overdue"
        doses={groups.overdue}
        timezone={timezone}
        busyId={busyId}
        onResolve={resolve}
        onUndo={undo}
      />
      <DoseGroup
        title="Still to come"
        doses={groups.upcoming}
        timezone={timezone}
        busyId={busyId}
        onResolve={resolve}
        onUndo={undo}
      />
      <DoseGroup
        title="Done"
        doses={groups.done}
        timezone={timezone}
        busyId={busyId}
        onResolve={resolve}
        onUndo={undo}
      />
    </>
  );
}

function DoseGroup({ title, className = '', doses, timezone, busyId, onResolve, onUndo }) {
  if (doses.length === 0) return null;

  return (
    <section className={`group ${className}`} aria-labelledby={`group-${title}`}>
      <h2 id={`group-${title}`}>
        {title} ({doses.length})
      </h2>
      <ul className="doses">
        {doses.map((dose) => (
          <Dose
            key={dose._id}
            dose={dose}
            timezone={timezone}
            busy={busyId === dose._id}
            onResolve={onResolve}
            onUndo={onUndo}
          />
        ))}
      </ul>
    </section>
  );
}

function Dose({ dose, timezone, busy, onResolve, onUndo }) {
  const done = dose.status !== 'due';
  const time = formatTime(dose.dueAt, timezone);
  const name = dose.medication?.name ?? 'Medication';

  return (
    <li className={`dose ${dose.overdue ? 'is-overdue' : ''} ${done ? 'is-done' : ''}`}>
      <div className="dose-body">
        <div className="dose-time">
          {time}
          {dose.overdue && (
            <>
              {' '}
              <span className="badge">Overdue</span>
            </>
          )}
        </div>
        <div className="dose-name">{name}</div>
        <div className="dose-meta">
          {dose.medication?.dose}
          {dose.medication?.instructions ? ` · ${dose.medication.instructions}` : ''}
        </div>
        {done && (
          <p className={`dose-status ${dose.status}`}>
            {STATUS_WORD[dose.status]}
            {dose.resolvedBy?.name ? ` by ${dose.resolvedBy.name}` : ''}
            {dose.note ? ` — ${dose.note}` : ''}
          </p>
        )}
      </div>

      <div className="dose-actions">
        {done ? (
          <button type="button" className="btn btn-small" disabled={busy} onClick={() => onUndo(dose)}>
            Undo
          </button>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-small"
              disabled={busy}
              onClick={() => onResolve(dose, 'skipped')}
            >
              Skip
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => onResolve(dose, 'given')}
              // Spelling out the drug and time means a screen reader user is
              // not choosing between six buttons all called "Given".
              aria-label={`Mark ${name} at ${time} as given`}
            >
              {busy ? 'Saving…' : 'Given'}
            </button>
          </>
        )}
      </div>
    </li>
  );
}
