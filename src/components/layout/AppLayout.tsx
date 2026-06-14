import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, NavLink, useLocation } from 'react-router-dom';
import { navigationItems } from './navigation';
import { VersionBanner } from './VersionBanner';
import { BrandLogo } from './BrandLogo';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Loader2, LogOut, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const { user, loading, role, isAdmin, signOut } = useAuth();
  const { toast } = useToast();
  const location = useLocation();
  const [headerState, setHeaderState] = useState({ docked: false, hidden: false });
  const mainRef = useRef<HTMLElement | null>(null);
  const lastScrollTopRef = useRef(0);
  const hideTimerRef = useRef<number | null>(null);
  const reduceMotionRef = useRef(false);
  const isWideOpsRoute = location.pathname.startsWith('/monitoring') || location.pathname.startsWith('/video-renders');
  const activeItem = navigationItems.find((item) =>
    item.url === '/' ? location.pathname === '/' : location.pathname.startsWith(item.url)
  ) ?? navigationItems[0];

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const setHeaderVisibility = useCallback((next: { docked: boolean; hidden: boolean }) => {
    setHeaderState((current) =>
      current.docked === next.docked && current.hidden === next.hidden ? current : next
    );
  }, []);

  const revealHeader = useCallback(() => {
    clearHideTimer();
    const scrollTop = mainRef.current?.scrollTop ?? 0;
    setHeaderVisibility({ docked: scrollTop > 24, hidden: false });
  }, [clearHideTimer, setHeaderVisibility]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const applyPreference = () => {
      reduceMotionRef.current = media.matches;
      if (media.matches) revealHeader();
    };

    applyPreference();
    media.addEventListener('change', applyPreference);
    return () => media.removeEventListener('change', applyPreference);
  }, [revealHeader]);

  useEffect(() => {
    clearHideTimer();
    lastScrollTopRef.current = 0;
    const mainEl = mainRef.current;
    if (mainEl) {
      if (typeof mainEl.scrollTo === 'function') {
        mainEl.scrollTo({ top: 0 });
      } else {
        mainEl.scrollTop = 0;
      }
    }
    setHeaderVisibility({ docked: false, hidden: false });
  }, [clearHideTimer, location.pathname, setHeaderVisibility]);

  useEffect(() => {
    const handleIntentToReveal = (event: PointerEvent | TouchEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === 'Tab') revealHeader();
        return;
      }

      let topEdge: number | undefined;
      if (typeof TouchEvent !== 'undefined' && event instanceof TouchEvent) {
        topEdge = event.touches[0]?.clientY;
      } else if ('clientY' in event) {
        topEdge = event.clientY;
      }

      if (typeof topEdge === 'number' && topEdge <= 56) {
        revealHeader();
      }
    };

    window.addEventListener('pointermove', handleIntentToReveal, { passive: true });
    window.addEventListener('touchstart', handleIntentToReveal, { passive: true });
    window.addEventListener('keydown', handleIntentToReveal);
    return () => {
      window.removeEventListener('pointermove', handleIntentToReveal);
      window.removeEventListener('touchstart', handleIntentToReveal);
      window.removeEventListener('keydown', handleIntentToReveal);
    };
  }, [revealHeader]);

  const handleMainScroll = useCallback((event: React.UIEvent<HTMLElement>) => {
    const scrollTop = event.currentTarget.scrollTop;
    const lastScrollTop = lastScrollTopRef.current;
    const docked = scrollTop > 24;
    const scrollingDown = scrollTop > lastScrollTop + 4;
    const scrollingUp = scrollTop < lastScrollTop - 4;

    lastScrollTopRef.current = scrollTop;

    if (reduceMotionRef.current || scrollTop <= 96 || scrollingUp) {
      clearHideTimer();
      setHeaderVisibility({ docked, hidden: false });
      return;
    }

    if (scrollingDown) {
      setHeaderVisibility({ docked: true, hidden: headerState.hidden });
      if (!headerState.hidden && !hideTimerRef.current) {
        hideTimerRef.current = window.setTimeout(() => {
          hideTimerRef.current = null;
          if (!reduceMotionRef.current && lastScrollTopRef.current > 96) {
            setHeaderVisibility({ docked: true, hidden: true });
          }
        }, 600);
      }
      return;
    }

    setHeaderVisibility({ docked, hidden: headerState.hidden });
  }, [clearHideTimer, headerState.hidden, setHeaderVisibility]);

  const handleSignOut = async () => {
    try {
      const { error } = await signOut();
      if (error) throw error;

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

  if (loading || (user && role === null)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="glass-panel p-8 rounded-2xl">
          <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  // Block access if user has no admin role
  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="glass-panel p-8 rounded-2xl text-center space-y-4 max-w-md">
          <ShieldAlert className="w-12 h-12 text-destructive mx-auto" />
          <h2 className="text-xl font-display font-semibold text-glass-foreground">Access Denied</h2>
          <p className="text-muted-foreground text-sm">
            Your account does not have admin access. Contact your administrator to request access.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-svh min-h-svh w-full overflow-hidden bg-background">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header
          className={cn(
            'fixed inset-x-0 top-0 z-50 flex justify-center px-3 py-2 transition-transform duration-300 ease-out motion-reduce:transform-none motion-reduce:transition-none sm:px-5',
            headerState.hidden ? '-translate-y-[calc(100%+0.75rem)]' : 'translate-y-0'
          )}
          onFocusCapture={revealHeader}
        >
          <div
            className={cn(
              'grid min-h-12 w-full max-w-[96rem] grid-cols-[auto_1fr_auto] items-center gap-2 border transition-all duration-300 ease-out motion-reduce:transition-none sm:gap-3',
              headerState.docked
                ? 'rounded-lg border-glass-border/70 bg-background/80 px-2 py-2 shadow-[0_18px_55px_rgba(0,0,0,0.28)] backdrop-blur-glass-lg sm:px-3'
                : 'rounded-lg border-glass-border/30 bg-background/50 px-2 py-2 shadow-none backdrop-blur-glass sm:px-3'
            )}
          >
            <div className="flex min-w-0 items-center gap-2">
              <BrandLogo compact className="h-8 w-8 shrink-0 rounded-lg ring-1 ring-glass-border/70" />
              <div className="min-w-0">
                <div className="text-sm font-display font-semibold leading-tight text-glass-foreground">
                  XOT
                </div>
                <div className="truncate text-[11px] uppercase leading-tight tracking-[0.14em] text-muted-foreground">
                  {activeItem.title}
                </div>
              </div>
            </div>

            <nav aria-label="Primary navigation" className="hidden min-w-0 justify-center md:flex">
              <div className="flex min-w-0 items-center gap-1 rounded-md border border-glass-border/40 bg-background/32 px-1 py-1 backdrop-blur-glass">
                {navigationItems.map((item) => (
                  <NavLink
                    key={item.title}
                    to={item.url}
                    end
                    aria-label={item.title}
                    title={item.title}
                    className={({ isActive }) =>
                      cn(
                        'inline-flex h-8 min-w-8 items-center justify-center gap-2 rounded px-2 text-xs font-mono font-medium text-muted-foreground transition-colors hover:bg-glass-border/20 hover:text-glass-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 lg:px-3',
                        isActive && 'bg-primary/15 text-primary'
                      )
                    }
                  >
                    <item.icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="hidden lg:inline">{item.title}</span>
                  </NavLink>
                ))}
              </div>
            </nav>

            <div className="flex min-w-0 items-center justify-end gap-2">
              <div className="hidden min-w-0 xl:flex">
                <VersionBanner />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleSignOut}
                className="h-9 shrink-0 rounded-md px-2 text-muted-foreground hover:bg-destructive/15 hover:text-destructive sm:px-3"
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4" />
                <span className="ml-2 hidden lg:inline">Sign out</span>
              </Button>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main
          ref={mainRef}
          className="flex-1 overflow-auto overflow-x-hidden px-2 pb-24 pt-20 sm:px-5 sm:pb-6 sm:pt-[5.5rem]"
          onScroll={handleMainScroll}
        >
          <div className={`mx-auto w-full ${isWideOpsRoute ? 'max-w-none' : 'max-w-7xl'}`}>
            {children}
          </div>
        </main>
      </div>
      <MobileBottomNav />
    </div>
  );
}

function MobileBottomNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-glass-border bg-background/95 px-1.5 pb-[max(env(safe-area-inset-bottom),0.35rem)] pt-1.5 backdrop-blur-glass md:hidden">
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${navigationItems.length}, minmax(0, 1fr))` }}>
        {navigationItems.map((item) => (
          <NavLink
            key={item.title}
            to={item.url}
            end
            className={({ isActive }) =>
              `flex min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-1 py-1.5 text-[10px] leading-none transition-colors ${
                isActive
                  ? 'bg-primary/20 text-primary'
                  : 'text-muted-foreground hover:bg-glass-border/20 hover:text-glass-foreground'
              }`
            }
          >
            <item.icon className="h-4 w-4 shrink-0" />
            <span className="w-full truncate text-center">{item.title}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
