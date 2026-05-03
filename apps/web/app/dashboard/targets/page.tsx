"use client";

import { useState, useEffect } from "react";
import { 
  Plus, 
  Filter, 
  Search, 
  MoreVertical,
  ExternalLink,
  ShieldCheck,
  ShieldAlert,
  Activity,
  History,
  Target as TargetIcon
} from "lucide-react";
import { cn } from "@/lib/utils";

export default function TargetsPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [targets, setTargets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchTargets() {
      try {
        const res = await fetch("/api/posture");
        const data = await res.json();
        const resFindings = await fetch("/api/findings");
        const findingsData = await resFindings.json();

        // Infer targets from manifest and findings
        const manifest = findingsData.manifest || {};
        const overallRaw = data?.overall;
        const overall =
          typeof overallRaw === "number" && Number.isFinite(overallRaw)
            ? Math.max(0, Math.min(100, overallRaw))
            : undefined;
        const riskScore =
          overall !== undefined
            ? Math.max(0, Math.min(100, Math.round(100 - overall)))
            : 0;
        const baseTarget = {
          id: manifest.repoRoot ? manifest.repoRoot.split("\\").pop() : "primary-repo",
          name: manifest.repoRoot ? manifest.repoRoot.split("\\").pop() : "ARES Workspace",
          type: "repo",
          status: overall !== undefined && overall > 80 ? "protected" : "monitoring",
          riskScore,
          owner: "System",
        };

        // Add some inferred targets from findings files
        const fileTargets = Array.from(new Set((findingsData.findings || []).map((f: any) => f.file))).filter(Boolean).map((file: any) => ({
          id: file,
          name: file.split('/').pop(),
          type: file.endsWith('.sol') || file.endsWith('.rs') ? 'contract' : 'repo',
          status: 'monitoring',
          riskScore: 40,
          owner: 'Agent'
        }));

        setTargets([baseTarget, ...fileTargets]);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchTargets();
  }, []);

  const filteredTargets = targets.filter(t => 
    t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.type.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-12 animate-in fade-in slide-in-from-bottom-2 duration-700">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 overflow-hidden">
        <div>
          <p className="text-[12px] font-sans font-semibold text-primary uppercase tracking-[0.2em] mb-3">Monitor. Protect. Control.</p>
          <h1 className="text-5xl font-serif font-medium tracking-tight text-foreground mb-4">Inventory</h1>
          <p className="text-lg text-muted-foreground max-w-2xl leading-relaxed">
            A comprehensive registry of monitored on-chain and off-chain assets. 
            All entities are continuously scanned for state changes and threat vectors.
          </p>
        </div>
        <button className="flex items-center gap-2 px-5 py-2.5 bg-primary rounded-xl text-[14px] font-medium text-primary-foreground hover:bg-primary/90 transition-all shadow-xl shadow-primary/20 shrink-0">
          <Plus className="w-4 h-4" />
          Onboard Asset
        </button>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex-1 flex items-center gap-3 px-4 py-2 bg-secondary/30 border border-border rounded-xl text-muted-foreground focus-within:ring-1 focus-within:ring-primary/30 transition-all group">
          <Search className="w-4 h-4 group-focus-within:text-foreground transition-colors" />
          <input 
            type="text" 
            placeholder="Search assets by name, type, or owner..." 
            className="bg-transparent border-none text-[15px] w-full focus:ring-0 text-foreground placeholder:text-muted-foreground/60"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground border border-border rounded-xl text-[14px] font-medium hover:bg-muted transition-all ring-shadow">
          <Filter className="w-4 h-4 text-muted-foreground" />
          Filters
        </button>
      </div>

      <div className="ares-card whisper-shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[15px]">
            <thead>
              <tr className="border-b border-border bg-secondary/20">
                <th className="px-8 py-5 font-serif font-medium text-foreground">Asset Identity</th>
                <th className="px-8 py-5 font-serif font-medium text-foreground">Type</th>
                <th className="px-8 py-5 font-serif font-medium text-foreground">Integrity</th>
                <th className="px-8 py-5 font-serif font-medium text-foreground">Risk Score</th>
                <th className="px-8 py-5 font-serif font-medium text-foreground">Guardian</th>
                <th className="px-8 py-5 font-serif font-medium text-foreground text-right italic opacity-60">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredTargets.map((target) => {
                const riskScore = normalizeRiskScore(target.riskScore);
                return (
                <tr key={target.id} className="group hover:bg-secondary/10 transition-colors">
                  <td className="px-8 py-6">
                    <div className="flex items-center gap-4">
                      <div className="p-2.5 rounded-xl bg-card border border-border group-hover:border-primary/20 transition-all shadow-sm">
                        <TargetTypeIcon type={target.type} />
                      </div>
                      <div>
                        <span className="font-serif font-medium text-lg block leading-tight">{target.name}</span>
                        <span className="text-[11px] font-mono text-muted-foreground uppercase opacity-60">{target.id}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-8 py-6">
                    <span className="capitalize text-muted-foreground font-sans">{target.type}</span>
                  </td>
                  <td className="px-8 py-6">
                    <StatusBadge status={target.status} />
                  </td>
                  <td className="px-8 py-6">
                     <div className="flex items-center gap-4 min-w-[140px]">
                       <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
                          <div 
                            className={cn(
                              "h-full transition-all duration-1000",
                              riskScore < 20 ? "bg-emerald-500" : riskScore < 60 ? "bg-primary" : "bg-destructive"
                            )} 
                            style={{ width: `${riskScore}%` }} 
                          />
                       </div>
                       <span className="font-serif font-medium w-6 text-right leading-none tabular-nums">{riskScore}</span>
                     </div>
                  </td>
                  <td className="px-8 py-6">
                    <span className="text-muted-foreground font-sans">{target.owner || "Unassigned"}</span>
                  </td>
                  <td className="px-8 py-6 text-right">
                    <div className="flex items-center justify-end gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button className="p-2 text-muted-foreground hover:text-primary transition-colors border border-transparent hover:border-primary/10 rounded-lg">
                        <ExternalLink className="w-4 h-4" />
                      </button>
                      <button className="p-2 text-muted-foreground hover:text-foreground transition-colors border border-transparent hover:border-border rounded-lg">
                        <MoreVertical className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** 0–100 integer for progress + display; never NaN (avoids React child warning). */
function normalizeRiskScore(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function TargetTypeIcon({ type }: { type: string }) {
  switch (type) {
    case 'wallet': return <ShieldCheck className="w-4 h-4 text-primary" />;
    case 'contract': return <ShieldAlert className="w-4 h-4 text-emerald-500" />;
    case 'repo': return <History className="w-4 h-4 text-muted-foreground" />;
    case 'endpoint': return <Activity className="w-4 h-4 text-destructive" />;
    default: return <TargetIcon className="w-4 h-4 text-muted-foreground" />;
  }
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    protected: "bg-emerald-500/10 text-emerald-600 border-emerald-500/10",
    monitoring: "bg-blue-500/10 text-blue-600 border-blue-500/10",
    vulnerable: "bg-destructive/10 text-destructive border-destructive/10",
    unverified: "bg-muted text-muted-foreground border-border",
  };

  return (
    <span className={cn(
      "px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest border font-sans whitespace-nowrap",
      styles[status]
    )}>
      {status}
    </span>
  );
}
