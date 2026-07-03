import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  CircleDashed,
  Clock3,
  CloudOff,
  GitBranch,
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toneClass } from "@/lib/monitoringViewModel";
import type {
  ProcessTraceEdge,
  ProcessTraceMap,
  ProcessTraceNode,
  ProcessTraceNodeId,
  ProcessTraceStatus,
  ProcessTraceTone,
} from "@/lib/processTraceMap";

interface MonitoringProcessTraceMapProps {
  traceMap: ProcessTraceMap;
}

const LANES: Array<{ label: string; ids: ProcessTraceNodeId[] }> = [
  { label: "Intake and AI", ids: ["ingest", "dedupe", "score", "translate", "enrich", "media"] },
  { label: "Delivery", ids: ["telegram", "x-dispatch", "x-post"] },
  { label: "Observability", ids: ["trace-export"] },
];

function compactNumber(value: number | null | undefined): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value ?? 0);
}

function formatDuration(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (value < 1000) return `${Math.round(value)}ms`;
  const seconds = value / 1000;
  return `${seconds.toFixed(seconds >= 10 ? 0 : 1)}s`;
}

function connectorClass(tone: ProcessTraceTone): string {
  if (tone === "good") return "bg-emerald-500/60";
  if (tone === "bad") return "bg-destructive/70";
  if (tone === "warn") return "bg-amber-500/70";
  if (tone === "info") return "bg-blue-500/70";
  return "bg-border";
}

function nodeBorderClass(tone: ProcessTraceTone): string {
  if (tone === "good") return "border-emerald-500/35 bg-emerald-500/[0.04]";
  if (tone === "bad") return "border-destructive/40 bg-destructive/[0.05]";
  if (tone === "warn") return "border-amber-500/40 bg-amber-500/[0.05]";
  if (tone === "info") return "border-blue-500/40 bg-blue-500/[0.05]";
  return "border-border bg-muted/20";
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
  const className = "h-4 w-4";
  if (node.id === "dedupe") return <ShieldCheck className={className} />;
  if (node.id === "score") return <Zap className={className} />;
  if (node.id === "translate") return <Languages className={className} />;
  if (node.id === "enrich") return <Bot className={className} />;
  if (node.id === "media") return <UploadCloud className={className} />;
  if (node.id === "telegram") return <MessageCircle className={className} />;
  if (node.id === "x-dispatch") return <GitBranch className={className} />;
  if (node.id === "x-post") return <Twitter className={className} />;
  if (node.id === "trace-export") return <Activity className={className} />;
  return <Workflow className={className} />;
}

function TraceConnector({ edge }: { edge?: ProcessTraceEdge }) {
  const active = edge ? isActive(edge.status) : false;
  return (
    <div className="hidden min-w-8 flex-1 items-center md:flex" aria-hidden="true">
      <span
        className={`h-0.5 flex-1 rounded-full ${connectorClass(edge?.tone ?? "muted")} ${
          active ? "animate-pulse motion-reduce:animate-none" : ""
        }`}
      />
    </div>
  );
}

