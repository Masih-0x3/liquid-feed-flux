import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Code2,
  Hand,
  Layers,
  List,
  Search,
  Send,
  Sparkles,
  Twitter,
  Workflow,
  Zap,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MonitoringEntry } from "@/hooks/useMonitoringData";
import {
  buildProcessTraceMap,
  isProcessTraceRunning,
  isProcessTraceWaiting,
  processTraceTerminalStatus,
  type ProcessTraceMap,
  type ProcessTraceNode,
  type ProcessTraceStatus,
  type ProcessTraceTone,
} from "@/lib/processTraceMap";
import { shortText } from "@/lib/monitoringViewModel";

interface MonitoringProcessHudProps {
  entries: MonitoringEntry[];
  onOpenPost: (tweetId: string) => void | Promise<void>;
  isLoading?: boolean;
  error?: Error | null;
  emptyReason?: string | null;
  mode?: "dashboard" | "monitoring";
  maxEntries?: number;
  onRetry?: () => void;
}

interface MonitoringProcessTraceDetailProps {
  traceMap: ProcessTraceMap;
  title?: string;
  subtitle?: string;
  statusOverride?: ProcessTraceStatus;
  onBack?: () => void;
  onOpenPost?: () => void | Promise<void>;
}

type HudStatus = "run" | "err" | "";

interface HudTrace {
  id: string;
  entry: MonitoringEntry;
  traceMap: ProcessTraceMap;
  title: string;
  subtitle: string;
  status: ProcessTraceStatus;
  startedAt: number;
  endedAt: number | null;
  durationMs: number;
  tokens: number;
  model: string | null;
  toolCount: number;
  errorCount: number;
}

function compactNumber(value: number | null | undefined): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value ?? 0);
}

function formatDuration(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  if (value < 1000) return `${Math.round(value)}ms`;
  const seconds = value / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds >= 10 ? 0 : 1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
}

function statusToHud(status: ProcessTraceStatus): HudStatus {
  if (isProcessTraceRunning(status)) return "run";
  if (status === "failed") return "err";
  return "";
}

function isAnimatingStatus(status: ProcessTraceStatus): boolean {
  return isProcessTraceRunning(status);
}

function traceSortScore(trace: HudTrace): number {
  if (isProcessTraceRunning(trace.status)) return 5;
  if (trace.status === "failed") return 4;
  if (trace.status === "blocked") return 3;
  if (isProcessTraceWaiting(trace.status)) return 2;
  return 1;
}

function timestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function nodeStart(node: ProcessTraceNode): number | null {
  return timestamp(node.startedAt) ?? timestamp(node.endedAt);
}

function nodeEnd(node: ProcessTraceNode): number | null {
  return timestamp(node.endedAt) ?? timestamp(node.startedAt);
}

function traceDuration(trace: HudTrace): number {
  if (isProcessTraceRunning(trace.status)) {
    return Math.max(Date.now() - trace.startedAt, trace.durationMs, 1);
  }
  return Math.max(trace.durationMs, 1);
}

function latestTime(values: number[]): number | null {
  return values.length > 0 ? Math.max(...values) : null;
}

function traceColor(key: string, status: ProcessTraceStatus): string {
  if (status === "failed") return "#f43f5e";
  if (status === "blocked") return "#f97316";
  if (status === "running") return "#3b82f6";
  if (status === "pending") return "#64748b";
  if (status === "skipped") return "#475569";
  if (status === "unknown") return "#4b5563";
  const palette = ["#10b981", "#3b82f6", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4", "#14b8a6"];
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  }
  return palette[hash % palette.length];
}

function toneColor(tone: ProcessTraceTone, status: ProcessTraceStatus): string {
  if (status === "failed" || tone === "bad") return "#f43f5e";
  if (status === "blocked" || tone === "warn") return "#f97316";
  if (status === "completed" || tone === "good") return "#10b981";
  if (status === "pending") return "#64748b";
  if (status === "running" || tone === "info") return "#3b82f6";
  return "#4b5563";
}

