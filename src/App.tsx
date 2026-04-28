import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { AppLayout } from "@/components/layout/AppLayout";
import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";
import AuthPage from "./pages/AuthPage";
import NotFound from "./pages/NotFound";

// Wrap dynamic import to auto-recover from stale chunk errors after deploys/HMR.
// If a code-split chunk 404s (because the build hash changed), force a one-time reload.
function lazyWithRetry<T extends React.ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>
) {
  return lazy(async () => {
    try {
      return await factory();
    } catch (err) {
      const reloadKey = "lovable_chunk_reloaded";
      if (!sessionStorage.getItem(reloadKey)) {
        sessionStorage.setItem(reloadKey, "1");
        window.location.reload();
        return new Promise<{ default: T }>(() => {});
      }
      throw err;
    }
  });
}

// Lazy-loaded pages (Issue 39: route-level code splitting)
const Dashboard = lazyWithRetry(() => import("./pages/Dashboard"));
const Monitoring = lazyWithRetry(() => import("./pages/Monitoring"));
const Threads = lazyWithRetry(() => import("./pages/Threads"));
const Settings = lazyWithRetry(() => import("./pages/Settings"));
const XAccount = lazyWithRetry(() => import("./pages/XAccount"));
const Downloader = lazyWithRetry(() => import("./pages/Downloader"));

const queryClient = new QueryClient();

function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/auth" element={<AuthPage />} />
              <Route path="/" element={<AppLayout><Dashboard /></AppLayout>} />
              <Route path="/monitoring" element={<AppLayout><Monitoring /></AppLayout>} />
              <Route path="/threads" element={<AppLayout><Threads /></AppLayout>} />
              <Route path="/x-account" element={<AppLayout><XAccount /></AppLayout>} />
              <Route path="/downloader" element={<AppLayout><Downloader /></AppLayout>} />
              <Route path="/settings" element={<AppLayout><Settings /></AppLayout>} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
