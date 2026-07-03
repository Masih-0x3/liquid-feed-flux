import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  CircleDashed,
  Clock3,
  CloudOff,
  ChevronRight,
  Languages,
  MessageCircle,
  ShieldCheck,
  Timer,
  Twitter,
  UploadCloud,
  Workflow,
  Zap,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { toneClass } from "@/lib/monitoringViewModel";
import type {
  ProcessTraceMap,
  ProcessTraceNode,
  ProcessTraceStatus,
  ProcessTraceTone,
} from "@/lib/processTraceMap";

interface MonitoringProcessTraceMapProps {
  traceMap: ProcessTraceMap;
}

function compactNumber(value: number | null | undefined): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value ?? 0);
}

function formatDuration(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (value < 1000) return `${Math.round(value)}ms`;
  const seconds = value / 1000;
  return `${seconds.toFixed(seconds >= 10 ? 0 : 1)}s`;
}

function progressPercent(traceMap: ProcessTraceMap): number {
  if (traceMap.summary.totalNodes <= 0) return 0;
  return Math.max(6, Math.round((traceMap.summary.completed / traceMap.summary.totalNodes) * 100));
}

function dotClass(tone: ProcessTraceTone): string {
  if (tone === "good") return "bg-emerald-500 ring-emerald-500/25";
  if (tone === "bad") return "bg-destructive ring-destructive/25";
  if (tone === "warn") return "bg-amber-500 ring-amber-500/25";
  if (tone === "info") return "bg-blue-500 ring-blue-500/25";
  return "bg-muted-foreground/35 ring-muted-foreground/10";
}

function isActive(status: ProcessTraceStatus): boolean {
  return status === "running" || status === "pending";
}

function StatusIcon({ status }: { status: ProcessTraceStatus }) {
  const className = "h-3.5 w-3.5";
  if (status === "completed") return <CheckCircle2 className={className} />;
  if (status === "failed") return <AlertTriangle className={className} />;
  if (status === "blocked") return <ShieldCheck className={className} />;
  if (status === "skipped") return <CloudOff className={className} />;
  if (status === "running" || status === "pending") return <Clock3 className={className} />;
  return <CircleDashed className={className} />;
}

function NodeIcon({ node }: { node: ProcessTraceNode }) {
  const className = "h-3.5 w-3.5";
  if (node.id === "dedupe") return <ShieldCheck className={className} />;
  if (node.id === "score") return <Zap className={className} />;
  if (node.id === "translate") return <Languages className={className} />;
  if (node.id === "enrich") return <Bot className={className} />;
  if (node.id === "media") return <UploadCloud className={className} />;
  if (node.id === "telegram") return <MessageCircle className={className} />;
  if (node.id === "x-dispatch") return <Workflow className={className} />;
  if (node.id === "x-post") return <Twitter className={className} />;
  if (node.id === "trace-export") return <Activity className={className} />;
  return <Workflow className={className} />;
}

function TraceRow({ node }: { node: ProcessTraceNode }) {
  const duration = formatDuration(node.durationMs);
  const subtitle = [node.agentName, node.model, node.aiCalls.length ? `${node.aiCalls.length} call${node.aiCalls.length === 1 ? "" : "s"}` : null]
    .filter(Boolean)
    .join(" · ");
  const value = node.tokens != null
    ? `${compactNumber(node.tokens)} tokens`
    : node.status === "unknown"
      ? "—"
      : node.statusLabel;
  const note = node.error ?? node.skipReason?.replaceAll("_", " ") ?? node.detail;
  const supportingText = subtitle || (node.error || node.skipReason ? node.detail : note);

  return (
    <div
      className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-border/70 px-3 py-2.5 first:border-t-0"
      data-testid={`process-trace-node-${node.id}`}
      aria-label={`${node.label}: ${node.statusLabel}. ${node.detail}`}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span className={`relative inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-background ring-4 ${dotClass(node.tone)}`}>
          {isActive(node.status) && (
            <span className="absolute inset-0 rounded-full animate-ping bg-current opacity-25 motion-reduce:animate-none" aria-hidden="true" />
          )}
          <span className="relative">
            <NodeIcon node={node} />
          </span>
        </span>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-sm font-semibold leading-5" title={node.label}>{node.label}</p>
            <Badge className={`${toneClass(node.tone)} shrink-0 gap-1 px-1.5 py-0 text-[10px] font-medium`}>
              <StatusIcon status={node.status} />
              {node.statusLabel}
            </Badge>
          </div>
          <p className="truncate text-xs text-muted-foreground" title={supportingText}>
            {supportingText}
          </p>
          {(node.error || node.skipReason) && (
            <p className={`mt-0.5 truncate text-[11px] ${node.error ? "text-destructive" : "text-muted-foreground"}`} title={note}>
              {note}
            </p>
          )}
        </div>
      </div>
      <div className="flex min-w-[4.25rem] items-center justify-end gap-2 text-right">
        <div className="text-xs leading-4">
          <p className="font-medium text-muted-foreground">{value}</p>
          {duration && <p className="text-[11px] text-muted-foreground/80">{duration}</p>}
        </div>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/55" aria-hidden="true" />
      </div>
    </div>
  );
}

