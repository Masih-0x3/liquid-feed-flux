import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from './AppSidebar';
import { VersionBanner } from './VersionBanner';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2, ShieldAlert } from 'lucide-react';

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const { user, loading, role, isAdmin } = useAuth();

  if (loading) {
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
  if (role !== null && !isAdmin) {
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
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header */}
          <header className="h-16 border-b border-glass-border glass-panel rounded-none flex items-center px-6 backdrop-blur-glass">
            <SidebarTrigger className="glass-button hover:bg-glass-border/20" />
            <div className="ml-4 flex-1">
              <h1 className="text-xl font-display font-semibold text-glass-foreground">
                XOT Panel
              </h1>
              <p className="text-sm text-muted-foreground">
                Monitor and manage your RSS → OpenAI → Telegram pipeline
              </p>
            </div>
            <VersionBanner />
          </header>

          {/* Main Content */}
          <main className="flex-1 overflow-auto p-6">
            <div className="max-w-7xl mx-auto">
              {children}
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
