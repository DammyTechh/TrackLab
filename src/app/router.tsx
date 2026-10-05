import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from './AppShell';
import { HomeRedirect } from './HomeRedirect';
import { NotFoundPage } from './NotFoundPage';
import { RequireAuth } from './guards/RequireAuth';
import { RequireRole } from './guards/RequireRole';

// Loaded up front: the scan entry points and the screens a technician uses
// on the bench, so they open instantly and work offline from the precache.
import { PassportPage } from '@/features/public-passport/PassportPage';
import { LabBoardPage } from '@/features/lab-board/LabBoardPage';
import { LoginPage } from '@/features/auth/LoginPage';
import { ChangePasswordPage } from '@/features/auth/ChangePasswordPage';
import { StaffHomePage } from '@/features/equipment/StaffHomePage';
import { RegisterEquipmentPage } from '@/features/equipment/RegisterEquipmentPage';
import { EventFormPage } from '@/features/events/EventFormPage';
import { AlertsPage } from '@/features/notifications/AlertsPage';

/** Desk screens, fetched the first time they are opened. */
function deferred(load: () => Promise<ComponentType>): ReactNode {
  const Page = lazy(async () => ({ default: await load() }));
  return (
    <Suspense fallback={<p className="p-6 text-ink-muted">Loading…</p>}>
      <Page />
    </Suspense>
  );
}

const DashboardPage = deferred(() =>
  import('@/features/dashboard/DashboardPage').then((m) => m.DashboardPage),
);
const ReportsPage = deferred(() => import('@/features/reports/ReportsPage').then((m) => m.ReportsPage));
const LabelsPage = deferred(() => import('@/features/equipment/LabelsPage').then((m) => m.LabelsPage));
// Needs a connection anyway (editing is online-only), so it can load on demand.
const EditEquipmentPage = deferred(() =>
  import('@/features/equipment/EditEquipmentPage').then((m) => m.EditEquipmentPage),
);
const AdminPage = deferred(() => import('@/features/admin/AdminPage').then((m) => m.AdminPage));
const ReplacementOutcomePage = deferred(() =>
  import('@/features/service-reports/ReplacementOutcomePage').then((m) => m.ReplacementOutcomePage),
);

/**
 * Route access mirrors the RLS policies exactly. The guards are a courtesy
 * that keeps people off screens that would come back empty; the database is
 * what actually enforces access.
 *
 *   /                      forwards to the person's home (HomeRedirect)
 *   /e/:qrToken            public equipment passport (update panel when allowed)
 *   /l/:labToken           public lab entrance board
 *   /login                 staff sign in, no sign-up
 *   /change-password       forced on first sign-in
 *   /notifications         alerts, any signed-in role
 *   /staff/...             technician, lab_hod
 *   /dashboard             lab_hod (own labs), senior_leader (all)
 *   /reports               technician, lab_hod, senior_leader
 *   /admin                 admin
 */
export const router = createBrowserRouter(
  [
    {
      element: <AppShell />,
      // Last resort, if the shell itself fails.
      errorElement: <NotFoundPage />,
      children: [
        {
          // Errors inside a screen render here, under the header, so the
          // menu and sign out stay reachable.
          errorElement: <NotFoundPage />,
          children: [
            { index: true, element: <HomeRedirect /> },

            // Public. No session, no redirect, no account.
            { path: '/e/:qrToken', element: <PassportPage /> },
            { path: '/l/:labToken', element: <LabBoardPage /> },
            { path: '/login', element: <LoginPage /> },

            {
              element: <RequireAuth />,
              children: [
                { path: '/change-password', element: <ChangePasswordPage /> },
                { path: '/notifications', element: <AlertsPage /> },
                {
                  element: <RequireRole roles={['technician', 'lab_hod']} />,
                  children: [
                    { path: '/staff', element: <StaffHomePage /> },
                    { path: '/staff/equipment/new', element: <RegisterEquipmentPage /> },
                    { path: '/staff/equipment/:id/event/:type', element: <EventFormPage /> },
                    { path: '/staff/equipment/:id/edit', element: EditEquipmentPage },
                    { path: '/staff/equipment/:id/replacement', element: ReplacementOutcomePage },
                    { path: '/staff/labels', element: LabelsPage },
                  ],
                },
                {
                  element: <RequireRole roles={['lab_hod', 'senior_leader']} />,
                  children: [{ path: '/dashboard', element: DashboardPage }],
                },
                {
                  element: <RequireRole roles={['technician', 'lab_hod', 'senior_leader']} />,
                  children: [{ path: '/reports', element: ReportsPage }],
                },
                {
                  element: <RequireRole roles={['admin']} />,
                  children: [{ path: '/admin', element: AdminPage }],
                },
              ],
            },

            { path: '*', element: <NotFoundPage /> },
          ],
        },
      ],
    },
  ]);
