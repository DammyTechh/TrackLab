import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Brandmark } from '@/ui/Brandmark';
import { SyncState } from '@/ui/SyncState';
import { Icon } from '@/ui/Icon';
import { supabase } from '@/lib/supabase';
import { useNetwork } from './NetworkProvider';
import { useAuth, type AppRole } from './AuthProvider';
import { reconcilePush, useLiveAlerts } from '@/features/notifications';

interface NavEntry {
  to: string;
  label: string;
  icon: string;
}

const NAV: Record<AppRole, NavEntry[]> = {
  technician: [
    { to: '/staff', label: 'My equipment', icon: 'inventory_2' },
    { to: '/staff/equipment/new', label: 'Register', icon: 'add_circle' },
    { to: '/staff/labels', label: 'Labels', icon: 'qr_code_2' },
    { to: '/reports', label: 'Reports', icon: 'download' },
  ],
  lab_hod: [
    { to: '/staff', label: 'My equipment', icon: 'inventory_2' },
    { to: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
    { to: '/staff/equipment/new', label: 'Register', icon: 'add_circle' },
    { to: '/staff/labels', label: 'Labels', icon: 'qr_code_2' },
    { to: '/reports', label: 'Reports', icon: 'download' },
  ],
  senior_leader: [
    { to: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
    { to: '/reports', label: 'Reports', icon: 'download' },
  ],
  admin: [{ to: '/admin', label: 'Admin', icon: 'admin_panel_settings' }],
};

const ROLE_LABEL: Record<AppRole, string> = {
  technician: 'Technician',
  lab_hod: 'Lab HOD',
  senior_leader: 'Senior leader',
  admin: 'Administrator',
};

/**
 * Header for every screen. On a desktop the links sit in the bar; below
 * 1024px they fold behind a menu button, because six links and a sync badge
 * do not fit across a phone.
 */
export function AppShell() {
  const { state, queued } = useNetwork();
  const { session, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);

  // Navigation only once the password is real; the forced change comes first.
  const showNav = Boolean(session && profile && !profile.must_change_password);
  const links: NavEntry[] =
    showNav && profile
      ? [...NAV[profile.role], { to: '/notifications', label: 'Alerts', icon: 'notifications' }]
      : [];

  const { data: unread = 0 } = useQuery({
    queryKey: ['alerts-unread', location.pathname],
    enabled: showNav,
    queryFn: async () => {
      const { count } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .is('read_at', null);
      return count ?? 0;
    },
  });

  // Live badge, and re-record this device for push if the browser is
  // already subscribed (a shared phone someone else turned it on for).
  useLiveAlerts(showNav ? profile?.id : undefined);
  useEffect(() => {
    if (showNav) void reconcilePush();
  }, [showNav, profile?.id]);

  // Close the menu on navigation and on Escape.
  useEffect(() => setMenuOpen(false), [location.pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  async function onSignOut() {
    setMenuOpen(false);
    await signOut();
    // The next person on this device must not see the last person's data.
    queryClient.clear();
    navigate('/login', { replace: true });
  }

  return (
    <div className="flex min-h-screen flex-col bg-surface-page print:bg-surface-raised">
      <header className="sticky top-0 z-30 border-b border-line-subtle bg-surface-raised print:hidden">
        <div className="mx-auto flex h-[56px] w-full max-w-[80rem] items-center gap-2 px-4 sm:px-6">
          <NavLink to="/" aria-label="Home" className="flex shrink-0 items-center">
            <Brandmark height={26} />
          </NavLink>

          <nav aria-label="Main" className="ml-4 hidden items-center gap-1 lg:flex">
            {links.map((link) => (
              <NavItem key={link.to} {...link} badge={link.to === '/notifications' ? unread : 0} />
            ))}
          </nav>

          <div className="flex-1" />
          {session ? <SyncState state={state} queued={queued} /> : null}

          {session ? (
            <button
              type="button"
              onClick={onSignOut}
              className="hidden min-h-touch items-center gap-2 rounded-md px-3 text-[14px] font-semibold text-ink-muted hover:bg-surface-sunken lg:inline-flex"
            >
              <Icon name="logout" />
              Sign out
            </button>
          ) : null}

          {session ? (
            <button
              type="button"
              onClick={() => setMenuOpen(!menuOpen)}
              aria-expanded={menuOpen}
              aria-controls="mobile-menu"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              className="relative flex h-12 w-12 items-center justify-center rounded-md text-ink-strong hover:bg-surface-sunken lg:hidden"
            >
              <Icon name={menuOpen ? 'close' : 'menu'} />
              {!menuOpen && unread > 0 ? (
                <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-urgent-ink" aria-hidden />
              ) : null}
            </button>
          ) : null}
        </div>

        {menuOpen ? (
          <>
            {/* Tap outside to close. */}
            <button
              type="button"
              aria-label="Close menu"
              tabIndex={-1}
              onClick={() => setMenuOpen(false)}
              style={{ background: 'var(--overlay-scrim)' }}
              className="fixed inset-0 top-[57px] z-0 cursor-default lg:hidden"
            />
            <div
              id="mobile-menu"
              className="absolute inset-x-0 top-full z-10 max-h-[calc(100vh-57px)] overflow-y-auto border-b border-line-subtle bg-surface-raised shadow-sheet lg:hidden"
            >
              {profile ? (
                <div className="border-b border-line-subtle px-4 py-4 sm:px-6">
                  <p className="m-0 text-[16px] font-semibold text-ink-strong">{profile.full_name}</p>
                  <p className="m-0 mt-1 text-[13px] text-ink-muted">{ROLE_LABEL[profile.role]}</p>
                </div>
              ) : null}
              <nav aria-label="Main" className="flex flex-col px-2 py-2 sm:px-4">
                {links.map((link) => (
                  <NavItem
                    key={link.to}
                    {...link}
                    badge={link.to === '/notifications' ? unread : 0}
                    stacked
                  />
                ))}
              </nav>
              <div className="border-t border-line-subtle px-2 py-2 sm:px-4">
                <button
                  type="button"
                  onClick={onSignOut}
                  className="flex min-h-touch w-full items-center gap-3 rounded-md px-3 text-[15px] font-semibold text-urgent-ink hover:bg-surface-sunken"
                >
                  <Icon name="logout" />
                  Sign out
                </button>
              </div>
            </div>
          </>
        ) : null}
      </header>

      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}

function NavItem({
  to,
  label,
  icon,
  badge,
  stacked = false,
}: NavEntry & { badge: number; stacked?: boolean }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        [
          'inline-flex min-h-touch shrink-0 items-center gap-3 rounded-md px-3 font-semibold no-underline',
          stacked ? 'w-full text-[15px]' : 'text-[14px]',
          isActive ? 'bg-brand-surface text-brand' : 'text-ink hover:bg-surface-sunken',
        ].join(' ')
      }
    >
      <Icon name={icon} size={stacked ? 20 : 18} />
      <span className={stacked ? 'flex-1' : ''}>{label}</span>
      {badge > 0 ? (
        <span className="rounded-full bg-urgent-ink px-2 text-[12px] leading-5 text-ink-ondark">{badge}</span>
      ) : null}
    </NavLink>
  );
}