function TraceNodeCard({ node }: { node: ProcessTraceNode }) {
  const duration = formatDuration(node.durationMs);
  const meta = [
    node.agentName,
    node.model,
    node.endpoint,
    node.tokens != null ? `${compactNumber(node.tokens)} tokens` : null,
    duration,
  ].filter(Boolean);

  return (
    <div
      className={`relative min-h-[8.5rem] min-w-[9rem] rounded-md border p-2.5 text-left shadow-sm ${nodeBorderClass(node.tone)} ${
        isActive(node.status) ? "ring-1 ring-blue-500/25" : ""
      }`}
      data-testid={`process-trace-node-${node.id}`}
      aria-label={`${node.label}: ${node.statusLabel}. ${node.detail}`}
    >
      {isActive(node.status) && (
        <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-blue-500 animate-ping motion-reduce:animate-none" aria-hidden="true" />
      )}
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border ${toneClass(node.tone)}`}>
            <NodeIcon node={node} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium" title={node.label}>{node.shortLabel}</p>
            <p className="truncate text-[11px] text-muted-foreground" title={node.kind}>{node.kind}</p>
          </div>
        </div>
        <Badge className={`${toneClass(node.tone)} shrink-0 gap-1 text-[11px]`}>
          <StatusIcon status={node.status} />
          {node.statusLabel}
        </Badge>
      </div>
      <p className="line-clamp-2 min-h-[2.5rem] text-xs leading-5 text-muted-foreground" title={node.detail}>
        {node.detail}
      </p>
      {meta.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {meta.slice(0, 4).map((item) => (
            <Badge key={item} variant="outline" className="max-w-full truncate text-[11px]">
              {item}
            </Badge>
          ))}
        </div>
      )}
      {node.error && <p className="mt-2 line-clamp-2 text-[11px] text-destructive">{node.error}</p>}
      {node.skipReason && !node.error && <p className="mt-2 line-clamp-1 text-[11px] text-muted-foreground">{node.skipReason.replaceAll("_", " ")}</p>}
    </div>
  );
}

function TraceLane({
  label,
  nodes,
  edges,
}: {
  label: string;
  nodes: ProcessTraceNode[];
  edges: ProcessTraceEdge[];
}) {
  if (nodes.length === 0) return null;
  const edgeByTarget = new Map(edges.map((edge) => [edge.to, edge]));

  return (
    <div className="space-y-2" role="group" aria-label={`${label} process lane`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
        <Badge variant="outline" className="text-[11px]">{nodes.length} stages</Badge>
      </div>
      <div className="overflow-x-auto pb-1">
        <div className="flex min-w-max items-stretch gap-2 md:min-w-0">
          {nodes.map((node, index) => (
            <div key={node.id} className="flex min-w-max items-center gap-2 md:min-w-0 md:flex-1">
              <TraceNodeCard node={node} />
              {index < nodes.length - 1 && <TraceConnector edge={edgeByTarget.get(nodes[index + 1].id)} />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function MonitoringProcessTraceMap({ traceMap }: MonitoringProcessTraceMapProps) {
  const nodeById = new Map(traceMap.nodes.map((node) => [node.id, node]));

  return (
    <Card data-testid="process-trace-map">
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-2">
            <Workflow className="h-4 w-4" />
            Process trace map
          </span>
          <Badge className={`${toneClass(traceMap.summary.status === "blocked" ? "warn" : traceMap.summary.status === "running" ? "info" : traceMap.summary.status === "failed" ? "bad" : traceMap.summary.status === "completed" ? "good" : "muted")} gap-1`}>
            <StatusIcon status={traceMap.summary.status} />
            {traceMap.summary.statusLabel}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="grid gap-2 sm:grid-cols-4">
          <div className="rounded-md border p-2">
            <p className="text-xs text-muted-foreground">Stages</p>
            <p className="font-medium">{traceMap.summary.completed}/{traceMap.summary.totalNodes} complete</p>
          </div>
          <div className="rounded-md border p-2">
            <p className="text-xs text-muted-foreground">AI calls</p>
            <p className="font-medium">{compactNumber(traceMap.summary.aiCalls)}</p>
          </div>
          <div className="rounded-md border p-2">
            <p className="text-xs text-muted-foreground">Tokens</p>
            <p className="font-medium">{compactNumber(traceMap.summary.tokens)}</p>
          </div>
          <div className="rounded-md border p-2">
            <p className="text-xs text-muted-foreground">Trace export</p>
            <p className="font-medium">
              {traceMap.summary.hostedExports > 0
                ? `${compactNumber(traceMap.summary.hostedExports)} hosted`
                : `${compactNumber(traceMap.summary.localOnly)} local only`}
            </p>
          </div>
        </div>

        {(traceMap.summary.workflowName || traceMap.summary.workflowRunId) && (
          <div className="rounded-md border bg-muted/20 p-2 text-xs">
            <div className="grid gap-1 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-2">
              <span className="font-medium text-muted-foreground">Workflow</span>
              <span className="truncate" title={traceMap.summary.workflowName ?? undefined}>{traceMap.summary.workflowName ?? "unknown"}</span>
              <span className="font-medium text-muted-foreground">Run</span>
              <span className="truncate" title={traceMap.summary.workflowRunId ?? undefined}>{traceMap.summary.workflowRunId ?? "unknown"}</span>
            </div>
          </div>
        )}

        <div className="space-y-4">
          {LANES.map((lane) => (
            <TraceLane
              key={lane.label}
              label={lane.label}
              nodes={lane.ids.map((id) => nodeById.get(id)).filter((node): node is ProcessTraceNode => Boolean(node))}
              edges={traceMap.edges}
            />
          ))}
        </div>

        {traceMap.partialReasons.length > 0 && (
          <div className="rounded-md border bg-muted/20 p-2 text-xs">
            <div className="mb-1 flex items-center gap-2 font-medium">
              <Timer className="h-3.5 w-3.5" />
              Trace notes
            </div>
            <p className="text-muted-foreground">{traceMap.partialReasons.slice(0, 4).join(" · ")}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
