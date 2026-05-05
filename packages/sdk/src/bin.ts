import { runCli } from "./cli/main.js";

runCli(process.argv.slice(2)).then(
  (code) => {
    process.exit(code);
  },
  (err) => {
    // Last-ditch handler — runCli should swallow expected errors.
    process.stderr.write(
      `\u001b[31mfatal:\u001b[39m ${(err as Error).message ?? String(err)}\n`,
    );
    if ((err as Error).stack) {
      process.stderr.write(`${(err as Error).stack}\n`);
    }
    process.exit(1);
  },
);
