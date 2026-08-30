import fs from "node:fs";
import path from "node:path";

/** Lecture JSON tolérante : renvoie `fallback` si absent ou illisible. */
export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

/** Écriture JSON atomique (write tmp + rename) pour éviter un fichier corrompu. */
export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

export function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}