function traceFromEntry(entry: MonitoringEntry): HudTrace {
  const traceMap = buildProcessTraceMap(entry, [], entry.process_observability);
  const nodeTimes = traceMap.nodes.flatMap((node) => [nodeStart(node), nodeEnd(node)]).filter((value): value is number => value != null);
  const latestRun = entry.process_observability?.latest_run ?? null;
  const startedAt = timestamp(latestRun?.started_at) ?? Math.min(...nodeTimes, timestamp(entry.created_at) ?? Date.now());
  const endedAt = timestamp(latestRun?.ended_at) ?? (traceMap.summary.status === "completed" ? latestTime(nodeTimes) : null);
  const nodeDuration = traceMap.nodes.reduce((sum, node) => sum + (node.durationMs ?? 0), 0);
  const runDuration = latestRun?.duration_seconds != null ? latestRun.duration_seconds * 1000 : null;
  const durationMs = runDuration ?? (endedAt ? Math.max(endedAt - startedAt, 1) : nodeDuration);
  const model = traceMap.nodes.find((node) => node.model)?.model ?? null;
  const title = entry.author_handle ? `@${entry.author_handle}` : entry.account_handle || entry.tweet_id;
  const toolCount = traceMap.nodes.filter((node) => node.status !== "unknown").length;
  const errorCount = traceMap.nodes.filter((node) => node.status === "failed").length;
  const status = processTraceTerminalStatus(entry, traceMap.summary, traceMap.nodes);

  return {
    id: entry.tweet_id,
    entry,
    traceMap,
    title,
    subtitle: entry.monitoring_state?.stage_label ?? entry.monitoring_state?.decision_label ?? shortText(entry),
    status,
    startedAt,
    endedAt,
    durationMs,
    tokens: traceMap.summary.tokens,
    model,
    toolCount,
    errorCount,
  };
}

function Diamond({ status }: { status: HudStatus }) {
  return (
    <span className={cn("xot-hud-diamond", status === "run" && "run", status === "err" && "err")} aria-hidden="true">
      {Array.from({ length: 8 }).map((_, index) => <span key={index} />)}
    </span>
  );
}

function AgentBadge({ label, status }: { label: string; status: ProcessTraceStatus }) {
  const color = traceColor(label, status);
  return (
    <span className="xot-hud-agent-badge" style={{ backgroundColor: color }} aria-hidden="true">
      {status === "failed" ? <AlertTriangle className="h-2 w-2" /> : <Zap className="h-2 w-2" />}
    </span>
  );
}

function ToolGlyph({ label, kind }: { label: string; kind?: ProcessTraceNode["kind"] }) {
  const value = label.toLowerCase();
  const className = "h-3.5 w-3.5";
  if (kind === "ai") return <Sparkles className={className} />;
  if (kind === "manual") return <Hand className={className} />;
  if (kind === "delivery" && value.includes("x")) return <Twitter className={className} />;
  if (kind === "delivery") return <Send className={className} />;
  if (value.includes("search") || value.includes("score")) return <Search className={className} />;
  if (value.includes("trace")) return <Code2 className={className} />;
  if (value.includes("duplicate") || value.includes("gate")) return <List className={className} />;
  return <Layers className={className} />;
}

