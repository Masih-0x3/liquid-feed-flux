import { ReactNode, useEffect, useState } from 'react';
import { Navigate, NavLink, useLocation } from 'react-router-dom';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from './AppSidebar';
import { navigationItems } from './navigation';
import { VersionBanner } from './VersionBanner';
import { BrandLogo } from './BrandLogo';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const { user, loading, role, isAdmin } = useAuth();
  const location = useLocation();
  const [headerDocked, setHeaderDocked] = useState(false);
  const isWideOpsRoute = location.pathname.startsWith('/monitoring') || location.pathname.startsWith('/video-renders');
  const activeItem = navigationItems.find((item) =>
    item.url === '/' ? location.pathname === '/' : location.pathname.startsWith(item.url)
  ) ?? navigationItems[0];

  useEffect(() => {
    const updateHeaderState = () => {
      const nextDocked = window.scrollY > 24;
      setHeaderDocked((current) => current === nextDocked ? current : nextDocked);
    };

    updateHeaderState();
    window.addEventListener('scroll', updateHeaderState, { passive: true });
    return () => window.removeEventListener('scroll', updateHeaderState);
  }, [location.pathname]);

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
    <SidebarProvider defaultOpen>
      <div className="flex h-svh min-h-svh w-full overflow-hidden bg-background">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Header */}
          <header className="sticky top-0 z-30 flex shrink-0 justify-center px-3 py-2 sm:px-5">
            <div
              className={cn(
                'grid min-h-12 w-full max-w-[92rem] grid-cols-[auto_1fr_auto] items-center gap-3 border transition-all duration-300 ease-out motion-reduce:transition-none',
                headerDocked
                  ? 'rounded-none border-glass-border/70 bg-background/72 px-3 py-2 shadow-[0_18px_55px_rgba(0,0,0,0.28)] backdrop-blur-glass-lg'
                  : 'border-transparent bg-transparent px-0 py-1 shadow-none'
              )}
            >
              <div className="flex min-w-0 items-center gap-2">
                <SidebarTrigger className="glass-button h-9 w-9 shrink-0 px-0 py-0 hover:bg-glass-border/20" />
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

              <nav aria-label="Primary navigation" className="hidden min-w-0 justify-center xl:flex">
                <div
                  className={cn(
                    'flex items-center gap-1 border border-glass-border/40 bg-background/28 px-1 py-1 backdrop-blur-glass transition-all duration-300 motion-reduce:transition-none',
                    headerDocked ? 'rounded-none' : 'rounded-md'
                  )}
                >
                  {navigationItems.map((item) => (
                    <NavLink
                      key={item.title}
                      to={item.url}
                      end
                      className={({ isActive }) =>
                        cn(
                          'inline-flex h-8 items-center gap-2 px-3 text-xs font-mono font-medium text-muted-foreground transition-colors hover:bg-glass-border/20 hover:text-glass-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70',
                          headerDocked ? 'rounded-none' : 'rounded',
                          isActive && 'bg-primary/15 text-primary'
                        )
                      }
                    >
                      <item.icon className="h-3.5 w-3.5 shrink-0" />
                      <span>{item.title}</span>
                    </NavLink>
                  ))}
                </div>
              </nav>

              <div className="hidden min-w-0 justify-end sm:flex">
                <VersionBanner />
              </div>
            </div>
          </header>

          {/* Main Content */}
          <main
            className="flex-1 overflow-auto overflow-x-hidden px-2 py-3 pb-24 sm:p-6 md:pb-6"
            onScroll={(event) => {
              const nextDocked = event.currentTarget.scrollTop > 24 || window.scrollY > 24;
              setHeaderDocked((current) => current === nextDocked ? current : nextDocked);
            }}
          >
            <div className={`mx-auto w-full ${isWideOpsRoute ? 'max-w-none' : 'max-w-7xl'}`}>
              {children}
            </div>
          </main>
        </div>
        <MobileBottomNav />
      </div>
    </SidebarProvider>
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
