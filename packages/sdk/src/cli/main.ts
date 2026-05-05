import { existsSync } from "node:fs";
import { AresClient } from "../client.js";
import { AresApiError, AresPaymentRequiredError } from "../types.js";
import {
  configDir,
  configPath,
  patchConfig,
  readConfig,
  clearAllCookies,
} from "../config.js";
import { defaultSolanaKeypairPath, KeypairLoadError } from "../auth/keypair.js";
import { parseArgs, flagString, flagBool, type ParsedArgs } from "./args.js";
import { c, jsonOut, logErr, logInfo, logOk, logWarn } from "./ui.js";

const VERSION = "0.1.0";

/**
 * Exit codes
 *   0  ok
 *   1  generic error
 *   2  bad usage
 *   3  unauthenticated (sign-in required)
 *   4  payment required (HTTP 402)
 *   5  network unreachable
 */
const EXIT = {
  OK: 0,
  ERROR: 1,
  USAGE: 2,
  AUTH: 3,
  PAYMENT: 4,
  NETWORK: 5,
} as const;

const HELP = `
${c.bold("ares")} — ARES Solana Security Tool CLI (v${VERSION})

${c.bold("Usage:")}
  ares <command> [args] [flags]

${c.bold("Commands:")}
  ${c.cyan("login")}        Sign in via Solana wallet keypair (SIWS)
  ${c.cyan("logout")}       Clear local session cookie
  ${c.cyan("whoami")}       Show current session
  ${c.cyan("chat")}         Run a single-shot agent prompt
                  ${c.dim("ares chat \"audit src/lib/auth\" --json")}
  ${c.cyan("scan")}         Queue a full repo security scan
                  ${c.dim("ares scan . --model openrouter:deepseek/deepseek-r1")}
  ${c.cyan("run")}          Show a queued/completed run by id (alias: get-run)
                  ${c.dim("ares run <run_id> --watch")}
  ${c.cyan("runs")}         List recent runs
  ${c.cyan("findings")}     List findings from completed runs
  ${c.cyan("config")}       View / set persistent config (~/.asst/config.json)
                  ${c.dim("ares config --base-url https://ares.example.com")}

${c.bold("Global flags:")}
  --base-url URL          Override base URL (env: ARES_BASE_URL)
  --api-key  KEY          Operator key (env: ARES_API_KEY) — bypass paywall
  --keypair  PATH         Solana keypair file (env: ARES_KEYPAIR_PATH)
  --json                  Print machine-readable JSON to stdout
  --timeout  MS           Request timeout (default 60000)
  -v, --version           Show version
  -h, --help              Show this help

${c.bold("Sign-in for CI:")}
  export ARES_BASE_URL=https://ares.example.com
  export ARES_KEYPAIR_PATH=$HOME/.config/solana/ci.json
  ares login --json
  ares scan . --json
`.trim();

interface Ctx {
  client: AresClient;
  json: boolean;
  baseUrl: string;
}

function buildClient(args: ParsedArgs): Ctx {
  const cfg = readConfig();
  const baseUrl =
    flagString(args.flags, ["base-url"]) ??
    process.env.ARES_BASE_URL?.trim() ??
    cfg.baseUrl ??
    "http://127.0.0.1:3000";
  const apiKey =
    flagString(args.flags, ["api-key"]) ?? process.env.ARES_API_KEY?.trim();
  const json = flagBool(args.flags, ["json"]);
  const timeoutRaw = flagString(args.flags, ["timeout"]);
  const timeoutMs = timeoutRaw ? Number.parseInt(timeoutRaw, 10) : 60_000;

  const opts: ConstructorParameters<typeof AresClient>[0] = {
    baseUrl,
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 60_000,
  };
  if (apiKey) opts.apiKey = apiKey;

  const client = new AresClient(opts);
  if (cfg.cookies && Object.keys(cfg.cookies).length > 0) {
    client.setCookies(cfg.cookies);
  }
  return { client, json, baseUrl };
}

function persistCookies(client: AresClient): void {
  patchConfig({ cookies: client.getCookies() });
}