function Timeline({ traces, selectedId, onSelect }: { traces: HudTrace[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const now = Date.now();
  const start = traces.length ? Math.min(...traces.map((trace) => trace.startedAt)) : now - 60_000;
  const end = Math.max(now, ...traces.map((trace) => trace.endedAt ?? now));
  const span = Math.max(end - start, 60_000);
  const ticks = [45_000, 30_000, 15_000, 0];

  if (traces.length === 0) return null;

  return (
    <div className="xot-hud-timeline" aria-label="Recent post process timeline">
      <div className="xot-hud-timeline-track">
        <span className="xot-hud-axis" />
        {ticks.map((ago) => {
          const left = Math.max(0, Math.min(100, ((now - ago - start) / span) * 100));
          return <span key={ago} className="xot-hud-gridline" style={{ left: `${left}%` }} />;
        })}
        {traces.slice(0, 16).map((trace) => {
          const left = Math.max(0, Math.min(100, ((trace.startedAt - start) / span) * 100));
          const width = Math.max(4, Math.min(100 - left, (traceDuration(trace) / span) * 100));
          const color = traceColor(trace.title, trace.status);
          return (
            <button
              key={trace.id}
              type="button"
              className={cn("xot-hud-timeline-bar", isAnimatingStatus(trace.status) && "run", selectedId === trace.id && "selected")}
              style={{ left: `${left}%`, width: `${width}%`, backgroundColor: color }}
              onClick={() => onSelect(trace.id)}
              title={`${trace.title} - ${formatDuration(traceDuration(trace))}`}
              aria-label={`Select ${trace.title}`}
            >
              {trace.errorCount > 0 ? <AlertTriangle className="h-3 w-3" /> : <Zap className="h-3 w-3" />}
            </button>
          );
        })}
      </div>
      <div className="xot-hud-timeline-labels">
        <span>45s</span>
        <span>30s</span>
        <span>15s</span>
        <span>now</span>
      </div>
    </div>
  );
}

function TraceList({
  traces,
  selectedId,
  onSelect,
}: {
  traces: HudTrace[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (traces.length === 0) {
    return (
      <div className="xot-hud-empty">
        <span className="xot-hud-listening"><span /><span /></span>
        <p>Listening for post runs...</p>
      </div>
    );
  }

  return (
    <div className="xot-hud-list" aria-label="Post process runs">
      {traces.map((trace) => (
        <button
          key={trace.id}
          type="button"
          className={cn("xot-hud-list-row", selectedId === trace.id && "selected")}
          onClick={() => onSelect(trace.id)}
        >
          <span className="xot-hud-list-main">
            <span className="xot-hud-list-name">
              <AgentBadge label={trace.title} status={trace.status} />
              <span>{trace.title}</span>
            </span>
            <span className="xot-hud-list-sub">
              <span className="truncate">{trace.model ?? trace.subtitle}</span>
              <span className="shrink-0">- {trace.toolCount} steps</span>
            </span>
          </span>
          {isAnimatingStatus(trace.status) ? (
            <Diamond status="run" />
          ) : trace.errorCount > 0 ? (
            <span className="xot-hud-error-count"><AlertTriangle className="h-3 w-3" />{trace.errorCount}</span>
          ) : null}
          <span className="xot-hud-list-meta">
            <span>{trace.tokens ? `${compactNumber(trace.tokens)} tok` : "-"}</span>
            <span>{formatDuration(traceDuration(trace))}</span>
          </span>
          <ChevronRight className="h-4 w-4 text-white/35" />
        </button>
      ))}
    </div>
  );
}

function NodeDetail({ node }: { node: ProcessTraceNode }) {
  const rows: Array<[string, ReactNode]> = [
    ["Status", node.statusLabel],
    ["Duration", formatDuration(node.durationMs)],
  ];
  if (node.agentName) rows.push(["Agent", node.agentName]);
  if (node.model) rows.push(["Model", node.model]);
  if (node.endpoint) rows.push(["Endpoint", node.endpoint]);
  if (node.tokens != null) rows.push(["Tokens", compactNumber(node.tokens)]);
  if (node.startedAt) rows.push(["Started", new Date(node.startedAt).toLocaleString()]);
  if (node.endedAt) rows.push(["Ended", new Date(node.endedAt).toLocaleString()]);

  return (
    <div className="xot-hud-row-detail-inner">
      <dl className="xot-hud-kv">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className={cn("xot-hud-io", node.error && "err")}>
        <span>{node.error ? "Error" : node.skipReason ? "Skip reason" : "Detail"}</span>
        <pre>{node.error ?? node.skipReason?.replace(/_/g, " ") ?? node.detail}</pre>
      </div>
      {node.evidence.length > 0 && (
        <div className="xot-hud-evidence">
          {node.evidence.slice(0, 6).map((item) => <span key={item}>{item.replace(/_/g, " ")}</span>)}
        </div>
      )}
    </div>
  );
}

function TraceWaterfall({
  traceMap,
}: {
  traceMap: ProcessTraceMap;
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const allTimes = traceMap.nodes.flatMap((node) => [nodeStart(node), nodeEnd(node)]).filter((value): value is number => value != null);
  const hasLiveNodes = traceMap.nodes.some((node) => isProcessTraceRunning(node.status));
  const traceStart = allTimes.length ? Math.min(...allTimes) : Date.now();
  const traceEnd = allTimes.length ? Math.max(...allTimes, hasLiveNodes ? Date.now() : 0) : Date.now() + traceMap.nodes.length * 1000;
  const traceSpan = Math.max(traceEnd - traceStart, traceMap.nodes.length * 1000, 1);

  const toggle = (id: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="xot-hud-tree" aria-label="Post step detail">
      {traceMap.nodes.map((node, index) => {
        const isOpen = open.has(node.id);
        const explicitStart = nodeStart(node);
        const explicitEnd = nodeEnd(node);
        const fallbackLeft = (index / Math.max(traceMap.nodes.length, 1)) * 82;
        const left = explicitStart == null ? fallbackLeft : Math.max(0, Math.min(96, ((explicitStart - traceStart) / traceSpan) * 100));
        const width = Math.max(5, Math.min(100 - left, node.durationMs != null ? (node.durationMs / traceSpan) * 100 : explicitStart && explicitEnd ? ((explicitEnd - explicitStart) / traceSpan) * 100 : 11));
        const color = toneColor(node.tone, node.status);
        return (
          <div key={node.id} className="xot-hud-row-item">
            <button
              type="button"
              data-testid={`process-trace-node-${node.id}`}
              className={cn("xot-hud-row", node.status === "failed" && "err", isOpen && "open")}
              onClick={() => toggle(node.id)}
              aria-expanded={isOpen}
              aria-label={`${node.label}: ${node.statusLabel}. ${node.detail}`}
            >
              <span className={cn("xot-hud-wf-label", node.kind === "ai" && "ai", node.kind === "manual" && "manual")}>
                <span className={cn("xot-hud-wf-icon", node.status === "failed" && "err")}>
                  {node.status === "failed" ? <AlertTriangle className="h-3.5 w-3.5" /> : <ToolGlyph label={node.label} kind={node.kind} />}
                </span>
                <b>{node.shortLabel}</b>
                <span className="xot-hud-leader" aria-hidden="true" />
              </span>
              <span className="xot-hud-wf-track">
                <span
                  className={cn("xot-hud-wf-bar", isAnimatingStatus(node.status) && "run")}
                  style={{ left: `${left}%`, width: `${width}%`, backgroundColor: color } as CSSProperties}
                />
              </span>
              <span className="xot-hud-wf-duration">{formatDuration(node.durationMs)}</span>
              <ChevronDown className={cn("xot-hud-caret", isOpen && "open")} />
            </button>
            <div className={cn("xot-hud-row-detail", isOpen && "open")}>
              <NodeDetail node={node} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function MonitoringProcessTraceDetail({
  traceMap,
  title = traceMap.summary.workflowName ?? "Post process",
  subtitle = traceMap.summary.workflowRunId ?? "XOT-owned process ledger",
  statusOverride,
  onBack,
  onOpenPost,
}: MonitoringProcessTraceDetailProps) {
  const effectiveStatus = statusOverride ?? traceMap.summary.status;
  const status = statusToHud(effectiveStatus);
  const model = traceMap.nodes.find((node) => node.model)?.model ?? "XOT pipeline";
  const stepCount = traceMap.nodes.length;
  const traceExportText = traceMap.summary.hostedExports > 0
    ? `${compactNumber(traceMap.summary.hostedExports)} hosted`
    : `${compactNumber(traceMap.summary.localOnly)} local only`;

  return (
    <div className="xot-hud-detail" data-testid="process-trace-map">
      <span className="sr-only">Process trace map</span>
      <span className="sr-only">{compactNumber(traceMap.summary.tokens)} tokens</span>
      <div className="xot-hud-detail-header">
        {onBack && (
          <button type="button" className="xot-hud-icon-btn" onClick={onBack} aria-label="Back to post runs">
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <div className="xot-hud-title-line">
            <AgentBadge label={title} status={effectiveStatus} />
            <b>{title}</b>
          </div>
          <p><span>{model}</span><span> - </span><span>{subtitle}</span></p>
        </div>
        <Diamond status={status} />
        {onOpenPost && (
          <Button size="sm" variant="outline" className="h-8 border-white/15 bg-white/5 px-2 text-xs hover:bg-white/10" onClick={onOpenPost}>
            Full post
          </Button>
        )}
      </div>

      <div className="xot-hud-armory">
        {traceMap.nodes.map((node) => (
          <span
            key={node.id}
            className={cn("xot-hud-chip", `status-${node.status}`)}
            title={`${node.label}: ${node.statusLabel}`}
          >
            <ToolGlyph label={node.label} kind={node.kind} />
            <span>{node.shortLabel}</span>
            <span className="xot-hud-chip-status">{node.statusLabel}</span>
          </span>
        ))}
      </div>

      <TraceWaterfall traceMap={traceMap} />

      {traceMap.partialReasons.length > 0 && (
        <div className="xot-hud-notes">
          <b>Trace notes</b>
          <p>{traceMap.partialReasons.slice(0, 4).join(" - ")}</p>
        </div>
      )}

      <div className="xot-hud-footer">
        <span className="xot-hud-stat tokens"><b>{compactNumber(traceMap.summary.tokens)}</b><small><CircleDot />tokens</small></span>
        <span className="xot-hud-stat cost"><b>{compactNumber(traceMap.summary.aiCalls)}</b><small><CircleDot />AI calls</small></span>
        <span className="xot-hud-stat done"><b>{traceMap.summary.completed}/{stepCount}</b><small><CircleDot />done</small></span>
        <span className="xot-hud-stat export"><b>{traceExportText}</b><small><CircleDot />trace export</small></span>
        {traceMap.summary.failed > 0 && <span className="xot-hud-stat err"><b>{traceMap.summary.failed}</b><small><AlertTriangle />errors</small></span>}
      </div>
    </div>
  );
}

export function MonitoringProcessHud({
  entries,
  onOpenPost,
  isLoading = false,
  error = null,
  emptyReason = null,
  mode = "monitoring",
  maxEntries = 30,
  onRetry,
}: MonitoringProcessHudProps) {
  const traces = useMemo(() => (
    entries
      .map(traceFromEntry)
      .sort((a, b) => traceSortScore(b) - traceSortScore(a) || b.startedAt - a.startedAt)
      .slice(0, maxEntries)
  ), [entries, maxEntries]);
  const autoSelectedId = traces.find((trace) => isProcessTraceRunning(trace.status))?.id ?? traces[0]?.id ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(autoSelectedId);
  const [manualSelection, setManualSelection] = useState(false);

  useEffect(() => {
    if (!traces.some((trace) => trace.id === selectedId)) {
      setSelectedId(autoSelectedId);
      setManualSelection(false);
      return;
    }
    if (!manualSelection) setSelectedId(autoSelectedId);
  }, [autoSelectedId, manualSelection, selectedId, traces]);

  const selected = traces.find((trace) => trace.id === selectedId) ?? traces[0] ?? null;
  const animating = traces.some((trace) => isAnimatingStatus(trace.status));
  const hasFailures = traces.some((trace) => trace.status === "failed");
  const hasWaiting = traces.some((trace) => trace.status === "pending" || trace.status === "blocked");
  const status = animating ? "run" : hasFailures ? "err" : "";
  const subtitle = traces.length > 0
    ? `${traces.length} loaded - ${animating ? "live follow" : hasFailures ? "needs review" : hasWaiting ? "waiting/manual" : "latest complete"}`
    : isLoading
      ? "loading post runs"
      : error
        ? "process feed unavailable"
        : emptyReason ?? "waiting for posts";

  const select = (id: string) => {
    setSelectedId(id);
    setManualSelection(true);
  };

  return (
    <section
      className={cn("xot-hud-shell", mode === "dashboard" && "dashboard")}
      data-testid="monitoring-process-hud"
      aria-label="XOT post process HUD"
    >
      <div className="xot-hud-header">
        <div className="xot-hud-heading">
          <Workflow className="h-4 w-4" />
          <div>
            <b>Post process HUD</b>
            <span>{subtitle}</span>
          </div>
        </div>
        <div className="xot-hud-header-actions">
          <Diamond status={status} />
          <button
            type="button"
            className="xot-hud-reset"
            disabled={traces.length === 0}
            onClick={() => {
              setSelectedId(autoSelectedId);
              setManualSelection(false);
            }}
          >
            Follow latest
          </button>
          {onRetry && (
            <button type="button" className="xot-hud-reset" onClick={onRetry}>
              Retry
            </button>
          )}
        </div>
      </div>

      <Timeline traces={traces} selectedId={selected?.id ?? null} onSelect={select} />

      <div className="xot-hud-body">
        <TraceList traces={traces} selectedId={selected?.id ?? null} onSelect={select} />
        {selected ? (
          <MonitoringProcessTraceDetail
            traceMap={selected.traceMap}
            title={selected.title}
            subtitle={selected.entry.tweet_id}
            statusOverride={selected.status}
            onOpenPost={() => onOpenPost(selected.id)}
          />
        ) : (
          <div className="xot-hud-detail">
            <div className="xot-hud-empty">
              <span className="xot-hud-listening"><span /><span /></span>
              <p>{isLoading ? "Loading post processes..." : error ? error.message : emptyReason ?? "Waiting for a new post process."}</p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
