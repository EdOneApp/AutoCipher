/**
 * Étape 1 — Sélection du thème.
 *
 * - Tire un couple (catégorie, angle) dans le périmètre AUTORISÉ uniquement
 *   (src/config.js → ALLOWED_CATEGORIES / TOPIC_POOL).
 * - Refuse tout ce qui a déjà été traité dans les `topicHistoryLookback`
 *   dernières vidéos (anti-répétition).
 * - N'écrit PAS l'historique ici : c'est l'orchestrateur qui l'ajoute une
 *   fois la vidéo réellement produite, pour ne pas « brûler » un sujet si le
 *   run échoue plus loin.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG, ALLOWED_CATEGORIES, TOPIC_POOL } from "./config.js";
import { readJson } from "./lib/store.js";
import { createLogger } from "./lib/logger.js";

const logg = createLogger("select_topic");

export function selectTopic() {
  const db = readJson(CONFIG.paths.topicsDb, { history: [] });
  const recent = new Set(
    (db.history || [])
      .slice(-CONFIG.topicHistoryLookback)
      .map((h) => normalize(h.angle))
  );

  const candidates = [];
  for (const category of ALLOWED_CATEGORIES) {
    for (const angle of TOPIC_POOL[category] || []) {
      if (!recent.has(normalize(angle))) {
        candidates.push({ category, angle });
      }
    }
  }

  let pool = candidates;
  if (pool.length === 0) {
    // Tous les sujets connus ont été vus récemment : on autorise la reprise du
    // plus ancien plutôt que de bloquer le pipeline.
    logg.warn(
      "Tous les sujets du réservoir sont récents — réutilisation autorisée."
    );
    pool = [];
    for (const category of ALLOWED_CATEGORIES) {
      for (const angle of TOPIC_POOL[category] || []) {
        pool.push({ category, angle });
      }
    }
  }

  const chosen = pool[Math.floor(Math.random() * pool.length)];
  const topic = {
    category: chosen.category,
    angle: chosen.angle,
    selectedAt: new Date().toISOString(),
  };

  logg.info("Thème sélectionné", topic);

  if (!ALLOWED_CATEGORIES.includes(topic.category)) {
    throw new Error(
      `Catégorie hors périmètre : ${topic.category} (ne devrait jamais arriver).`
    );
  }
  return topic;
}

const normalize = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Exécution standalone : écrit le thème dans RUN_DIR/topic.json
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const runDir = process.env.RUN_DIR || CONFIG.paths.output;
  fs.mkdirSync(runDir, { recursive: true });
  const topic = selectTopic();
  fs.writeFileSync(
    path.join(runDir, "topic.json"),
    JSON.stringify(topic, null, 2)
  );
  logg.info(`Écrit dans ${path.join(runDir, "topic.json")}`);
}
