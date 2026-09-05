import { useSettings } from '../hooks/useSettings.jsx';

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
    <div className="card centre-card">
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
  );
}
