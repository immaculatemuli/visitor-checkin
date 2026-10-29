import { useEffect } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, useOutletContext } from 'react-router';
import { api, ApiError, type Staff } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { IconLogout } from '../../components/icons';
import { cx, FullPageSpinner, Logo, NysStripe } from '../../components/ui';

export function useStaff(): Staff {
  return useOutletContext<Staff>();
}

const LINKS: { to: string; label: string; adminOnly?: boolean }[] = [
  { to: '/admin', label: 'Live' },
  { to: '/admin/history', label: 'History' },
  { to: '/admin/manual', label: 'Manual check-in' },
  { to: '/admin/watchlist', label: 'Watchlist' },
  { to: '/admin/wifi', label: 'Office Wi-Fi' },
  { to: '/admin/poster', label: 'Reception QR' },
  { to: '/admin/staff', label: 'Staff', adminOnly: true },
  { to: '/admin/audit', label: 'Audit log', adminOnly: true },
];

export default function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const me = useApi<{ staff: Staff }>('/auth/me');

  useEffect(() => {
    if (me.error instanceof ApiError && me.error.status === 401) {
      navigate(`/admin/login?next=${encodeURIComponent(location.pathname)}`, { replace: true });
    }
  }, [me.error, navigate, location.pathname]);

  if (!me.data) {
    return me.error && !(me.error instanceof ApiError && me.error.status === 401) ? (
      <p className="p-10 text-center text-slate-500">{me.error.message}</p>
    ) : (
      <FullPageSpinner />
    );
  }

  const staff = me.data.staff;
  async function logout() {
    await api('/auth/logout', { method: 'POST' });
    navigate('/admin/login');
  }

  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="sticky top-0 z-10 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4">
          <Logo />
          <nav className="hidden flex-1 gap-1 text-sm md:flex">
            {LINKS.filter((l) => !l.adminOnly || staff.role === 'admin').map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.to === '/admin'}
                className={({ isActive }) => cx('rounded-lg px-3 py-2 font-medium transition', isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:text-slate-900')}
              >
                {l.label}
              </NavLink>
            ))}
            <a href="/poster" target="_blank" rel="noreferrer" className="rounded-lg px-3 py-2 font-medium text-slate-500 hover:text-slate-900">
              QR poster ↗
            </a>
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold leading-tight">{staff.name}</p>
              <p className="text-xs capitalize leading-tight text-slate-400">{staff.role}</p>
            </div>
            <button onClick={() => void logout()} className="flex h-10 w-10 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100" aria-label="Sign out">
              <IconLogout className="h-5 w-5" />
            </button>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2 text-sm md:hidden">
          {LINKS.filter((l) => !l.adminOnly || staff.role === 'admin').map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.to === '/admin'}
              className={({ isActive }) => cx('whitespace-nowrap rounded-full px-3 py-1.5 font-medium', isActive ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600')}
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
        <NysStripe />
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet context={staff} />
      </main>
    </div>
  );
}
