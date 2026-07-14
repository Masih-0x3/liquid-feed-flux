import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import {
  requireInternalAuth,
  serviceRoleBearerHeader,
} from "../_shared/internalAuth.ts";
import { captureEdgeException, initSentryEdge } from "../_shared/sentry.ts";
import { createDbCleanupHandler } from "./handler.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_CORS_ORIGIN") ??
    "https://liquid-feed-flux.lovable.app",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-internal-token",
};
initSentryEdge();

const handler = createDbCleanupHandler({
  corsHeaders,
  createSupabase: () =>
    createClient<any, any>(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    ),
  requireInternalAuth,
  serviceRoleBearerHeader,
  getEnv: (name) => Deno.env.get(name),
  captureException: captureEdgeException,
});

serve(handler);
