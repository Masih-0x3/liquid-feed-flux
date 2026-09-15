import { clearSettingsDraftSession } from '@/components/settings/SettingsDraftSession';
import { ReactNode, Suspense, useEffect, useRef, useState } from 'react';
import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';
import { navigationItems } from './navigation';
import { VersionBanner } from './VersionBanner';
import { BrandLogo } from './BrandLogo';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme, type ThemePreference } from '@/contexts/ThemeContext';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useRuntimeControls } from '@/hooks/useRuntimeControls';
import {
  Loader2,
  LockKeyhole,
  LogOut,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sun,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface AppLayoutProps {
  children?: ReactNode;
}

const THEME_OPTIONS: Array<{ value: ThemePreference; label: string; Icon: typeof Sun }> = [
  { value: 'light', label: 'Light theme', Icon: Sun },
  { value: 'dark', label: 'Dark theme', Icon: Moon },
  { value: 'system', label: 'System theme', Icon: Monitor },
];

function ThemeControls() {
  const { preference, setPreference } = useTheme();
  return (
    <div
      role="group"
      aria-label="Theme"
      className="flex items-center gap-0.5 rounded-md border border-sidebar-border p-0.5"
    >
      {THEME_OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          aria-label={label}
          aria-pressed={preference === value}
          title={label}
          onClick={() => setPreference(value)}
          className={cn(
            'inline-flex h-7 w-7 items-center justify-center rounded-[0.375rem] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            preference === value
              ? 'bg-sidebar-accent text-foreground'
              : 'text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-foreground',
          )}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

function SidebarNav({ collapsed }: { collapsed: boolean }) {
  return (
    <aside
      className={cn(
        'hidden shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex',
        collapsed ? 'md:w-16' : 'md:w-16 lg:w-[15.5rem]',
      )}
    >
      <div className={cn('flex h-14 shrink-0 items-center gap-2 border-b border-sidebar-border', collapsed ? 'justify-center px-2' : 'justify-center px-2 lg:justify-start lg:px-4')}>
        <BrandLogo compact className="h-8 w-8 shrink-0 rounded-lg ring-1 ring-sidebar-border" />
        <div className={cn('min-w-0', collapsed ? 'hidden' : 'hidden lg:block')}>
          <div className="flex items-center gap-1.5 text-sm font-semibold leading-tight text-foreground">
            <span>XOT</span>
            <span
              aria-label="XOT version 2"
              title="XOT version 2"
              className="inline-flex items-center rounded border border-primary/35 bg-primary/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold leading-none tracking-[0.08em] text-primary"
            >
              V2
            </span>
          </div>
          <div className="truncate text-[11px] leading-tight text-sidebar-foreground">
            Operational Panel
          </div>
        </div>
      </div>

      <nav aria-label="Primary navigation" className="flex-1 overflow-y-auto px-2 py-3">
        <ul className="flex flex-col gap-0.5">
          {navigationItems.map((item) => (
            <li key={item.title}>
              <NavLink
                to={item.url}
                end
                title={item.title}
                className={({ isActive }) =>
                  cn(
                    'group relative flex min-h-10 items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    collapsed ? 'justify-center' : 'justify-center lg:justify-start',
                    isActive
                      ? 'bg-sidebar-accent font-medium text-foreground'
                      : 'text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-foreground',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <span
                        aria-hidden="true"
                        className="absolute left-0 h-5 w-0.5 rounded-full bg-primary"
                      />
                    )}
                    <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className={cn('whitespace-nowrap', collapsed ? 'sr-only' : 'sr-only lg:not-sr-only')}>
                      {item.title}
                    </span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex shrink-0 flex-col gap-2 border-t border-sidebar-border px-2 py-3">
        <ThemeControls />
      </div>
    </aside>
  );
}

function MobileBottomNav() {
  return (
    <nav
      aria-label="Mobile navigation"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-sidebar-border bg-sidebar px-1.5 pb-[max(env(safe-area-inset-bottom),0.35rem)] pt-1.5 md:hidden"
    >
      <div className="grid grid-cols-3 gap-0.5 min-[360px]:grid-cols-6">
        {navigationItems.map((item) => (
          <NavLink
            key={item.title}
            to={item.url}
            end
            className={({ isActive }) =>
              cn(
                'flex min-h-12 min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-0 py-1.5 text-[10px] leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isActive
                  ? 'bg-sidebar-accent font-medium text-foreground'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-foreground',
              )
            }
          >
            <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="w-full whitespace-nowrap text-center">{item.title}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

export function AppLayout({ children }: AppLayoutProps) {
  const { user, status, authError, role, isAdmin, signOut, refreshSession } = useAuth();
  const { controls: runtimeControls, loading: runtimeLoading, error: runtimeError } = useRuntimeControls(status === 'authorised');
  const { toast } = useToast();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [retryingAuth, setRetryingAuth] = useState(false);
  const mainRef = useRef<HTMLElement | null>(null);
  const isReadOnly = role === 'read_only';
  const isWideOpsRoute = location.pathname.startsWith('/monitoring') || location.pathname.startsWith('/video-renders');
  const activeItem = navigationItems.find((item) =>
    item.url === '/' ? location.pathname === '/' : location.pathname.startsWith(item.url)
  ) ?? navigationItems[0];
  const environmentLabel = runtimeControls?.environment === 'preview'
    ? 'Preview'
    : runtimeControls?.environment === 'production'
      ? 'Production'
      : 'Runtime unknown';
  const postingStatusLabel = runtimeError ? 'Posting status unavailable' : runtimeLoading && !runtimeControls ? 'Checking posting status' : runtimeControls?.posting_mode === 'blocked'
    ? `Posting locked in ${environmentLabel}`
    : runtimeControls?.posting_mode === 'enabled'
      ? `Posting enabled in ${environmentLabel}`
      : 'Posting status unavailable';

  // The shell stays mounted; only the route content scrolls back to the top
  // so the previous page position never leaks into the next task.
  useEffect(() => {
    const mainEl = mainRef.current;
    if (mainEl) {
      if (typeof mainEl.scrollTo === 'function') {
        mainEl.scrollTo({ top: 0 });
      } else {
        mainEl.scrollTop = 0;
      }
    }
  }, [location.pathname]);

  const handleSignOut = async () => {
    try {
      const { error } = await signOut();
      if (error) throw error;
      clearSettingsDraftSession();

      toast({
        title: 'Signed out successfully',
        description: 'You have been logged out of the XOT Panel.',
      });
    } catch {
      toast({
        title: 'Error signing out',
        description: 'Please try again.',
        variant: 'destructive',
      });
    }
  };

  const handleAuthRetry = async () => {
    setRetryingAuth(true);
    try {
      await refreshSession();
    } finally {
      setRetryingAuth(false);
    }
  };

  if (status === 'booting' || status === 'authenticated-role-loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div role="status" aria-label="Loading XOT Panel" className="glass-panel p-8">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" aria-hidden="true" />
        </div>
      </div>
    );
  }

  if (status === 'degraded') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="glass-panel max-w-md space-y-4 rounded-2xl p-8 text-center">
          <ShieldAlert className="mx-auto h-12 w-12 text-destructive" aria-hidden="true" />
          <div className="space-y-2">
            <h2 className="text-xl font-display font-semibold text-foreground">Authentication needs attention</h2>
            <p className="text-sm text-muted-foreground">
              {authError?.message ?? 'We could not verify access to the XOT Panel.'}
            </p>
          </div>
          <Button type="button" onClick={handleAuthRetry} disabled={retryingAuth} className="w-full">
            <RefreshCw className={`mr-2 h-4 w-4 ${retryingAuth ? 'animate-spin' : ''}`} aria-hidden="true" />
            {retryingAuth ? 'Retrying authentication…' : 'Retry authentication'}
          </Button>
        </div>
      </div>
    );
  }

  if (status === 'unauthenticated' || !user) {
    return <Navigate to="/auth" replace />;
  }

  if (status === 'denied' || (!isAdmin && !isReadOnly)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="glass-panel p-8 rounded-2xl text-center space-y-4 max-w-md">
          <ShieldAlert className="w-12 h-12 text-destructive mx-auto" aria-hidden="true" />
          <h2 className="text-xl font-display font-semibold text-foreground">Access Denied</h2>
          <p className="text-muted-foreground text-sm">
            Your account does not have admin access. Contact your administrator to request access.
          </p>
          <Button type="button" variant="outline" onClick={handleSignOut}>
            <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
            Sign out
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-svh min-h-svh w-full overflow-hidden bg-background">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:absolute focus:left-3 focus:top-3"
      >
        Skip to content
      </a>

      <SidebarNav collapsed={collapsed} />

      <div className="flex min-w-0 flex-1 flex-col">
        {isReadOnly && (
          <div
            role="status"
            aria-label="Read-only access"
            className="flex min-h-8 shrink-0 items-center justify-center gap-2 border-b border-warning/30 bg-warning/10 px-3 py-1.5 text-center text-xs font-medium text-warning"
          >
            <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>Read-only access</span>
            <span className="font-normal text-warning/90">Viewing only. Changes are disabled.</span>
          </div>
        )}

        {/* Compact contextual header: route label, posting status, version, account */}
        <header className="flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border/70 bg-background px-3 py-2 sm:px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
              aria-pressed={collapsed}
              title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
              onClick={() => setCollapsed((value) => !value)}
              className="hidden h-8 w-8 shrink-0 rounded-md p-0 text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:inline-flex"
            >
              {collapsed ? (
                <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
              ) : (
                <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
              )}
            </Button>
            <div className="flex min-w-0 items-center gap-2 md:hidden">
              <BrandLogo compact className="h-7 w-7 shrink-0 rounded-md ring-1 ring-border" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">
                {location.pathname === '/x-account' ? 'My X' : activeItem.title}
              </p>
              <p className="hidden truncate text-xs text-muted-foreground sm:block">
                {location.pathname === '/x-account' ? 'Legacy destination (disabled)' : 'XOT operational workspace'}
              </p>
            </div>
          </div>

          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            <div
              role="status"
              aria-label="Posting status"
              title={postingStatusLabel}
              className={cn(
                'flex min-w-0 items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium',
                runtimeControls?.posting_mode === 'enabled' && !runtimeError
                  ? 'border-success/30 bg-success/10 text-success'
                  : 'border-warning/30 bg-warning/10 text-warning',
              )}
            >
              {runtimeControls?.posting_mode === 'enabled' && !runtimeError ? (
                <ShieldCheck className="hidden h-3.5 w-3.5 shrink-0 sm:block" aria-hidden="true" />
              ) : (
                <LockKeyhole className="hidden h-3.5 w-3.5 shrink-0 sm:block" aria-hidden="true" />
              )}
              <span className="min-w-0 leading-snug">
                <span className="block sm:hidden">{environmentLabel}</span>
                <span className="sm:hidden">
                  {runtimeError
                    ? 'Status unavailable'
                    : runtimeLoading && !runtimeControls
                      ? 'Checking status'
                      : runtimeControls?.posting_mode === 'enabled'
                        ? 'Enabled'
                        : runtimeControls?.posting_mode === 'blocked'
                          ? 'Posting locked'
                          : 'Status unavailable'}
                </span>
                <span className="hidden sm:inline">{postingStatusLabel}</span>
              </span>
            </div>
            <div className="hidden min-w-0 2xl:flex">
              <VersionBanner />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleSignOut}
              className="h-8 shrink-0 rounded-md px-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              <span className="ml-2 hidden lg:inline">Sign out</span>
            </Button>
          </div>
        </header>

        {/* Main Content — the single scroll owner of the workspace */}
        <main
          ref={mainRef}
          id="main-content"
          tabIndex={-1}
          className="flex-1 overflow-auto overflow-x-hidden bg-canvas px-3 pb-28 min-[360px]:pb-24 sm:px-5 sm:pb-6 md:pb-6"
        >
          <div className={`mx-auto w-full ${isWideOpsRoute ? 'max-w-none' : 'max-w-7xl'}`}>
            <Suspense
              key={user?.id ?? 'anonymous'}
              fallback={
                <div role="status" className="min-h-60 space-y-4 py-4 text-sm text-muted-foreground">
                  <p>Loading page…</p>
                  <div className="h-12 rounded-md bg-muted/40" />
                  <div className="h-40 rounded-md bg-muted/40" />
                </div>
              }
            >
              {children ?? <Outlet />}
            </Suspense>
          </div>
        </main>
      </div>

      <MobileBottomNav />
    </div>
  );
}
