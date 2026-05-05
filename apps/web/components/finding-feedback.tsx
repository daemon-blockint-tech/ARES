"use client";

import { ThumbsDown, ThumbsUp } from "lucide-react";
import { useState } from "react";

type Props = {
  runId: string;
  findingId: string;
};

export function FindingFeedback({ runId, findingId }: Props) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<"up" | "down" | null>(null);

  async function send(rating: 1 | -1) {
    if (busy || done) return;
    setBusy(true);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ run_id: runId, finding_id: findingId, rating }),
      });
      if (res.ok) setDone(rating === 1 ? "up" : "down");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-1 shrink-0">
      <button
        type="button"
        aria-label="Helpful"
        disabled={busy || !!done}
        onClick={() => void send(1)}
        className={`p-1 rounded-md border border-border ${done === "up" ? "bg-primary/15 text-primary" : "hover:bg-secondary"}`}
      >
        <ThumbsUp className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        aria-label="Not helpful"
        disabled={busy || !!done}
        onClick={() => void send(-1)}
        className={`p-1 rounded-md border border-border ${done === "down" ? "bg-destructive/15 text-destructive" : "hover:bg-secondary"}`}
      >
        <ThumbsDown className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
