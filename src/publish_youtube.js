/**
 * Étape 7 — Publication YouTube via l'API Data v3 (officielle, gratuite).
 *
 * Flux du pipeline : `uploadVideo(runDir)` publie la vidéo DIRECTEMENT en
 * `public` (coût 1600 u). Il n'y a plus d'étape de validation ni de passage
 * différé privé → public.
 *
 * Garde-fou quota : compteur d'uploads/jour (src/db/quota.json). Au-delà de
 * YOUTUBE_DAILY_UPLOAD_CAP (défaut 6), `uploadVideo` refuse de continuer.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";
import { CONFIG, requireEnv } from "./config.js";
import { readJson, writeJson, todayUtc } from "./lib/store.js";
import { createLogger } from "./lib/logger.js";

const logg = createLogger("publish_youtube");

const CATEGORY_BY_THEME = {
  finance: "27", // Education
  economie: "27",
};
const DEFAULT_CATEGORY_ID = "28"; // Science & Technology

function ytClient() {
  requireEnv(["youtubeClientId", "youtubeClientSecret", "youtubeRefreshToken"]);
  const oauth2 = new google.auth.OAuth2(
    CONFIG.env.youtubeClientId,
    CONFIG.env.youtubeClientSecret
  );
  oauth2.setCredentials({ refresh_token: CONFIG.env.youtubeRefreshToken });
  return google.youtube({ version: "v3", auth: oauth2 });
}

function checkAndBumpQuota() {
  const q = readJson(CONFIG.paths.quotaDb, { date: "1970-01-01", uploads: 0 });
  const today = todayUtc();
  const uploads = q.date === today ? q.uploads : 0;
  if (uploads >= CONFIG.youtubeDailyUploadCap) {
    throw new Error(
      `Plafond d'uploads YouTube atteint pour aujourd'hui ` +
        `(${uploads}/${CONFIG.youtubeDailyUploadCap}). Réessai demain.`
    );
  }
  writeJson(CONFIG.paths.quotaDb, {
    date: today,
    uploads: uploads + 1,
    _comment: q._comment,
  });
  return uploads + 1;
}

export async function uploadVideo(runDir, { privacyStatus = "public" } = {}) {
  const script = JSON.parse(
    fs.readFileSync(path.join(runDir, "script.json"), "utf8")
  );
  const videoPath = path.join(runDir, "video.mp4");
  if (!fs.existsSync(videoPath)) {
    throw new Error(`video.mp4 introuvable dans ${runDir}`);
  }

  const used = checkAndBumpQuota();
  logg.info(`Quota upload du jour : ${used}/${CONFIG.youtubeDailyUploadCap}`);

  const youtube = ytClient();
  const categoryId =
    CATEGORY_BY_THEME[script.categorie] || DEFAULT_CATEGORY_ID;

  const tags = Array.isArray(script.tags) ? script.tags.slice(0, 15) : [];
  // Un Short vertical <60s est détecté automatiquement ; #Shorts aide.
  const description = `${script.description}\n\n#Shorts`;

  logg.info(`Upload en cours (privacyStatus=${privacyStatus})...`, {
    titre: script.titre,
    categoryId,
  });

  let res;
  try {
    res = await youtube.videos.insert({
      part: ["snippet", "status"],
      requestBody: {
        snippet: {
          title: script.titre.slice(0, 100),
          description: description.slice(0, 4900),
          tags,
          categoryId,
          defaultLanguage: "fr",
          defaultAudioLanguage: "fr",
        },
        status: {
          privacyStatus,
          selfDeclaredMadeForKids: false,
          madeForKids: false,
        },
      },
      media: { body: fs.createReadStream(videoPath) },
    });
  } catch (err) {
    // L'upload a peut-être échoué AVANT de consommer le quota réel : on ne
    // sait pas de façon fiable, donc on garde le compteur incrémenté (prudent).
    throw new Error(`videos.insert a échoué : ${err.message}`);
  }

  const videoId = res.data.id;
  const url = `https://youtu.be/${videoId}`;
  logg.info(`Upload OK — ${url} (${privacyStatus})`);

  // Miniature optionnelle
  const thumb = path.join(runDir, "thumbnail.jpg");
  if (fs.existsSync(thumb)) {
    try {
      await youtube.thumbnails.set({
        videoId,
        media: { body: fs.createReadStream(thumb) },
      });
      logg.info("Miniature envoyée.");
    } catch (err) {
      logg.warn(`Échec envoi miniature (non bloquant) : ${err.message}`);
    }
  }

  return { videoId, url, privacyStatus };
}

export async function setPrivacy(videoId, privacyStatus) {
  const youtube = ytClient();
  await youtube.videos.update({
    part: ["status"],
    requestBody: {
      id: videoId,
      status: { privacyStatus },
    },
  });
  logg.info(`Vidéo ${videoId} → privacyStatus=${privacyStatus}`);
}

export async function deleteVideo(videoId) {
  const youtube = ytClient();
  await youtube.videos.delete({ id: videoId });
  logg.info(`Vidéo ${videoId} supprimée.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [, , cmd, arg] = process.argv;
  if (cmd === "upload") {
    const runDir = arg || process.env.RUN_DIR || CONFIG.paths.output;
    console.log(await uploadVideo(runDir));
  } else if (cmd === "public" && arg) {
    await setPrivacy(arg, "public");
  } else if (cmd === "private" && arg) {
    await setPrivacy(arg, "private");
  } else if (cmd === "delete" && arg) {
    await deleteVideo(arg);
  } else {
    console.log(
      "Usage: node src/publish_youtube.js <upload [runDir] | public <id> | private <id> | delete <id>>"
    );
    process.exit(1);
  }
}
