# `@ares/sdk`

> ARES Solana Security Tool — programmatic SDK and `ares` CLI for shells, CI runners, and automation.

**Full documentation (architecture, route map, troubleshooting):** [`docs/SDK-CLI.md`](../../docs/SDK-CLI.md).

The SDK wraps the public ARES web API (`/api/chat`, `/api/scan`, `/api/runs`, `/api/findings`, SIWS auth) so you can wire autonomous security checks into any pipeline without learning the wire format yourself.

```bash
npm install -g @ares/sdk         # global CLI: `ares`
npm install @ares/sdk            # programmatic: import { AresClient } from '@ares/sdk'
```

## CLI quickstart

```bash
ares --help

# Point at an instance (defaults to http://127.0.0.1:3000 for local dev).
ares config --base-url https://ares.example.com

# Sign in with your Solana keypair (CI-friendly, non-interactive).
export ARES_KEYPAIR_PATH=$HOME/.config/solana/ci.json
ares login --json

# Use it.
ares whoami
ares chat "audit the diff in src/lib/auth"
ares scan . --model openrouter:deepseek/deepseek-r1
ares run <run_id> --watch
ares findings --json | jq '.findings[] | select(.severity == "HIGH")'
```

### Operator key (no wallet required)

For internal automation, set `ARES_API_KEY` to the deployment's `ASST_WEB_API_KEY`. Operator requests bypass payment and free-tier quotas.

```bash
export ARES_BASE_URL=https://ares.example.com
export ARES_API_KEY=op-key-from-secrets-manager
ares scan .
```

### Exit codes

| Code | Meaning              |
| ---- | -------------------- |
| 0    | OK                   |
| 1    | Generic error        |
| 2    | Bad usage / args     |
| 3    | Authentication required |
| 4    | Payment required (HTTP 402) |
| 5    | Network unreachable  |

## CI runner example (GitHub Actions)

```yaml
- name: ARES scan
  env:
    ARES_BASE_URL: https://ares.example.com
    ARES_KEYPAIR_PATH: ${{ runner.temp }}/ci.json
    ARES_KEYPAIR_JSON: ${{ secrets.ARES_CI_KEYPAIR_JSON }}
  run: |
    npm install -g @ares/sdk
    printf '%s' "$ARES_KEYPAIR_JSON" > "$ARES_KEYPAIR_PATH"
    chmod 600 "$ARES_KEYPAIR_PATH"
    ares login --json
    ares scan . --json | tee scan.json
    run_id=$(jq -r .run_id scan.json)
    ares run "$run_id" --watch --json
    ares findings --json > findings.json
```

## Programmatic usage

```ts
import { AresClient } from "@ares/sdk";

const client = new AresClient({
  baseUrl: process.env.ARES_BASE_URL,
  apiKey: process.env.ARES_API_KEY,    // operator path
});

// or wallet path:
await client.signInWithKeypair({ keypairPath: "/secure/path/id.json" });

const reply = await client.chat("Summarize Anchor PDA risks in this program");
console.log(reply.response);

const queued = await client.scan({ target: "." });
console.log(queued.run_id);
```

### Error handling

```ts
import { AresApiError, AresPaymentRequiredError } from "@ares/sdk";

try {
  await client.scan();
} catch (err) {
  if (err instanceof AresPaymentRequiredError) {
    // 402 — present the WWW-Authenticate challenge to the caller / pay
    console.error("paywall:", err.wwwAuthenticate);
  } else if (err instanceof AresApiError && err.code === "UNAUTHORIZED") {
    // not signed in
  } else {
    throw err;
  }
}
```

## Configuration

| Source                                      | Purpose                                |
| ------------------------------------------- | -------------------------------------- |
| `--base-url` / `ARES_BASE_URL` / config file | API root URL                           |
| `--api-key` / `ARES_API_KEY`                | Operator key (server-side `ASST_WEB_API_KEY`) |
| `--keypair` / `ARES_KEYPAIR_PATH`           | Solana JSON keypair for SIWS sign-in   |
| `--json`                                    | Machine-readable JSON output          |
| `--timeout MS`                              | Per-request timeout (default 60000)   |
| `ARES_HOME` (env)                           | Override config dir (default `~/.asst/`) |

The CLI persists the session JWT and `baseUrl` to `~/.asst/config.json` (chmod 0600). `ares logout` clears it.

## Security

- The session cookie is an HMAC-signed JWT (`ASST_SESSION_SECRET` on the server). The SDK treats it as a bearer secret — file permissions on `~/.asst/config.json` are `0600`.
- Operator keys are sent in `x-api-key`. Use a server-side secret store (GitHub Actions `secrets`, Vault, AWS Secrets Manager) — never commit them.
- The CLI does not transmit your private key. SIWS only signs a domain-bound challenge nonce; the secret bytes never leave your machine.
- The SDK refuses to follow `--base-url` to a host that doesn't return a JSON envelope, so a hijacked DNS won't silently swallow your prompts.

## License

Apache-2.0. See [`LICENSE`](./LICENSE).
