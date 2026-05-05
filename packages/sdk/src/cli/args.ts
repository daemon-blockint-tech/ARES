/**
 * Tiny zero-dependency arg parser. Handles the subset we need:
 *   - subcommand (first positional)
 *   - long flags `--key=value`, `--key value`, boolean `--key`
 *   - short flags `-k value` (no clustering)
 *   - positional args after the subcommand
 *   - `--` terminator
 *
 * We intentionally avoid commander/yargs to keep `npm i -g @ares/sdk` fast.
 */

export interface ParsedArgs {
  command: string | undefined;
  positionals: string[];
  flags: Record<string, string | boolean>;
  rest: string[];
}

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    command: undefined,
    positionals: [],
    flags: {},
    rest: [],
  };
  let i = 0;
  // First non-flag token is the command.
  while (i < argv.length) {
    const tok = argv[i] as string;
    if (tok === "--") {
      out.rest = argv.slice(i + 1);
      return out;
    }
    if (tok.startsWith("--")) {
      const eq = tok.indexOf("=");
      if (eq >= 0) {
        out.flags[tok.slice(2, eq)] = tok.slice(eq + 1);
        i += 1;
        continue;
      }
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        out.flags[tok.slice(2)] = next;
        i += 2;
        continue;
      }
      out.flags[tok.slice(2)] = true;
      i += 1;
      continue;
    }
    if (tok.startsWith("-") && tok.length > 1) {
      const key = tok.slice(1);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        out.flags[key] = next;
        i += 2;
        continue;
      }
      out.flags[key] = true;
      i += 1;
      continue;
    }
    if (out.command === undefined) {
      out.command = tok;
    } else {
      out.positionals.push(tok);
    }
    i += 1;
  }
  return out;
}

export function flagString(flags: ParsedArgs["flags"], names: string[]): string | undefined {
  for (const n of names) {
    const v = flags[n];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

export function flagBool(flags: ParsedArgs["flags"], names: string[]): boolean {
  for (const n of names) {
    if (flags[n] === true) return true;
    const v = flags[n];
    if (typeof v === "string" && /^(1|true|yes|on)$/i.test(v)) return true;
  }
  return false;
}
