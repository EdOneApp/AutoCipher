/**
 * Rattrapage ponctuel — bascule en `public` les vidéos restées `private`
 * du temps de l'ancien flux de validation (voir src/db/backlog.json).
 *
 *   node src/publish_backlog.js          → publie toutes les vidéos du backlog
 *   node src/publish_backlog.js --dry-run → liste seulement, ne touche à rien
 *
 * Nécessite YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET / YOUTUBE_REFRESH_TOKEN.
 * Idempotent : re-publier une vidéo déjà publique est sans effet. Les entrées
 * traitées avec succès sont retirées de src/db/backlog.json.
 */
import fs from "node:fs";
import { createLogger } from "./lib/logger.js";
import { setPrivacy } from "./publish_youtube.js";

const logg = createLogger("publish_backlog");
const DRY_RUN = process.argv.includes("--dry-run");
const BACKLOG_PATH = new URL("./db/backlog.json", import.meta.url);

async function main() {
  const raw = JSON.parse(fs.readFileSync(BACKLOG_PATH, "utf8"));
  const videos = Array.isArray(raw.videos) ? raw.videos : [];
  if (!videos.length) {
    logg.info("Backlog vide — rien à faire.");
    return;
  }
  logg.info(`${videos.length} vidéo(s) à publier${DRY_RUN ? " (DRY-RUN)" : ""}.`);

  const remaining = [];
  let ok = 0;
  for (const v of videos) {
    if (DRY_RUN) {
      logg.info(`(dry-run) ${v.videoId} — ${v.title}`);
      remaining.push(v);
      continue;
    }
    try {
      await setPrivacy(v.videoId, "public");
      logg.info(`✅ ${v.videoId} → public — ${v.title}`);
      ok++;
    } catch (err) {
      logg.error(`❌ ${v.videoId} : ${err.message}`);
      remaining.push(v);
    }
  }

  if (!DRY_RUN) {
    fs.writeFileSync(
      BACKLOG_PATH,
      JSON.stringify({ ...raw, videos: remaining }, null, 2) + "\n"
    );
    logg.info(`Bilan : ${ok} publiée(s), ${remaining.length} en échec/restante(s).`);
    if (remaining.length) process.exitCode = 1;
  }
}

main().catch((err) => {
  logg.error(err.stack || err.message);
  process.exit(1);
});
