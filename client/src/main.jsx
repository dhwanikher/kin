import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import App from './App.jsx';
import { AuthProvider } from './hooks/useAuth.jsx';
import { SettingsProvider } from './hooks/useSettings.jsx';
import { AnnounceProvider } from './hooks/useAnnounce.jsx';
import './styles/app.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <SettingsProvider>
        <AnnounceProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </AnnounceProvider>
      </SettingsProvider>
    </BrowserRouter>
  </StrictMode>
);
