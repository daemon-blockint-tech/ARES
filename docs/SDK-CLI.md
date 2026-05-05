# Developer SDK and `ares` CLI

The package **`@ares/sdk`** is the supported way to drive ARES from **shells**, **GitHub Actions**, **GitLab CI**, and other runners. It exposes:

- a **`ares`** CLI (install globally with `npm install -g @ares/sdk`), and  
- a **`AresClient`** TypeScript class for applications (same HTTP surface as the CLI).

**Source of truth for API shapes:** the Next.js app under `apps/web/app/api/`.  
The SDK **does not** call `apps/agent-py` over HTTP directly: the web tier proxies to the Python engine with internal signing (`apps/web/lib/agentpy-client.ts`). That boundary keeps secrets and billing enforcement on the server.

For a shorter quickstart and the package manifest, see [`packages/sdk/README.md`](../packages/sdk/README.md).

---

## Architecture

```
┌─────────────┐   HTTPS + cookie / x-api-key   ┌──────────────────┐   signed proxy   ┌───────────────┐
│  @ares/sdk  │ ───────────────────────────────► │  apps/web /api/* │ ──────────────►  │ apps/agent-py │
│  ares CLI   │                                  │  Next.js          │                │  Hermes       │
└─────────────┘                                  └──────────────────┘                └───────────────┘
```

