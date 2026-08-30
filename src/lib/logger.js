const ts = () => new Date().toISOString();

function line(level, scope, msg, extra) {
  const base = `[${ts()}] ${level.padEnd(5)} ${scope ? `(${scope}) ` : ""}${msg}`;
  if (extra !== undefined) {
    return `${base} ${typeof extra === "string" ? extra : JSON.stringify(extra)}`;
  }
  return base;
}

export function createLogger(scope = "") {
  return {
    info: (msg, extra) => console.log(line("INFO", scope, msg, extra)),
    warn: (msg, extra) => console.warn(line("WARN", scope, msg, extra)),
    error: (msg, extra) => console.error(line("ERROR", scope, msg, extra)),
    step: (n, total, msg) =>
      console.log(line("STEP", scope, `${n}/${total} — ${msg}`)),
  };
}

export const log = createLogger();
