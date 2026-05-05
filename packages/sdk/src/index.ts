export {
  AresClient,
  type AresClientOptions,
  type ChatOptions,
  type ScanOptions,
  type SignInWithKeypairOptions,
} from "./client.js";

export {
  AresApiError,
  AresPaymentRequiredError,
  type ApiErrorBody,
  type ApiErrorCode,
  type ApiResponse,
  type ApiSuccessBody,
  type ChallengeResponse,
  type ChatResponse,
  type FindingRow,
  type FindingsListResponse,
  type MeResponse,
  type RunRow,
  type RunsListResponse,
  type ScanResponse,
  type VerifyResponse,
} from "./types.js";

export {
  loadSolanaKeypair,
  defaultSolanaKeypairPath,
  KeypairLoadError,
  type LoadedKeypair,
} from "./auth/keypair.js";

export {
  configDir,
  configPath,
  readConfig,
  writeConfig,
  patchConfig,
  setCookie,
  clearCookie,
  clearAllCookies,
  buildCookieHeader,
  type AresConfig,
} from "./config.js";
