import { MonitoringProcessTraceDetail } from "@/components/monitoring/MonitoringProcessHud";
import type { ProcessTraceMap } from "@/lib/processTraceMap";

interface MonitoringProcessTraceMapProps {
  traceMap: ProcessTraceMap;
}

export function MonitoringProcessTraceMap({ traceMap }: MonitoringProcessTraceMapProps) {
  return (
    <MonitoringProcessTraceDetail
      traceMap={traceMap}
      title={traceMap.summary.workflowName ?? "Post process"}
      subtitle={traceMap.summary.workflowRunId ?? "XOT-owned process ledger"}
    />
  );
}
