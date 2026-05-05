import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

/**
 * Persistent CLI config + cookie jar.
 *
 * Stored at $ARES_HOME/config.json, defaults to `~/.asst/`.
 *
 * Keep in sync with `apps/web/lib/auth/cookie.ts` cookie name
 * (`asst_session`). The session JWT is a bearer secret — file is chmod 0600.
 */

export interface AresConfig {
  baseUrl?: string | undefined;
  cookies?: Record<string, string> | undefined;
  /** Last successful sign-in wallet, for `ares whoami` UX. */
  wallet?: string | undefined;
}

const ENV_VAR = "ARES_HOME";

export function configDir(): string {
  return process.env[ENV_VAR]?.trim() || join(homedir(), ".asst");
}

export function configPath(): string {
  return join(configDir(), "config.json");
}

export function readConfig(): AresConfig {
  const p = configPath();
  if (!existsSync(p)) return {};
  try {
    const raw = readFileSync(p, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") return parsed as AresConfig;
    return {};
  } catch {
    return {};
  }
}

export function writeConfig(cfg: AresConfig): void {
  const p = configPath();
  mkdirSync(dirname(p), { recursive: true, mode: 0o700 });
  writeFileSync(p, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
  try {
    // Defense-in-depth: chmod even if the file already existed at a wider mode.
    chmodSync(p, 0o600);
  } catch {
    // Some filesystems (Windows) don't support POSIX modes — best-effort.
  }
}

export function patchConfig(patch: Partial<AresConfig>): AresConfig {
  const next: AresConfig = { ...readConfig(), ...patch };
  writeConfig(next);
  return next;
}

export function setCookie(name: string, value: string): void {
  const cfg = readConfig();
  const cookies = { ...(cfg.cookies ?? {}) };
  cookies[name] = value;
  writeConfig({ ...cfg, cookies });
}

export function clearCookie(name: string): void {
  const cfg = readConfig();
  if (!cfg.cookies) return;
  const { [name]: _drop, ...rest } = cfg.cookies;
  void _drop;
  writeConfig({ ...cfg, cookies: rest });
}

export function clearAllCookies(): void {
  const cfg = readConfig();
  writeConfig({ ...cfg, cookies: {} });
}

export function buildCookieHeader(cookies: Record<string, string> | undefined): string | undefined {
  if (!cookies) return undefined;
  const entries = Object.entries(cookies).filter(([, v]) => v && v.length > 0);
  if (entries.length === 0) return undefined;
  return entries.map(([k, v]) => `${k}=${v}`).join("; ");
}
