import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import path from "path";
import { execSync } from "child_process";

function gitSha(): string {
  if (process.env.VERCEL_GIT_COMMIT_SHA) {
    return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7);
  }
  try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
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
export default defineConfig(() => {
  const sentrySourceMapsEnabled = Boolean(process.env.SENTRY_AUTH_TOKEN);

  return {
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
      sentrySourceMapsEnabled
        ? sentryVitePlugin({
          org: "xot",
          project: "xot-web",
          authToken: process.env.SENTRY_AUTH_TOKEN,
          sourcemaps: {
            filesToDeleteAfterUpload: ["./dist/**/*.map"],
          },
        })
        : null,
    ].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        react: path.resolve(__dirname, "./node_modules/react"),
        "react-dom": path.resolve(__dirname, "./node_modules/react-dom"),
      },
      dedupe: ["react", "react-dom"],
    },
    optimizeDeps: {
      exclude: ["foglamp/hud"],
    },
    build: {
      sourcemap: sentrySourceMapsEnabled ? "hidden" : false,
      modulePreload: {
        resolveDependencies: (_filename, deps) => deps.filter((dep) => !dep.includes('vendor-charts')),
      },
      rollupOptions: {
        output: {
          manualChunks,
        },
      },
    },
  };
});
