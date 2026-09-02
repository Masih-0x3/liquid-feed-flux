import { Toaster } from "@/components/ui/toaster";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { AppLayout } from "@/components/layout/AppLayout";
import { lazy, Suspense } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { supabaseConfigError, missingSupabaseEnv } from "@/integrations/supabase/client";
import { loadChunkWithRecovery } from "@/lib/chunkReloadRecovery";
import AuthPage from "./pages/AuthPage";
import NotFound from "./pages/NotFound";

// Wrap dynamic import to auto-recover from stale chunk errors after deploys/HMR.
// If a code-split chunk 404s (because the build hash changed), force one reload per build.
const chunkReloadBuildSha =
  typeof __APP_VERSION_SHA__ === "string" && __APP_VERSION_SHA__.trim()
    ? __APP_VERSION_SHA__
    : "unknown";
const chunkReloadRuntime = {
  buildSha: chunkReloadBuildSha,
  getStorage: () => sessionStorage,
  reload: () => window.location.reload(),
};

function lazyWithRetry<T extends React.ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>
) {
  return lazy(() => loadChunkWithRecovery(factory, chunkReloadRuntime));
}

// Lazy-loaded pages (Issue 39: route-level code splitting)
const Dashboard = lazyWithRetry(() => import("./pages/Dashboard"));
const Monitoring = lazyWithRetry(() => import("./pages/Monitoring"));
const VideoRenders = lazyWithRetry(() => import("./pages/VideoRenders"));
const Threads = lazyWithRetry(() => import("./pages/Threads"));
const Settings = lazyWithRetry(() => import("./pages/Settings"));
const XAccountDisabled = lazyWithRetry(() => import("./pages/XAccountDisabled"));
const Downloader = lazyWithRetry(() => import("./pages/Downloader"));
const FoglampHUDDev = import.meta.env.DEV && import.meta.env.VITE_FOGLAMP_HUD === "1"
  ? lazy(() => import("foglamp/hud").then((mod) => ({ default: mod.FoglampHUD })))
  : null;

const queryClient = new QueryClient();

function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );
}

function ConfigErrorScreen() {
  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
      <div className="glass-panel max-w-lg rounded-lg border border-destructive/40 p-6 shadow-lg">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-1 h-5 w-5 text-destructive" />
          <div className="space-y-3">
            <div>
              <h1 className="text-lg font-semibold">Deployment configuration is missing</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                XOT cannot connect to Supabase because the hosting environment is missing required Vite variables.
              </p>
            </div>
            <div className="rounded-md bg-muted p-3 text-sm">
              <div className="font-medium">Missing variables</div>
              <ul className="mt-2 list-disc pl-5 text-muted-foreground">
                {missingSupabaseEnv.map((name) => <li key={name}>{name}</li>)}
              </ul>
            </div>
            <p className="text-xs text-muted-foreground">
              Set these in Vercel Project Settings, then redeploy. Do not commit local .env files.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function FoglampHUDMount() {
  const location = useLocation();
  if (!FoglampHUDDev || location.pathname === "/monitoring") return null;

  return (
    <Suspense fallback={null}>
      <FoglampHUDDev redact defaultOpen={false} />
    </Suspense>
  );
}

const App = () => (
  supabaseConfigError ? <ConfigErrorScreen /> :
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <Toaster />
      <BrowserRouter>
        <FoglampHUDMount />
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/auth" element={<AuthPage />} />
            <Route element={<AppLayout />}>
              <Route index element={<Dashboard />} />
              <Route path="monitoring" element={<Monitoring />} />
              <Route path="video-renders" element={<VideoRenders />} />
              <Route path="threads" element={<Threads />} />
              <Route path="x-account" element={<XAccountDisabled />} />
              <Route path="downloader" element={<Downloader />} />
              <Route path="settings" element={<Settings />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
