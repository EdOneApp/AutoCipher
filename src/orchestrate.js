/**
 * Orchestrateur principal — enchaîne toutes les étapes du pipeline.
 *
 * Règle d'or : à la moindre erreur, on s'arrête (exit 1). On ne publie JAMAIS
 * un contenu incomplet. Le sujet n'est ajouté à l'historique qu'une fois la
 * vidéo réellement produite (pas avant), pour ne pas « brûler » un thème si un
 * run échoue en cours de route.
 *
 * Modes :
 *   node src/orchestrate.js            → pipeline complet (jusqu'à la validation)
 *   node src/orchestrate.js --dry-run  → s'arrête après le rendu (pas d'upload,
 *                                        pas d'email, pas d'issue) — pour tester
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { CONFIG } from "./config.js";
import { readJson, writeJson } from "./lib/store.js";
import { createLogger } from "./lib/logger.js";
import { selectTopic } from "./select_topic.js";
import { generateScript } from "./generate_script.js";
import { renderVideo } from "./render_video.js";
import { uploadPrivate } from "./publish_youtube.js";
import { requestValidation } from "./request_validation.js";

const logg = createLogger("orchestrate");
const DRY_RUN = process.argv.includes("--dry-run");
const PYTHON = process.env.PYTHON_BIN || "python3";
const TOTAL_STEPS = DRY_RUN ? 6 : 8;

function runPython(script, runDir, extraArgs = []) {
  const res = spawnSync(
    PYTHON,
    [path.join("src", script), "--run-dir", runDir, ...extraArgs],
    {
      cwd: CONFIG.paths.root,
      stdio: "inherit",
      env: { ...process.env, RUN_DIR: runDir },
    }
  );
  if (res.status !== 0) {
    throw new Error(`${script} a échoué (code ${res.status ?? "signal"}).`);
  }
}

function newRunDir() {
  const id =
    new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d+Z$/, "Z")
      .replace("T", "T") + "";
  const dir = path.join(CONFIG.paths.output, id);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function recordTopicHistory(topic, runId) {
  const db = readJson(CONFIG.paths.topicsDb, { history: [] });
  db.history = db.history || [];
  db.history.push({
    ...topic,
    runId,
    at: new Date().toISOString(),
  });
  // On borne l'historique pour garder le fichier léger.
  const cap = Math.max(CONFIG.topicHistoryLookback * 5, 200);
  if (db.history.length > cap) db.history = db.history.slice(-cap);
  writeJson(CONFIG.paths.topicsDb, db);
}

async function main() {
  const startedAt = Date.now();
  const runDir = newRunDir();
  const runId = path.basename(runDir);
  logg.info(`=== RUN ${runId} (${DRY_RUN ? "DRY-RUN" : "COMPLET"}) ===`);
  logg.info(`Dossier de sortie : ${runDir}`);

  const summary = { runId, runDir, dryRun: DRY_RUN, startedAt: new Date().toISOString() };

  // 1 — Thème
  logg.step(1, TOTAL_STEPS, "Sélection du thème");
  const topic = selectTopic();
  fs.writeFileSync(path.join(runDir, "topic.json"), JSON.stringify(topic, null, 2));
  summary.topic = topic;

  // 2 — Script + métadonnées
  logg.step(2, TOTAL_STEPS, "Génération du script (Gemini → Groq fallback)");
  const script = await generateScript(topic);
  fs.writeFileSync(path.join(runDir, "script.json"), JSON.stringify(script, null, 2));
  summary.title = script.titre;
  summary.category = script.categorie;
  summary.llm = script.provider;

  // 3 — Voix off
  logg.step(3, TOTAL_STEPS, "Voix off (edge-tts)");
  runPython("generate_voice.py", runDir);

  // 4 — Sous-titres
  logg.step(4, TOTAL_STEPS, "Sous-titres synchronisés (Whisper)");
  runPython("generate_subtitles.py", runDir, ["--model", CONFIG.whisperModel]);

  // 5 — Images
  logg.step(5, TOTAL_STEPS, "Récupération d'images (Pexels)");
  runPython("fetch_images.py", runDir);

  // 6 — Montage
  logg.step(6, TOTAL_STEPS, "Montage vidéo (Remotion)");
  const videoPath = await renderVideo(runDir);
  summary.video = videoPath;
  summary.videoBytes = fs.statSync(videoPath).size;

  // Le sujet est maintenant "consommé" : on l'historise.
  recordTopicHistory(topic, runId);

  if (DRY_RUN) {
    summary.finishedAt = new Date().toISOString();
    summary.status = "dry-run-ok";
    fs.writeFileSync(
      path.join(runDir, "summary.json"),
      JSON.stringify(summary, null, 2)
    );
    logg.info(
      `DRY-RUN terminé en ${((Date.now() - startedAt) / 1000).toFixed(0)}s. ` +
        `Vidéo : ${videoPath}`
    );
    return;
  }

  // 7 — Upload YouTube en privé
  logg.step(7, TOTAL_STEPS, "Upload YouTube (privacyStatus=private)");
  const upload = await uploadPrivate(runDir);
  fs.writeFileSync(
    path.join(runDir, "upload.json"),
    JSON.stringify(upload, null, 2)
  );
  summary.youtube = upload;

  // 8 — Demande de validation (issue + email + entrée pending)
  logg.step(8, TOTAL_STEPS, "Demande de validation (issue GitHub + email)");
  const validation = await requestValidation(runDir, upload);
  summary.validation = validation;

  summary.finishedAt = new Date().toISOString();
  summary.status = "pending-validation";
  fs.writeFileSync(
    path.join(runDir, "summary.json"),
    JSON.stringify(summary, null, 2)
  );

  logg.info(
    `RUN ${runId} OK en ${((Date.now() - startedAt) / 1000).toFixed(0)}s. ` +
      `Vidéo privée en ligne, publication auto le ${validation.publishAfter} ` +
      `sauf STOP sur ${validation.issueUrl}`
  );
}

main().catch((err) => {
  logg.error(`ÉCHEC DU PIPELINE : ${err.stack || err.message}`);
  process.exit(1);
});