function persistWallet(wallet: string | undefined): void {
  if (wallet) patchConfig({ wallet });
}

async function cmdLogin(ctx: Ctx, args: ParsedArgs): Promise<number> {
  const keypairPath =
    flagString(args.flags, ["keypair"]) ??
    process.env.ARES_KEYPAIR_PATH?.trim() ??
    defaultSolanaKeypairPath();

  if (!existsSync(keypairPath)) {
    logErr(
      `Keypair not found: ${keypairPath}\n  Generate one with: solana-keygen new --no-bip39-passphrase -o ${keypairPath}\n  Or pass --keypair PATH / set ARES_KEYPAIR_PATH.`,
    );
    return EXIT.USAGE;
  }

  try {
    const me = await ctx.client.signInWithKeypair({ keypairPath });
    persistCookies(ctx.client);
    persistWallet(me.wallet);
    if (ctx.json) {
      jsonOut({ ok: true, ...me });
    } else {
      logOk(`signed in as ${c.cyan(me.wallet ?? "(unknown)")} (tier=${me.tier ?? "?"})`);
    }
    return EXIT.OK;
  } catch (err) {
    return handleError(err, ctx.json);
  }
}

async function cmdLogout(ctx: Ctx): Promise<number> {
  try {
    await ctx.client.signOut();
  } catch (err) {
    // Logout should never fail the user — log and continue.
    logWarn(`server logout failed: ${(err as Error).message}`);
  }
  clearAllCookies();
  patchConfig({ wallet: undefined });
  if (ctx.json) jsonOut({ ok: true, loggedOut: true });
  else logOk("session cleared");
  return EXIT.OK;
}

async function cmdWhoami(ctx: Ctx): Promise<number> {
  try {
    const me = await ctx.client.me();
    if (ctx.json) {
      jsonOut(me);
    } else if (me.authenticated) {
      process.stdout.write(
        `${c.bold("wallet:")} ${me.wallet ?? "?"}\n` +
          `${c.bold("tier:")}   ${me.tier ?? "?"}\n` +
          `${c.bold("units:")}  ${me.balanceUnits ?? 0}\n` +
          `${c.bold("admin:")}  ${me.isAdmin ? "yes" : "no"}\n` +
          `${c.bold("base:")}   ${ctx.baseUrl}\n`,
      );
    } else {
      process.stdout.write(`${c.dim("not signed in")} (base=${ctx.baseUrl})\n`);
      return EXIT.AUTH;
    }
    return EXIT.OK;
  } catch (err) {
    return handleError(err, ctx.json);
  }
}

async function cmdChat(ctx: Ctx, args: ParsedArgs): Promise<number> {
  const prompt = args.positionals.join(" ").trim();
  if (!prompt) {
    logErr("usage: ares chat \"<prompt>\" [--model openrouter:...]");
    return EXIT.USAGE;
  }
  const model = flagString(args.flags, ["model"]);
  try {
    const opts: { model?: string } = {};
    if (model !== undefined) opts.model = model;
    const out = await ctx.client.chat(prompt, opts);
    if (ctx.json) {
      jsonOut(out);
    } else {
      // Reply may be a string OR an object (orchestrator passthrough).
      if (typeof out.response === "string") {
        process.stdout.write(out.response.endsWith("\n") ? out.response : `${out.response}\n`);
      } else {
        jsonOut(out.response);
      }
      logInfo(`billing=${out.billing}`);
    }
    return EXIT.OK;
  } catch (err) {
    return handleError(err, ctx.json);
  }
}

async function cmdScan(ctx: Ctx, args: ParsedArgs): Promise<number> {
  const target = args.positionals[0] ?? ".";
  const model = flagString(args.flags, ["model"]);
  try {
    const opts: { target: string; model?: string } = { target };
    if (model !== undefined) opts.model = model;
    const out = await ctx.client.scan(opts);
    if (ctx.json) {
      jsonOut(out);
    } else {
      process.stdout.write(
        `${c.bold("status:")} ${out.status}\n` +
          `${c.bold("run_id:")} ${out.run_id ?? "(no agent-py run id returned)"}\n` +
          `${c.bold("target:")} ${out.target}\n` +
          `${c.bold("billing:")} ${out.billing}\n`,
      );
    }
    return EXIT.OK;
  } catch (err) {
    return handleError(err, ctx.json);
  }
}

