import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

const AnnounceContext = createContext(null);

/**
 * A single polite live region for the whole app.
 *
 * Screen readers announce changes to this element's text. It matters here more
 * than in most apps, because things change on the page without the user having
 * done anything — somebody else in the family marks a dose and the list moves
 * under them. Without an announcement, a screen reader user is simply told
 * nothing, and later finds the dose already ticked with no idea why.
 */
export function AnnounceProvider({ children }) {
  const [message, setMessage] = useState('');
  const timer = useRef(null);

  const announce = useCallback((text) => {
    // Clearing first guarantees the reader treats an identical repeat message
    // as a change; otherwise "Priya marked Amlodipine as given" twice in a row
    // is silent the second time.
    setMessage('');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(text), 60);
  }, []);

  const value = useMemo(() => ({ announce }), [announce]);

  return (
    <AnnounceContext.Provider value={value}>
      {children}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {message}
      </div>
    </AnnounceContext.Provider>
  );
}

export function useAnnounce() {
  const ctx = useContext(AnnounceContext);
  if (!ctx) throw new Error('useAnnounce must be used inside AnnounceProvider');
  return ctx.announce;
}
