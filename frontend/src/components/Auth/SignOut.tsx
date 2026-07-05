/**
 * SignOut.tsx
 *
 * Sign-out button rendered in the navigation bar for authenticated users.
 * Clears the session via AuthContext (which removes tokens from sessionStorage
 * and sets isAuthenticated to false), then navigates to the sign-up page.
 */

import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

/** Navigation bar button that ends the current session. */
export default function SignOut() {
  const navigate = useNavigate();
  const { signOut } = useAuth();

  return (
    <button
      className="nav-button"
      type="button"
      onClick={() => {
        signOut();
        navigate('/signup');
      }}
    >
      Sign Out
    </button>
  );
}
