"use client";

import { 
  ShieldCheck, 
  AlertTriangle, 
  Activity, 
  ArrowUpRight,
  Shield,
  Zap,
  Target as TargetIcon,
  Terminal,
  ExternalLink
} from "lucide-react";
import Link from "next/link";
import { 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area
} from "recharts";
import { useState, useEffect } from "react";
import { Detection, Target, Agent } from "@/lib/ares/mock-data";
import { safeResponseJson } from "@/lib/safe-response-json";
import { cn } from "@/lib/utils";
import { FindingFeedback } from "@/components/finding-feedback";

export default function OverviewPage() {
  const [findings, setFindings] = useState<any[]>([]);
  const [posture, setPosture] = useState<any>(null);
  const [agents, setAgents] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);

  useEffect(() => {
    async function fetchData() {
      try {
        const [findingsRes, postureRes, agentsRes, reportsRes] = await Promise.all([
          fetch("/api/findings"),
          fetch("/api/posture"),
          fetch("/api/agents"),
          fetch("/api/reports"),
        ]);

        const [findingsData, postureData, agentsData, reportsData] = await Promise.all([
          safeResponseJson<any>(findingsRes),
          safeResponseJson<any>(postureRes),
          safeResponseJson<any>(agentsRes),
          safeResponseJson<any>(reportsRes),
        ]);

        setFindings(findingsData?.data?.findings ?? findingsData?.findings ?? []);
        setPosture(postureData?.data ?? postureData ?? null);
        setAgents(agentsData?.data?.agents ?? agentsData ?? []);
        setReports(reportsData?.data?.reports ?? reportsData ?? []);
      } catch (err) {
        console.error("Failed to fetch dashboard data:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const handleStartScan = async () => {
    setIsScanning(true);
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: "." })
      });
      if (res.ok) {
        alert("Security scan initiated. Check the Operator Console for real-time logs.");
      }
    } catch (err) {
      console.error("Scan trigger failed:", err);
    } finally {
      setIsScanning(false);
    }
  };

  const criticalCount = findings.filter(f => f.severity === 'Critical').length;
  const highCount = findings.filter(f => f.severity === 'High').length;

  return (
    <div className="space-y-12 animate-in fade-in slide-in-from-bottom-2 duration-700">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 overflow-hidden">
        <div className="max-w-2xl">
          <p className="text-[12px] font-sans font-semibold text-primary uppercase tracking-[0.2em] mb-3">Build for the frontier</p>
          <h1 className="text-5xl md:text-6xl font-serif font-medium leading-tight text-foreground mb-4">Security Command</h1>
          <p className="text-lg text-muted-foreground font-sans leading-relaxed">
            Centralized monitoring and autonomous detection for your on-chain assets. 
            Calm, precise, and operator-focused.
          </p>
        </div>
        <div className="flex gap-3 shrink-0">
          <Link href="/dashboard/reports" className="px-5 py-2.5 bg-secondary text-secondary-foreground rounded-xl text-[14px] font-medium hover:bg-muted transition-all ring-shadow">
            Generate Report
          </Link>
          <button 
            onClick={handleStartScan}
            disabled={isScanning}
            className={cn(
              "px-5 py-2.5 bg-primary text-primary-foreground rounded-xl text-[14px] font-medium hover:opacity-90 transition-all shadow-xl shadow-primary/20 flex items-center gap-2",
              isScanning && "opacity-50 cursor-not-allowed"
            )}
          >
            {isScanning ? (
              <>
                <Activity className="w-4 h-4 animate-spin" />
                Scanning...
              </>
            ) : "Initiate Scan"}
          </button>
        </div>
      </div>

      {/* Hero Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard 
          label="Security Posture" 
          value={loading ? "..." : `${posture?.overall || 0}%`} 
          trend={loading ? "" : posture?.grade || "F"} 
          icon={<Shield className="w-5 h-5" />} 
        />
        <StatCard 
          label="Assurance Reports" 
          value={loading ? "..." : (reports?.length ?? 0).toString()} 
          trend="Signed Archives" 
          icon={<TargetIcon className="w-5 h-5" />} 
        />
        <StatCard 
          label="Critical Findings" 
          value={loading ? "..." : criticalCount.toString()} 
          trend={`${highCount} High`} 
          isAlert={criticalCount > 0}
          icon={<AlertTriangle className="w-5 h-5" />} 
        />
        <StatCard 
          label="Automation Jobs" 
          value={loading ? "..." : `${agents.length} Agents`} 
          trend="Synchronized" 
          icon={<Zap className="w-5 h-5" />} 
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Trend Chart */}
        <div className="lg:col-span-2 ares-card p-8 whisper-shadow">
          <div className="flex items-center justify-between mb-10">
            <h3 className="text-xl font-serif flex items-center gap-2">
              <Activity className="w-5 h-5 text-primary" />
              Posture Lifecycle
            </h3>
            <div className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
              <span className="w-2 h-2 rounded-full bg-primary" />
              Aggregate Confidence
            </div>
          </div>
          <div className="h-[340px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={posture?.layers || []}>
                <defs>
                  <linearGradient id="colorScore" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.18} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis 
                  dataKey="name" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10, fontFamily: 'var(--font-sans)' }}
                  dy={15}
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12, fontFamily: 'var(--font-sans)' }}
                  domain={[0, 100]}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'hsl(var(--card))', 
                    border: '1px solid hsl(var(--border))', 
                    borderRadius: '12px',
                    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.35)',
                  }}
                  itemStyle={{ color: 'hsl(var(--primary))', fontFamily: 'var(--font-sans)' }}
                />
                <Area 
                  type="monotone" 
                  dataKey="score" 
                  stroke="hsl(var(--primary))" 
                  strokeWidth={2.5}
                  fillOpacity={1} 
                  fill="url(#colorScore)" 
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Right Panel - Active Agents */}
        <div className="ares-card p-8 bg-secondary/30 flex flex-col">
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-xl font-serif flex items-center gap-2">
              <Terminal className="w-5 h-5 text-primary" />
              Agent Systems
            </h3>
            <span className="px-2 py-1 bg-primary/10 text-primary rounded-full text-[10px] font-bold uppercase tracking-wider">Active</span>
          </div>
          
          <div className="space-y-3 flex-1">
            {findings.slice(0, 5).map((finding, idx) => (
              <div key={idx} className="p-4 rounded-xl bg-card border border-border flex items-center gap-4 group hover:ring-shadow transition-all">
                <div className={cn(
                  "w-2 h-2 rounded-full shrink-0",
                  finding.severity === 'Critical' ? "bg-destructive animate-pulse" : 
                  finding.severity === 'High' ? "bg-primary" : "bg-muted-foreground/30"
                )} />
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-semibold text-foreground truncate">{finding.rule}</p>
                  <p className="text-[12px] text-muted-foreground truncate font-sans">{finding.message}</p>
                </div>
                <div className="opacity-0 group-hover:opacity-100 flex items-center gap-2 transition-opacity">
                  <FindingFeedback runId="dashboard-overview" findingId={`${finding.rule}-${idx}`} />
                  <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
              </div>
            ))}
            {findings.length === 0 && (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8 opacity-40 italic">
                <ShieldCheck className="w-12 h-12 mb-3" />
                <p className="text-sm">No active threats detected in latest telemetry buffers.</p>
              </div>
            )}
          </div>
          
          <button className="w-full py-2.5 mt-8 bg-card border border-border rounded-xl text-[12px] font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-all uppercase tracking-[0.15em] font-sans">
            Scale Autonomous Jobs
          </button>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, trend, icon, isAlert }: { label: string, value: string, trend: string, icon: React.ReactNode, isAlert?: boolean }) {
  const isNeutral = trend === "0";
  const isDown = trend.startsWith("-");

  return (
    <div className={cn(
      "ares-card p-6 whisper-shadow hover:ring-shadow group relative overflow-hidden",
      isAlert ? "border-destructive/30" : ""
    )}>
      <div className="flex items-center justify-between mb-6">
        <div className={cn(
          "w-10 h-10 rounded-xl flex items-center justify-center transition-colors shadow-sm",
          isAlert ? "bg-destructive/10 text-destructive" : "bg-secondary text-primary group-hover:bg-primary group-hover:text-primary-foreground"
        )}>
          {icon}
        </div>
        {!isNeutral && (
          <div className={cn(
            "text-[12px] font-bold px-2.5 py-1 rounded-full",
            isDown ? "bg-primary/10 text-primary" : "bg-emerald-500/10 text-emerald-500"
          )}>
            {trend}
          </div>
        )}
      </div>
      <div>
        <p className="text-[13px] font-medium text-muted-foreground mb-1 font-sans">{label}</p>
        <p className="text-4xl font-serif font-medium">{value}</p>
      </div>
    </div>
  );
}
