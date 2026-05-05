/**
 * Web default: mutating assurance tools stay off unless the operator sets
 * `ASST_WEB_ALLOW_WRITE=1` (trusted private / CI). Import once from the root layout.
 */
if (process.env.ASST_WEB_ALLOW_WRITE !== "1") {
  process.env.ASST_ALLOW_WRITE = "0";
}

export {};
