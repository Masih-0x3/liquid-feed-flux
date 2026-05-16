import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

interface FollowerGrowthPoint {
  date: string;
  followers: number;
}

export default function FollowerGrowthChart({ data }: { data: FollowerGrowthPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="followerGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
            <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis domain={["dataMin - 20", "dataMax + 20"]} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={50} />
        <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "12px" }} />
        <Area type="monotone" dataKey="followers" stroke="hsl(var(--primary))" fillOpacity={1} fill="url(#followerGradient)" strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
