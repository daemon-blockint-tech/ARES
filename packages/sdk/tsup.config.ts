import { defineConfig } from "tsup";

export default defineConfig([
  // Library: dual ESM + CJS with types.
  {
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    target: "node18",
    splitting: false,
    treeshake: true,
  },
  // CLI: ESM only with shebang. Loaded via bin entry.
  {
    entry: { bin: "src/bin.ts" },
    format: ["esm"],
    dts: false,
    sourcemap: true,
    clean: false,
    target: "node18",
    banner: { js: "#!/usr/bin/env node" },
    splitting: false,
    treeshake: true,
  },
]);
