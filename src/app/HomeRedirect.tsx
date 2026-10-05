import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';

/**
 * `/` is not a screen in this product. Almost everyone arrives by scanning a
 * label, so the root just forwards to wherever this person actually works.
 */
export function HomeRedirect() {
  const { session, profile, loading } = useAuth();

  if (loading) return null;
  if (!session) return <Navigate to="/login" replace />;

  switch (profile?.role) {
    case 'senior_leader':
      return <Navigate to="/dashboard" replace />;
    case 'admin':
      return <Navigate to="/admin" replace />;
    case 'technician':
    case 'lab_hod':
      return <Navigate to="/staff" replace />;
    default:
      return <Navigate to="/notifications" replace />;
  }
}
