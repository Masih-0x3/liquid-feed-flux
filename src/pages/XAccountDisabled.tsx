import { Link } from "react-router-dom";
import { AlertTriangle, Settings, ShieldOff } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function XAccountDisabled() {
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-display font-semibold text-glass-foreground">My X is paused</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Follower and following snapshots are disabled to prevent expensive X owned-read usage.
        </p>
      </div>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-glass-foreground">
            <ShieldOff className="h-5 w-5 text-warning" />
            Owned reads disabled
          </CardTitle>
          <CardDescription>
            This page no longer loads follower tables or exposes snapshot controls. Historical My X data remains stored for future use.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border border-warning/40 bg-warning/10 p-4 text-sm text-warning-foreground">
            <div className="flex gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <p>
                Automatic and manual follower/following pulls are paused. RSS monitoring, scoring, Telegram delivery, X posting, media upload, and tweet hydration continue through their existing settings.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link to="/settings#x-automation">
                <Settings className="mr-2 h-4 w-4" />
                X automation settings
              </Link>
            </Button>
            <Button asChild variant="secondary">
              <Link to="/monitoring">Open Monitoring</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
