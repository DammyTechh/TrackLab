import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../AuthProvider';

export function RequireAuth() {
  const { session, profile, loading } = useAuth();
  const location = useLocation();

  if (loading) return null;
  if (!session) return <Navigate to="/login" state={{ from: location.pathname }} replace />;

  // First sign-in forces a password change before anything else is reachable.
  if (profile?.must_change_password && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }
  return <Outlet />;
}
