import { ReactNode } from 'react';
import { Navigate, NavLink, useLocation } from 'react-router-dom';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from './AppSidebar';
import { navigationItems } from './navigation';
import { VersionBanner } from './VersionBanner';
import { BrandLogo } from './BrandLogo';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2, ShieldAlert } from 'lucide-react';

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const { user, loading, role, isAdmin } = useAuth();
  const location = useLocation();
  const isWideOpsRoute = location.pathname.startsWith('/monitoring');

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
      <div className="flex min-h-svh w-full bg-background">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Header */}
          <header className="sticky top-0 z-30 min-h-16 border-b border-glass-border glass-panel rounded-none flex flex-wrap items-center gap-3 px-3 py-2 sm:px-6 md:flex-nowrap backdrop-blur-glass">
            <SidebarTrigger className="glass-button h-10 w-10 shrink-0 hover:bg-glass-border/20" />
            <BrandLogo compact className="hidden h-9 w-9 shrink-0 ring-1 ring-glass-border sm:block" />
            <div className="min-w-0 flex-1">
              <h1 className="text-lg sm:text-xl font-display font-semibold text-glass-foreground">
                XOT Panel
              </h1>
              <p className="hidden sm:block text-sm text-muted-foreground truncate">
                Monitor and manage your RSS → OpenAI → Telegram pipeline
              </p>
            </div>
            <div className="w-full sm:w-auto">
              <VersionBanner />
            </div>
          </header>

          {/* Main Content */}
          <main className="flex-1 overflow-auto overflow-x-hidden px-2 py-3 pb-24 sm:p-6 md:pb-6">
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
      <div className="grid grid-cols-6 gap-1">
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
