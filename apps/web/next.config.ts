import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";

/**
 * Load the monorepo's root `.env.local` so the web server sees the same
 * provider keys (GOOGLE_API_KEY, OPENROUTER_API_KEY, …) the CLI uses.
 *
 * Next.js only auto-loads `.env*` files from the app directory
 * (`apps/web/`); it does NOT walk upward to the workspace root. Without
 * this, POST /api/chat throws "GOOGLE_API_KEY is required" even though
 * the key is right there in `<repo>/.env.local`.
 *
 * Precedence: existing process.env > apps/web/.env.local (handled by
 * Next itself) > root .env.local (this file). We pass `override: false`
 * so nothing silently clobbers a key that's already defined in the
 * operator's shell.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootEnv = path.resolve(__dirname, "..", "..", ".env.local");
loadDotenv({ path: rootEnv, override: false });

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    "@solana/wallet-adapter-react",
    "@solana/wallet-adapter-react-ui",
    "@solana/wallet-adapter-base",
    "@solana/wallet-adapter-phantom",
  ],
  /**
   * Silences the "multiple lockfiles" warning we saw during smoke tests:
   * force Next to treat the monorepo root as the trace root rather than
   * guessing from whichever lockfile it finds first.
   */
  outputFileTracingRoot: path.resolve(__dirname, "..", ".."),
  /**
   * Native-module bailouts for server-only deps (e.g. `pg` from optional
   * dashboard paths). Agent orchestration runs in `apps/agent-py`.
   */
  serverExternalPackages: ["pg", "pg-native"],
  webpack: (config, { isServer }) => {
    if (isServer) {
      const nativeExternals = {
        pg: "commonjs pg",
        "pg-native": "commonjs pg-native",
      };
      if (Array.isArray(config.externals)) {
        config.externals.push(nativeExternals);
      } else if (config.externals) {
        config.externals = [config.externals, nativeExternals];
      } else {
        config.externals = [nativeExternals];
      }
    }
    return config;
  },
};

export default nextConfig;
