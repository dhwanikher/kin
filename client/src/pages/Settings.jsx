import { useState } from 'react';

import { useSettings } from '../hooks/useSettings.jsx';
import { usePush } from '../hooks/usePush.js';
import { useAnnounce } from '../hooks/useAnnounce.jsx';

const SIZES = [
  ['Normal', 1],
  ['Large', 1.2],
  ['Larger', 1.45],
  ['Largest', 1.75],
];

/**
 * Display settings, deliberately not filed under "accessibility".
 *
 * The people using Kin are often in their seventies, reading a phone at arm's
 * length in a bright room. Larger text is not an accommodation for them, it is
 * how they read, so it sits in plain sight with everything else.
 */
export default function Settings() {
  const { textScale, contrast, setTextScale, setContrast } = useSettings();

  return (
    <div className="centre-card">
      <div className="card" style={{ marginBottom: '1rem' }}>
      <h1 style={{ marginTop: 0 }}>Display</h1>

      <fieldset style={{ border: 0, padding: 0, margin: '0 0 1.5rem' }}>
        <legend style={{ fontWeight: 650, padding: 0, marginBottom: '0.5rem' }}>Text size</legend>
        <div className="toolbar">
          {SIZES.map(([label, value]) => (
            <button
              key={label}
              type="button"
              className={`btn ${textScale === value ? 'btn-primary' : ''}`}
              aria-pressed={textScale === value}
              onClick={() => setTextScale(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="hint" style={{ marginTop: '0.6rem' }}>
          Everything on screen grows together, including the buttons.
        </p>
      </fieldset>

      <fieldset style={{ border: 0, padding: 0 }}>
        <legend style={{ fontWeight: 650, padding: 0, marginBottom: '0.5rem' }}>Contrast</legend>
        <div className="toolbar">
          <button
            type="button"
            className={`btn ${contrast === 'system' ? 'btn-primary' : ''}`}
            aria-pressed={contrast === 'system'}
            onClick={() => setContrast('system')}
          >
            Match my device
          </button>
          <button
            type="button"
            className={`btn ${contrast === 'high' ? 'btn-primary' : ''}`}
            aria-pressed={contrast === 'high'}
            onClick={() => setContrast('high')}
          >
            High contrast
          </button>
        </div>
      </fieldset>
      </div>

      <Notifications />
    </div>
  );
}

/**
 * Notifications are the only part of Kin that reaches somebody who is not
 * looking at it, which is what makes them the only part that can prevent a
 * missed dose rather than just record one.
 */
function Notifications() {
  const push = usePush();
  const announce = useAnnounce();
  const [sentTest, setSentTest] = useState(false);

  if (!push.supported) {
    return (
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Reminders</h2>
        <p className="dose-meta">
          This browser cannot receive notifications. On iPhone, add Kin to your Home Screen first.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Reminders</h2>
      <p className="dose-meta">
        Kin will tell you when a dose is more than half an hour late, once per dose. It never
        reminds you twice about the same one.
      </p>

      {push.error && (
        <p className="alert" role="alert">
          {push.error}
        </p>
      )}

      {!push.enabledOnServer && (
        <p className="alert alert-info" role="status">
          This server has no notification keys configured, so reminders are switched off for
          everybody.
        </p>
      )}

      <div className="toolbar">
        {push.subscribed ? (
          <>
            <button
              type="button"
              className="btn"
              disabled={push.busy}
              onClick={async () => {
                await push.unsubscribe();
                announce('Reminders turned off on this device');
              }}
            >
              Turn off on this device
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={push.busy}
              onClick={async () => {
                const ok = await push.sendTest();
                setSentTest(ok);
                announce(ok ? 'Test notification sent' : 'Could not send a test notification');
              }}
            >
              {push.busy ? 'Sending…' : 'Send me a test'}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            disabled={push.busy || !push.enabledOnServer}
            onClick={async () => {
              await push.subscribe();
              announce('Reminders turned on for this device');
            }}
          >
            {push.busy ? 'Just a moment…' : 'Turn on reminders'}
          </button>
        )}
      </div>

      {sentTest && (
        <p className="dose-meta" role="status" style={{ marginTop: '0.75rem' }}>
          Sent. If nothing appeared, your operating system may be suppressing notifications for
          this browser.
        </p>
      )}

      <p className="hint" style={{ marginTop: '0.75rem' }}>
        This is per device, so turning it on here does not turn it on for anyone else in the
        circle.
      </p>
    </div>
  );
}
