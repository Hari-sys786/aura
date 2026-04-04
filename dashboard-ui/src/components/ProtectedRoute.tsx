import { Navigate, Outlet, useLocation } from 'react-router-dom'

interface ProtectedRouteProps {
  token: string | null
  children?: React.ReactNode
}

/**
 * Wraps protected routes. If no token, redirects to /login.
 * Preserves the intended URL so user lands there after login.
 */
export default function ProtectedRoute({ token, children }: ProtectedRouteProps) {
  const location = useLocation()

  if (!token) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />
  }

  // If children passed (e.g. wrapping Layout), render children + Outlet
  // If used as a layout route wrapper, just render children
  return <>{children ?? <Outlet />}</>
}