async function cmdRun(ctx: Ctx, args: ParsedArgs): Promise<number> {
  const runId = args.positionals[0];
  if (!runId) {
    logErr("usage: ares run <run_id> [--watch]");
    return EXIT.USAGE;
  }
  const watch = flagBool(args.flags, ["watch", "w"]);
  try {
    if (!watch) {
      const row = await ctx.client.getRun(runId);
      if (ctx.json) jsonOut(row);
      else printRunRow(row);
      return EXIT.OK;
    }
    // Poll loop.
    const intervalRaw = flagString(args.flags, ["interval"]);
    const intervalMs = intervalRaw ? Math.max(500, Number.parseInt(intervalRaw, 10) || 0) : 2000;
    let last = "";
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const row = await ctx.client.getRun(runId);
      if (ctx.json) {
        jsonOut(row);
      } else {
        const status = String(row.status ?? "?");
        if (status !== last) {
          last = status;
          process.stderr.write(`${c.dim(new Date().toISOString())} status=${c.cyan(status)}\n`);
        }
      }
      const status = String(row.status ?? "");
      if (
        status === "complete" ||
        status === "completed" ||
        status === "failed" ||
        status === "error"
      ) {
        return status === "failed" || status === "error" ? EXIT.ERROR : EXIT.OK;
      }
      await sleep(intervalMs);
    }
  } catch (err) {
    return handleError(err, ctx.json);
  }
}

async function cmdRuns(ctx: Ctx): Promise<number> {
  try {
    const out = await ctx.client.runs();
    if (ctx.json) {
      jsonOut(out);
      return EXIT.OK;
    }
    process.stdout.write(`${c.bold("total:")} ${out.total}\n`);
    for (const r of out.runs) {
      process.stdout.write(
        `  ${c.gray(String(r.id ?? "?").slice(0, 8))} ` +
          `${(String(r.status ?? "?")).padEnd(10)} ` +
          `${String(r.target ?? "")}\n`,
      );
    }
    return EXIT.OK;
  } catch (err) {
    return handleError(err, ctx.json);
  }
}

async function cmdFindings(ctx: Ctx): Promise<number> {
  try {
    const out = await ctx.client.findings();
    if (ctx.json) {
      jsonOut(out);
      return EXIT.OK;
    }
    if (out.findings.length === 0) {
      process.stdout.write(`${c.dim("(no findings)")}\n`);
      return EXIT.OK;
    }
    for (const f of out.findings) {
      const sev = String(f.severity ?? "?").toUpperCase();
      const sevColor =
        sev === "HIGH" || sev === "CRITICAL"
          ? c.red
          : sev === "MEDIUM"
            ? c.yellow
            : c.cyan;
      process.stdout.write(
        `${sevColor(sev.padEnd(8))} ${c.gray(String(f.rule_id ?? "").padEnd(28))} ` +
          `${String(f.file ?? "")}${f.line ? `:${f.line}` : ""}\n` +
          `  ${String(f.message ?? "")}\n`,
      );
    }
    return EXIT.OK;
  } catch (err) {
    return handleError(err, ctx.json);
  }
}