function MiniTimeline({ traceMap }: { traceMap: ProcessTraceMap }) {
  const percent = progressPercent(traceMap);

  return (
    <div className="space-y-2 px-3 pb-2 pt-1" aria-label="Process progress timeline">
      <div className="relative h-6">
        <div className="absolute left-0 right-0 top-2.5 h-px bg-border" aria-hidden="true" />
        <div
          className="absolute left-0 top-2.5 h-1 rounded-full bg-primary motion-reduce:transition-none"
          style={{ width: `${percent}%` }}
          aria-hidden="true"
        />
        <div className="relative flex justify-between">
          {traceMap.nodes.map((node) => (
            <span
              key={node.id}
              className={`h-5 w-5 rounded-full border-2 border-card ring-2 ${dotClass(node.tone)} ${isActive(node.status) ? "animate-pulse motion-reduce:animate-none" : ""}`}
              title={`${node.shortLabel}: ${node.statusLabel}`}
              aria-hidden="true"
            />
          ))}
        </div>
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{traceMap.nodes[0]?.shortLabel ?? "start"}</span>
        <span>{traceMap.summary.completed}/{traceMap.summary.totalNodes}</span>
        <span>{traceMap.nodes.at(-1)?.shortLabel ?? "now"}</span>
      </div>
    </div>
  );
}

export function MonitoringProcessTraceMap({ traceMap }: MonitoringProcessTraceMapProps) {
  const traceExportText = traceMap.summary.hostedExports > 0
    ? `${compactNumber(traceMap.summary.hostedExports)} hosted`
    : `${compactNumber(traceMap.summary.localOnly)} local only`;

  return (
    <Card data-testid="process-trace-map" className="overflow-hidden border-border/80 bg-card/80 shadow-md">
      <div className="space-y-1 px-3 pb-2 pt-3">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-2">
            <Workflow className="h-4 w-4" />
            Process trace map
          </span>
          <Badge className={`${toneClass(traceMap.summary.status === "blocked" ? "warn" : traceMap.summary.status === "running" ? "info" : traceMap.summary.status === "failed" ? "bad" : traceMap.summary.status === "completed" ? "good" : "muted")} gap-1 px-2 py-0.5 text-[11px]`}>
            <StatusIcon status={traceMap.summary.status} />
            {traceMap.summary.statusLabel}
          </Badge>
        </CardTitle>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{traceMap.summary.completed}/{traceMap.summary.totalNodes} stages</span>
          <span>{compactNumber(traceMap.summary.aiCalls)} AI calls</span>
          <span>{compactNumber(traceMap.summary.tokens)} tokens</span>
          <span>{traceExportText}</span>
        </div>
        {(traceMap.summary.workflowName || traceMap.summary.workflowRunId) && (
          <div className="min-w-0 text-xs text-muted-foreground">
            <p className="truncate" title={traceMap.summary.workflowName ?? undefined}>{traceMap.summary.workflowName ?? "unknown workflow"}</p>
            <p className="truncate text-[11px]" title={traceMap.summary.workflowRunId ?? undefined}>{traceMap.summary.workflowRunId ?? "unknown run"}</p>
          </div>
        )}
      </div>
      <div className="p-0 text-sm">
        <MiniTimeline traceMap={traceMap} />

        <div className="max-h-[23rem] overflow-y-auto border-t border-border/70">
          {traceMap.nodes.map((node) => (
            <TraceRow key={node.id} node={node} />
          ))}
        </div>

        {traceMap.partialReasons.length > 0 && (
          <div className="border-t border-border/70 bg-muted/20 px-3 py-2 text-xs">
            <div className="mb-1 flex items-center gap-2 font-medium">
              <Timer className="h-3.5 w-3.5" />
              Trace notes
            </div>
            <p className="text-muted-foreground">{traceMap.partialReasons.slice(0, 4).join(" · ")}</p>
          </div>
        )}
      </div>
    </Card>
  );
}