- **Wallet identity** uses **Sign-In with Solana (SIWS)** (`/api/auth/challenge`, `/api/auth/verify`). The session is stored in an HTTP-only-style contract as JWT cookie name **`asst_session`**; the CLI persists it under **`~/.asst/config.json`** (see [Configuration](#configuration)).
- **Operator automation** uses header **`x-api-key`** matching the deployment’s **`ASST_WEB_API_KEY`**. That path bypasses end-user billing gates for `/api/chat` and `/api/scan` (see `apps/web/app/api/chat/route.ts`).

---

## Install

| Goal | Command |
| ---- | ------- |
| Global CLI | `npm install -g @ares/sdk` |
| Dependency in a repo | `npm install @ares/sdk` or `pnpm add @ares/sdk` |
| Work on this monorepo from source | `pnpm --filter @ares/sdk build` then `node packages/sdk/dist/bin.js --help` |

---

## CLI command → HTTP route

| Command | Method | Route | Notes |
| ------- | ------ | ----- | ----- |
| `ares login` | `POST` | `/api/auth/challenge` then `/api/auth/verify` | Non-interactive: signs server message with ed25519 keypair. |
| `ares logout` | `POST` | `/api/auth/logout` | Clears server session; CLI also drops local cookie entry. |
| `ares whoami` | `GET` | `/api/auth/me` | Works with or without session; reports `authenticated`. |
| `ares chat …` | `POST` | `/api/chat` | Subject to free tier, wallet quota, then **mppx** HTTP 402 if unpaid. |
| `ares scan …` | `POST` | `/api/scan` | Non-operator: wallet session required (`403` if anonymous). |
| `ares runs` | `GET` | `/api/runs` | Lists run **manifests** available to the server (see route implementation). |
| `ares findings` | `GET` | `/api/findings` | Aggregates findings from assurance/SARIF on the **repo root** the web app resolves. |
| `ares run <id>` | `GET` | `/api/runs/<id>` | Polls a single run by id. **Your deployed app must expose this route** if you rely on the CLI; if you get **404**, the handler may not be present in that build—use dashboard or logs until aligned. |
| `ares config …` | — | — | Writes **`~/.asst/config.json`** only (no network). |

Billing and rate limits for `chat` / `scan` are documented at a product level in [`design/public-web-auth-billing.md`](./design/public-web-auth-billing.md).

---

## Environment variables

| Variable | Used by | Meaning |
| -------- | ------- | ------- |
| `ARES_BASE_URL` | CLI / `AresClient` | Origin of the web app (no trailing slash). Example: `https://your-deployment.example`. |
| `ARES_API_KEY` | CLI / client `apiKey` | Sent as **`x-api-key`**. Must match **`ASST_WEB_API_KEY`** on the server. |
| `ARES_KEYPAIR_PATH` | `ares login` | Path to Solana CLI JSON keypair (64-byte array file). |
| `ARES_HOME` | config file location | If set, config and cookie jar live under `$ARES_HOME/config.json` instead of `~/.asst/config.json`. |
| `NO_COLOR` | CLI stderr | Disable ANSI colors. |

Server-side counterparts (for operators deploying the web app) are listed in [`apps/web/README.md`](../apps/web/README.md) and [`.env.example`](../.env.example).

---

## Authentication modes

### 1. Solana wallet (CI and humans)

1. Ensure **`ASST_SESSION_SECRET`** is set on the web app so JWT cookies can be minted (see `.env.example`).
2. `ares config --base-url <url>`
3. `export ARES_KEYPAIR_PATH=/secure/path/id.json`
4. `ares login --json`
5. Call **`chat`** / **`scan`** as a signed-in wallet user.

### 2. Operator key (automation only)

1. Set **`ASST_WEB_API_KEY`** on the server and the same value in **`ARES_API_KEY`** in CI.
2. `ares chat` / `ares scan` bypass payment and free-tier quotas (intended for trusted runners).

If **`ASST_WEB_API_KEY`** is **unset** on the server, **`requireApiKeyOrPublic`** allows unauthenticated access to routes that use it (see `apps/web/lib/api.ts`)—useful for local dev, **not** for production.

---

## Exit codes

The CLI uses stable exit codes for scripting:

| Code | Meaning |
| ---- | ------- |
| `0` | Success |
| `1` | Generic application error |
| `2` | Bad usage (missing arguments, bad flag) |
| `3` | Auth required or forbidden (`401` / `403` family) |
| `4` | Payment required (**HTTP 402**, mppx) |
| `5` | Network failure (cannot reach `ARES_BASE_URL`) |

---

## Programmatic usage

```typescript
import {
  AresClient,
  AresApiError,
  AresPaymentRequiredError,
} from "@ares/sdk";

const client = new AresClient({
  baseUrl: process.env.ARES_BASE_URL,
  apiKey: process.env.ARES_API_KEY,
});

await client.signInWithKeypair({ keypairPath: process.env.ARES_KEYPAIR_PATH! });
const out = await client.chat("Summarize upgrade authority risks.");
```

Handle **`AresPaymentRequiredError`** when free quota is exhausted and no operator key is used; the server returns **402** with a `WWW-Authenticate: Payment` challenge per [mppx](https://mpp.dev).

---

## Troubleshooting

| Symptom | Likely cause |
| ------- | ------------- |
| `Sign-in is not configured` / `500` on verify | Web missing **`ASST_SESSION_SECRET`** (64 hex chars or 32+ byte secret). |
| `Invalid or reused nonce` | Challenge/verify mismatch (nonce store); retry `ares login`. Under dev HMR, an in-memory nonce store can occasionally desync—re-run login. |
| `503` “No payment methods configured” | **`/api/chat`** or **`/api/scan`** after quotas require mppx rails; set at least one payment env on the web app, or use **`ARES_API_KEY`** operator bypass, or stay within free tier. |
| `401` on `runs` / `findings` | Server has **`ASST_WEB_API_KEY`** set; pass **`ARES_API_KEY`**, or unset the server key only in safe local dev. |
| Engine `500` after `chat` / `scan` accepted | Downstream **agent-py** or LLM provider (see `apps/agent-py` logs and `OPENROUTER_API_KEY` / model env). |

---

## Related documents

| Doc | Topic |
| --- | ----- |
| [`packages/sdk/README.md`](../packages/sdk/README.md) | npm package README, CI YAML snippet |
| [`apps/web/README.md`](../apps/web/README.md) | Web env vars, dashboard, API overview |
| [`docs/design/public-web-auth-billing.md`](./design/public-web-auth-billing.md) | Auth + billing design |
| [`docs/runbooks/agent-py-deploy.md`](./runbooks/agent-py-deploy.md) | Deploying the Python agent |

---

## License

The **`@ares/sdk`** package is licensed under **Apache-2.0**; see [`packages/sdk/LICENSE`](../packages/sdk/LICENSE).
