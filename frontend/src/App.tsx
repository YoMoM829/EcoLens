import { useState, useRef, useEffect } from 'react';
import { BrowserRouter, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import DashboardPage from './pages/DashboardPage';
import LoginPage from './pages/LoginPage';
import QueryPage from './pages/QueryPage';
import SignUpPage from './pages/SignUpPage';
import NotificationsPage from './pages/NotificationsPage';
import HelpPage from './pages/HelpPage';
import { AuthProvider, useAuth } from './context/AuthContext';

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <>{children}</> : <Navigate replace to="/signup" />;
}

function UserDropdown() {
  const { userEmail, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="user-dropdown-wrapper" ref={ref}>
      <button
        type="button"
        className="user-icon-btn"
        onClick={() => setOpen((o) => !o)}
        aria-label="User menu"
        aria-expanded={open}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
        </svg>
      </button>

      {open && (
        <div className="user-dropdown">
          <div className="user-dropdown-email">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}}><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
            {userEmail ?? 'Signed in'}
          </div>
          <div className="user-dropdown-divider" />
          <NavLink
            to="/notifications"
            className="user-dropdown-item"
            onClick={() => setOpen(false)}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
            Subscription
          </NavLink>
          <button
            type="button"
            className="user-dropdown-item user-dropdown-signout"
            onClick={() => { signOut(); setOpen(false); }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
}

function AppShell() {
  const { isAuthenticated } = useAuth();

  const navLink = ({ isActive }: { isActive: boolean }) =>
    isActive ? 'nav-link nav-link-active' : 'nav-link';

  return (
    <>
      <header className="navbar">
        <div className="nav-brand">
          <NavLink to={isAuthenticated ? '/dashboard' : '/signup'} className="logo">
            <svg className="logo-icon" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              {/* Outer lens ring */}
              <circle cx="18" cy="18" r="15" stroke="currentColor" strokeWidth="2.2" fill="none" opacity="0.25"/>
              {/* Inner lens shine */}
              <circle cx="18" cy="18" r="10" stroke="currentColor" strokeWidth="1.6" fill="none" opacity="0.45"/>
              {/* Leaf growing from center — eco motif */}
              <path
                d="M18 26 C18 26 10 22 10 15 C10 10 14 8 18 8 C22 8 26 10 26 15 C26 22 18 26 18 26Z"
                fill="currentColor"
                opacity="0.18"
              />
              <path
                d="M18 26 C18 26 10 22 10 15 C10 10 14 8 18 8 C22 8 26 10 26 15 C26 22 18 26 18 26Z"
                stroke="currentColor"
                strokeWidth="1.8"
                fill="none"
              />
              {/* Center vein */}
              <line x1="18" y1="26" x2="18" y2="10" stroke="currentColor" strokeWidth="1.2" opacity="0.6"/>
              {/* Lateral veins */}
              <path d="M18 20 Q14 17 12 14" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.5"/>
              <path d="M18 20 Q22 17 24 14" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.5"/>
            </svg>
            EcoLens
          </NavLink>
        </div>

        <nav className="nav-links">
          {isAuthenticated ? (
            <div className="nav-glass-pill">
              <NavLink className={navLink} to="/dashboard">Dashboard</NavLink>
              <NavLink className={navLink} to="/query">Queries</NavLink>
              <NavLink className={navLink} to="/help">Help</NavLink>
            </div>
          ) : null}
        </nav>

        <div className="nav-actions">
          {isAuthenticated ? (
            <UserDropdown />
          ) : (
            <NavLink className={navLink} to="/login">Login</NavLink>
          )}
        </div>
      </header>

      <Routes>
        <Route path="/" element={<Navigate replace to={isAuthenticated ? '/dashboard' : '/signup'} />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignUpPage />} />
        <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
        <Route path="/query" element={<ProtectedRoute><QueryPage /></ProtectedRoute>} />
        <Route path="/notifications" element={<ProtectedRoute><NotificationsPage /></ProtectedRoute>} />
        <Route path="/help" element={<ProtectedRoute><HelpPage /></ProtectedRoute>} />
        <Route path="*" element={<Navigate replace to="/" />} />
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </BrowserRouter>
  );
}