async function cmdConfig(ctx: Ctx, args: ParsedArgs): Promise<number> {
  const baseUrl = flagString(args.flags, ["base-url"]);
  const reset = flagBool(args.flags, ["reset"]);
  if (reset) {
    patchConfig({ baseUrl: undefined, cookies: {}, wallet: undefined });
    if (ctx.json) jsonOut({ ok: true, reset: true });
    else logOk("config reset");
    return EXIT.OK;
  }
  if (baseUrl !== undefined) {
    patchConfig({ baseUrl });
  }
  const cfg = readConfig();
  if (ctx.json) {
    jsonOut({ path: configPath(), dir: configDir(), ...cfg, cookies: maskCookies(cfg.cookies) });
  } else {
    process.stdout.write(`${c.bold("config:")} ${configPath()}\n`);
    process.stdout.write(`${c.bold("baseUrl:")} ${cfg.baseUrl ?? "(unset)"}\n`);
    process.stdout.write(`${c.bold("wallet:")}  ${cfg.wallet ?? "(none)"}\n`);
    process.stdout.write(
      `${c.bold("cookies:")} ${
        cfg.cookies && Object.keys(cfg.cookies).length > 0
          ? Object.keys(cfg.cookies).join(", ")
          : "(none)"
      }\n`,
    );
  }
  return EXIT.OK;
}

function maskCookies(
  cookies: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!cookies) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(cookies)) {
    out[k] = v ? `${v.slice(0, 6)}…(${v.length} chars)` : "";
  }
  return out;
}

function printRunRow(row: Record<string, unknown>): void {
  const lines: string[] = [];
  for (const k of ["id", "status", "target", "model", "created_at", "finished_at"]) {
    if (row[k] !== undefined) lines.push(`${c.bold(`${k}:`)} ${String(row[k])}`);
  }
  process.stdout.write(lines.join("\n") + "\n");
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

function handleError(err: unknown, json: boolean): number {
  if (err instanceof AresPaymentRequiredError) {
    if (json) {
      jsonOut({
        ok: false,
        code: "PAYMENT_REQUIRED",
        status: 402,
        message: err.message,
        wwwAuthenticate: err.wwwAuthenticate,
      });
    } else {
      logErr(err.message);
      if (err.wwwAuthenticate) {
        process.stderr.write(`  ${c.dim("WWW-Authenticate:")} ${err.wwwAuthenticate}\n`);
      }
    }
    return EXIT.PAYMENT;
  }
  if (err instanceof AresApiError) {
    if (json) {
      jsonOut({
        ok: false,
        code: err.code,
        status: err.status,
        message: err.message,
        requestId: err.requestId,
      });
    } else {
      logErr(`${err.code} (${err.status}): ${err.message}`);
      if (err.requestId) process.stderr.write(`  ${c.dim("requestId:")} ${err.requestId}\n`);
    }
    if (err.code === "UNAUTHORIZED" || err.code === "FORBIDDEN") return EXIT.AUTH;
    if (err.status === 0) return EXIT.NETWORK;
    return EXIT.ERROR;
  }
  if (err instanceof KeypairLoadError) {
    if (json) jsonOut({ ok: false, code: "USAGE", message: err.message });
    else logErr(err.message);
    return EXIT.USAGE;
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (json) jsonOut({ ok: false, code: "UNKNOWN", message: msg });
  else logErr(msg);
  return EXIT.ERROR;
}

export async function runCli(argv: string[]): Promise<number> {
  const args = parseArgs(argv);

  if (flagBool(args.flags, ["version", "v"])) {
    process.stdout.write(`@ares/sdk v${VERSION}\n`);
    return EXIT.OK;
  }
  if (flagBool(args.flags, ["help", "h"]) || !args.command) {
    process.stdout.write(HELP + "\n");
    return args.command ? EXIT.OK : EXIT.OK;
  }

  const ctx = buildClient(args);

  switch (args.command) {
    case "login":
      return cmdLogin(ctx, args);
    case "logout":
      return cmdLogout(ctx);
    case "whoami":
    case "me":
      return cmdWhoami(ctx);
    case "chat":
      return cmdChat(ctx, args);
    case "scan":
      return cmdScan(ctx, args);
    case "run":
    case "get-run":
      return cmdRun(ctx, args);
    case "runs":
      return cmdRuns(ctx);
    case "findings":
      return cmdFindings(ctx);
    case "config":
      return cmdConfig(ctx, args);
    default:
      logErr(`unknown command: ${args.command}`);
      process.stderr.write(`run ${c.cyan("ares --help")}\n`);
      return EXIT.USAGE;
  }
}
