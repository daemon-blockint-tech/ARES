/**
 * Lightweight ANSI helpers. No deps; respects NO_COLOR + non-TTY auto-disable.
 */

const isTTY = !!process.stdout.isTTY;
const noColor = !!process.env.NO_COLOR;
const useColor = isTTY && !noColor;

function wrap(open: number, close: number) {
  return (s: string): string =>
    useColor ? `\u001b[${open}m${s}\u001b[${close}m` : s;
}

export const c = {
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  blue: wrap(34, 39),
  magenta: wrap(35, 39),
  cyan: wrap(36, 39),
  gray: wrap(90, 39),
};

export function logErr(msg: string): void {
  process.stderr.write(`${c.red("error:")} ${msg}\n`);
}

export function logWarn(msg: string): void {
  process.stderr.write(`${c.yellow("warn:")} ${msg}\n`);
}

export function logInfo(msg: string): void {
  process.stderr.write(`${c.dim("info:")} ${msg}\n`);
}

export function logOk(msg: string): void {
  process.stderr.write(`${c.green("ok:")} ${msg}\n`);
}

export function jsonOut(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}
