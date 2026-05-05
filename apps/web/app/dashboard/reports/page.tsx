"use client";

import { useState, useEffect } from "react";
import { 
  Plus, 
  Search, 
  Filter, 
  FileText, 
  Download, 
  Share2, 
  MoreVertical,
  Calendar,
  FileSearch,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2
} from "lucide-react";
import { cn } from "@/lib/utils";

export default function ReportsPage() {
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSynthesizing, setIsSynthesizing] = useState(false);

  useEffect(() => {
    fetchReports();
  }, []);

  const fetchReports = async () => {
    try {
      const res = await fetch("/api/reports");
      const payload = await res.json();
      const list =
        payload?.ok === true && Array.isArray(payload?.data?.reports)
          ? payload.data.reports
          : [];
      setReports(list);
    } catch (err) {
      console.error("Failed to fetch reports:", err);
      setReports([]);
    } finally {
      setLoading(false);
    }
  };

  const handleRequestSynthesis = async () => {
    setIsSynthesizing(true);
    try {
      await fetch("/api/reports", { method: "POST" });
      // Simulate synthesis starting
      setTimeout(() => {
        setIsSynthesizing(false);
        fetchReports();
      }, 3000);
    } catch (err) {
      console.error("Synthesis failed:", err);
      setIsSynthesizing(false);
    }
  };

  return (
    <div className="space-y-12 animate-in fade-in slide-in-from-bottom-2 duration-700">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 overflow-hidden">
        <div>
          <p className="text-[12px] font-sans font-semibold text-primary uppercase tracking-[0.2em] mb-3">Evidence & Documentation</p>
          <h1 className="text-5xl font-serif font-medium tracking-tight text-foreground mb-4">Case Registry</h1>
          <p className="text-lg text-muted-foreground max-w-2xl leading-relaxed">
            Audit-ready documents synthesized from the ARES analysis engine. 
            All reports are cryptographically signed and archived as evidence trails.
          </p>
        </div>
        <button 
          onClick={handleRequestSynthesis}
          disabled={isSynthesizing}
          className="flex items-center gap-2 px-5 py-2.5 bg-primary rounded-xl text-[14px] font-medium text-primary-foreground hover:bg-primary/90 transition-all shadow-xl shadow-primary/20 shrink-0 disabled:opacity-50"
        >
          {isSynthesizing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
          {isSynthesizing ? "Synthesizing..." : "Request New Synthesis"}
        </button>
      </div>

      {/* Grid of featured reports or templates */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
         <div className="ares-card p-8 whisper-shadow group hover:ring-shadow transition-all bg-secondary/30">
            <h3 className="text-2xl font-serif font-medium mb-4 flex items-center gap-3">
               <FileSearch className="w-6 h-6 text-primary" />
               Custom Audit Template
            </h3>
            <p className="text-muted-foreground text-[15px] leading-relaxed mb-8">
              Generate a comprehensive vulnerability report for a specific target set. 
              Includes SARIF findings, agent reasoning summaries, and mitigation advice.
            </p>
            <div className="flex gap-4">
               <button className="flex-1 py-3 bg-card border border-border rounded-xl text-[14px] font-medium hover:bg-secondary/50 transition-all">Configure Scope</button>
               <button className="px-5 py-3 bg-primary text-primary-foreground rounded-xl text-[14px] font-medium shadow-lg shadow-primary/10">Start Generation</button>
            </div>
         </div>
         <div className="ares-card p-8 whisper-shadow group hover:ring-shadow transition-all bg-secondary/30">
            <h3 className="text-2xl font-serif font-medium mb-4 flex items-center gap-3">
               <Share2 className="w-6 h-6 text-primary" />
               External Compliance Feed
            </h3>
            <p className="text-muted-foreground text-[15px] leading-relaxed mb-8">
              Automatically stream verified finding reports to connected GRC platforms 
              or security information management systems.
            </p>
            <div className="flex gap-4">
               <button className="flex-1 py-3 bg-card border border-border rounded-xl text-[14px] font-medium hover:bg-secondary/50 transition-all">Manage Integrations</button>
            </div>
         </div>
      </div>

      <div className="space-y-6">
        <div className="flex items-center justify-between border-b border-border pb-4">
          <h2 className="text-2xl font-serif font-medium">Recent Archives</h2>
          <div className="flex items-center gap-3">
             <div className="px-3 py-1.5 bg-secondary/30 rounded-lg border border-border flex items-center gap-2 group focus-within:ring-1 focus-within:ring-primary/20 transition-all">
                <Search className="w-3.5 h-3.5 text-muted-foreground" />
                <input type="text" placeholder="Filter reports..." className="bg-transparent border-none text-xs w-48 focus:ring-0" />
             </div>
             <button className="p-2 border border-border rounded-lg hover:bg-secondary transition-all">
                <Filter className="w-4 h-4 text-muted-foreground" />
             </button>
          </div>
        </div>

        <div className="ares-card whisper-shadow divide-y divide-border overflow-hidden">
          {loading ? (
            [1, 2, 3].map(i => (
              <div key={i} className="p-6 bg-secondary/5 animate-pulse flex gap-6">
                <div className="w-12 h-12 rounded-xl bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-muted w-1/3" />
                  <div className="h-3 bg-muted w-1/4" />
                </div>
              </div>
            ))
          ) : reports.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground italic font-serif">
              No reports synthesized in this buffer yet.
            </div>
          ) : reports.map((report) => (
            <div key={report.id} className="p-6 flex flex-col md:flex-row md:items-center gap-6 group hover:bg-secondary/10 transition-colors">
              <div className="w-12 h-12 rounded-xl bg-card border border-border flex items-center justify-center shadow-sm group-hover:border-primary/20 transition-all">
                 <FileText className="w-5 h-5 text-primary" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-1">
                   <h4 className="text-lg font-serif font-medium truncate group-hover:text-primary transition-colors cursor-pointer leading-tight">{report.name}</h4>
                   {report.status === 'verified' && (
                     <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 uppercase tracking-widest px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/10 rounded-full">
                       <CheckCircle2 className="w-2.5 h-2.5" />
                       Verified
                     </span>
                   )}
                </div>
                <div className="flex items-center gap-6 text-[13px] text-muted-foreground font-sans">
                  <span className="flex items-center gap-1.5 capitalize"><FileText className="w-3.5 h-3.5" />{report.type.replace('_', ' ')}</span>
                  <span className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" />{report.date}</span>
                  <span className="opacity-60">{report.size}</span>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {report.status === 'verified' ? (
                  <>
                    <a 
                      href={report.path} 
                      download={report.id}
                      className="p-2.5 border border-border rounded-xl text-muted-foreground hover:text-foreground hover:bg-card hover:ring-shadow transition-all group/btn"
                    >
                      <Download className="w-4 h-4 group-hover/btn:text-primary transition-colors" />
                    </a>
                    <button className="p-2.5 border border-border rounded-xl text-muted-foreground hover:text-foreground hover:bg-card hover:ring-shadow transition-all">
                      <Share2 className="w-4 h-4" />
                    </button>
                  </>
                ) : (
                  <div className="flex items-center gap-2 text-xs font-medium text-amber-600 px-3 py-1.5 bg-amber-500/10 rounded-lg animate-pulse">
                    <Clock className="w-3.5 h-3.5" />
                    Synthesizing Evidence...
                  </div>
                )}
                <button className="p-2.5 text-muted-foreground hover:text-foreground transition-all">
                   <MoreVertical className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
        
        <div className="text-center py-8">
           <button className="text-[13px] font-medium text-muted-foreground hover:text-primary transition-colors decoration-border underline underline-offset-8">
             View Complete Evidence History
           </button>
        </div>
      </div>
    </div>
  );
}
