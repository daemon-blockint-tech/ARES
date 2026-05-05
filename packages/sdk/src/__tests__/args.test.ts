import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs, flagString, flagBool } from "../cli/args.js";

test("parseArgs: subcommand + positionals + long/short flags", () => {
  const r = parseArgs([
    "scan",
    "src/lib",
    "--model",
    "openrouter:foo",
    "--json",
    "-v",
  ]);
  assert.equal(r.command, "scan");
  assert.deepEqual(r.positionals, ["src/lib"]);
  assert.equal(r.flags["model"], "openrouter:foo");
  assert.equal(r.flags["json"], true);
  assert.equal(r.flags["v"], true);
});

test("parseArgs: --key=value form", () => {
  const r = parseArgs(["chat", "--model=openrouter:x", "--json=true"]);
  assert.equal(r.flags["model"], "openrouter:x");
  assert.equal(r.flags["json"], "true");
});

test("parseArgs: -- terminator preserves rest", () => {
  const r = parseArgs(["chat", "hello", "--", "--not-a-flag"]);
  assert.equal(r.command, "chat");
  assert.deepEqual(r.positionals, ["hello"]);
  assert.deepEqual(r.rest, ["--not-a-flag"]);
});

test("flagString prefers first match across aliases", () => {
  const r = parseArgs(["scan", "--target", "x", "-t", "y"]);
  assert.equal(flagString(r.flags, ["target", "t"]), "x");
});

test("flagBool accepts --json or --json=true", () => {
  const a = parseArgs(["chat", "--json"]);
  assert.equal(flagBool(a.flags, ["json"]), true);
  const b = parseArgs(["chat", "--json=yes"]);
  assert.equal(flagBool(b.flags, ["json"]), true);
  const cc = parseArgs(["chat"]);
  assert.equal(flagBool(cc.flags, ["json"]), false);
});
