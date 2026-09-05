import { Navigate, NavLink, Route, Routes, useParams } from 'react-router-dom';

import { useAuth } from './hooks/useAuth.jsx';
import SignIn from './pages/SignIn.jsx';
import Circles from './pages/Circles.jsx';
import Today from './pages/Today.jsx';
import Medications from './pages/Medications.jsx';
import People from './pages/People.jsx';
import Settings from './pages/Settings.jsx';

function TopBar() {
  const { user, signOut } = useAuth();

  return (
    <header className="topbar">
      <div className="brand">
        Kin
        <small>shared care schedule</small>
      </div>
      {user && (
        <div className="toolbar">
          <span className="tag">{user.name}</span>
          <NavLink className="btn btn-small btn-ghost" to="/settings">
            Display
          </NavLink>
          <button type="button" className="btn btn-small" onClick={signOut}>
            Sign out
          </button>
        </div>
      )}
    </header>
  );
}

function CircleNav() {
  const { circleId } = useParams();
  return (
    <nav className="nav" aria-label="Circle sections">
      <NavLink to={`/c/${circleId}/today`}>Today</NavLink>
      <NavLink to={`/c/${circleId}/medications`}>Medications</NavLink>
      <NavLink to={`/c/${circleId}/people`}>People</NavLink>
      <NavLink to="/circles">Switch circle</NavLink>
    </nav>
  );
}

function CircleLayout({ children }) {
  return (
    <>
      <CircleNav />
      <main id="main">{children}</main>
    </>
  );
}

function RequireAuth({ children }) {
  const { user, loading } = useAuth();

  // Nothing is rendered until the refresh attempt settles, so a signed-in user
  // reloading the page does not flash past a sign-in screen.
  if (loading) {
    return (
      <main id="main">
        <p className="empty" role="status">
          Loading…
        </p>
      </main>
    );
  }
  if (!user) return <Navigate to="/signin" replace />;
  return children;
}

export default function App() {
  const { user, loading } = useAuth();

  return (
    <div className="app">
      <TopBar />

      <Routes>
        <Route
          path="/signin"
          element={
            loading ? null : user ? <Navigate to="/circles" replace /> : (
              <main id="main">
                <SignIn />
              </main>
            )
          }
        />

        <Route
          path="/circles"
          element={
            <RequireAuth>
              <main id="main">
                <Circles />
              </main>
            </RequireAuth>
          }
        />

        <Route
          path="/settings"
          element={
            <main id="main">
              <Settings />
            </main>
          }
        />

        <Route
          path="/c/:circleId/today"
          element={
            <RequireAuth>
              <CircleLayout>
                <Today />
              </CircleLayout>
            </RequireAuth>
          }
        />
        <Route
          path="/c/:circleId/medications"
          element={
            <RequireAuth>
              <CircleLayout>
                <Medications />
              </CircleLayout>
            </RequireAuth>
          }
        />
        <Route
          path="/c/:circleId/people"
          element={
            <RequireAuth>
              <CircleLayout>
                <People />
              </CircleLayout>
            </RequireAuth>
          }
        />

        <Route path="/" element={<Navigate to={user ? '/circles' : '/signin'} replace />} />
        <Route
          path="*"
          element={
            <main id="main">
              <p className="empty">That page does not exist.</p>
            </main>
          }
        />
      </Routes>
    </div>
  );
}
