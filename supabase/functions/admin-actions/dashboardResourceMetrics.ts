export function estimateMonthlyRuns(schedule: unknown): number {
  const value = String(schedule ?? "").trim();
  if (value === "* * * * *") return 43_200;
  if (value === "*/2 * * * *") return 21_600;
  if (value === "*/10 * * * *") return 4_320;
  if (/^0 \*\/6 \* \* \*$/.test(value)) return 120;
  if (/^0 \d+ \* \* \*$/.test(value)) return 30;
  if (/^0 \d+ \* \* [0-6]$/.test(value)) return 4;
  return 30;
}

export function cronCadenceSeconds(schedule: unknown): number | null {
  const value = String(schedule ?? "").trim();
  if (value === "* * * * *") return 60;
  if (value === "*/2 * * * *") return 120;
  if (value === "*/10 * * * *") return 600;
  const everySeconds = value.match(/^\*\/(\d+) \* \* \* \* \*$/);
  if (everySeconds) return Number(everySeconds[1]);
  const everyMinutes = value.match(/^\*\/(\d+) \* \* \* \*$/);
  if (everyMinutes) return Number(everyMinutes[1]) * 60;
  return null;
}

export function percentUsed(used: number, limit: number): number | null {
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) {
    return null;
  }
  return Math.round((used / limit) * 1000) / 10;
}
