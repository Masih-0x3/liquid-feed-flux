import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { execSync } from "child_process";
import { componentTagger } from "lovable-tagger";

function gitSha(): string {
  try { return execSync('git rev-parse --short HEAD').toString().trim(); }
  catch { return 'unknown'; }
}

const manualChunkGroups: Record<string, string[]> = {
  'vendor-react': ['react', 'react-dom', 'react-router-dom'],
  'vendor-radix': [
    '@radix-ui/react-dialog',
    '@radix-ui/react-dropdown-menu',
    '@radix-ui/react-tabs',
    '@radix-ui/react-select',
    '@radix-ui/react-popover',
    '@radix-ui/react-tooltip',
  ],
  'vendor-charts': ['recharts'],
  'vendor-supabase': ['@supabase/supabase-js'],
  'vendor-query': ['@tanstack/react-query'],
};

function manualChunks(id: string): string | undefined {
  if (!id.includes('/node_modules/')) return undefined;
  for (const [chunkName, packages] of Object.entries(manualChunkGroups)) {
    if (packages.some((pkg) => id.includes(`/node_modules/${pkg}/`))) {
      return chunkName;
    }
  }
  return undefined;
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  define: {
    __APP_VERSION_SHA__: JSON.stringify(gitSha()),
    __APP_VERSION_TIME__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    mode === 'development' &&
    componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    modulePreload: {
      resolveDependencies: (_filename, deps) => deps.filter((dep) => !dep.includes('vendor-charts')),
    },
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
}));
