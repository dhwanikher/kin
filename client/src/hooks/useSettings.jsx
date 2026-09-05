import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const SettingsContext = createContext(null);
const STORAGE_KEY = 'kin.settings';

const DEFAULTS = { textScale: 1, contrast: 'system' };

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') };
  } catch {
    // A private window, cleared site data, or storage disabled entirely. The
    // app works fine at the defaults, so this is not worth surfacing.
    return DEFAULTS;
  }
}

/**
 * Display settings that persist per device.
 *
 * These sit in the main settings area rather than behind an "accessibility"
 * heading, because for the people this app is for, larger text is not an
 * accommodation — it is how they read.
 */
export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(load);

  useEffect(() => {
    document.documentElement.style.setProperty('--scale', String(settings.textScale));
    if (settings.contrast === 'high') {
      document.documentElement.setAttribute('data-contrast', 'high');
    } else {
      document.documentElement.removeAttribute('data-contrast');
    }

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Nothing to do; the setting simply will not survive a reload.
    }
  }, [settings]);

  const value = useMemo(
    () => ({
      ...settings,
      setTextScale: (textScale) => setSettings((s) => ({ ...s, textScale })),
      setContrast: (contrast) => setSettings((s) => ({ ...s, contrast })),
    }),
    [settings]
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used inside SettingsProvider');
  return ctx;
}
