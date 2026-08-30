/**
 * Étape 6 — Montage vidéo avec Remotion.
 *
 * - Copie voix + musique (aléatoire) + images dans public/current/
 * - Construit les props et lance `remotion render` (Chrome headless, CPU).
 * - Écrit <RUN_DIR>/video.mp4 et <RUN_DIR>/render.json
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CONFIG } from "./config.js";
import { createLogger } from "./lib/logger.js";

const logg = createLogger("render_video");
const PUBLIC_CURRENT = path.join(CONFIG.paths.root, "public", "current");

function resetStaging() {
  fs.rmSync(PUBLIC_CURRENT, { recursive: true, force: true });
  fs.mkdirSync(PUBLIC_CURRENT, { recursive: true });
}

function pickMusic() {
  if (!fs.existsSync(CONFIG.paths.music)) return "";
  const tracks = fs
    .readdirSync(CONFIG.paths.music)
    .filter((f) => /\.(mp3|m4a|wav|ogg)$/i.test(f));
  if (!tracks.length) {
    logg.warn(
      "Aucune piste dans assets/music/ — vidéo sans musique de fond."
    );
    return "";
  }
  return tracks[Math.floor(Math.random() * tracks.length)];
}

export async function renderVideo(runDir) {
  const script = JSON.parse(
    fs.readFileSync(path.join(runDir, "script.json"), "utf8")
  );
  const subs = JSON.parse(
    fs.readFileSync(path.join(runDir, "subtitles.json"), "utf8")
  );
  const imagesManifest = JSON.parse(
    fs.readFileSync(path.join(runDir, "images.json"), "utf8")
  );
  const voiceMeta = JSON.parse(
    fs.readFileSync(path.join(runDir, "voice.json"), "utf8")
  );

  resetStaging();

  // Voix
  fs.copyFileSync(
    path.join(runDir, "voice.mp3"),
    path.join(PUBLIC_CURRENT, "voice.mp3")
  );

  // Musique (optionnelle)
  const musicFile = pickMusic();
  if (musicFile) {
    fs.copyFileSync(
      path.join(CONFIG.paths.music, musicFile),
      path.join(PUBLIC_CURRENT, musicFile)
    );
  }

  // Images
  const imageNames = [];
  imagesManifest.images.forEach((rel, i) => {
    const abs = path.isAbsolute(rel)
      ? rel
      : path.join(CONFIG.paths.root, rel);
    if (!fs.existsSync(abs)) return;
    const name = `img_${i}${path.extname(abs) || ".jpg"}`;
    fs.copyFileSync(abs, path.join(PUBLIC_CURRENT, name));
    imageNames.push(name);
  });
  if (imageNames.length < 3) {
    throw new Error(`Pas assez d'images stagées (${imageNames.length}).`);
  }

  const durationInSeconds = Math.max(
    voiceMeta.duration || 0,
    subs.duration || 0,
    CONFIG.targetDurationSeconds
  );

  const props = {
    audioSrc: "voice.mp3",
    musicSrc: musicFile || "",
    images: imageNames,
    words: subs.words,
    durationInSeconds,
    title: script.titre,
    handle: process.env.CHANNEL_HANDLE || "@autocipher",
  };

  const propsPath = path.join(runDir, "remotion-props.json");
  fs.writeFileSync(propsPath, JSON.stringify(props, null, 2));

  const outPath = path.join(runDir, "video.mp4");
  const entry = path.join("src", "remotion", "index.ts");
  const args = [
    "remotion",
    "render",
    entry,
    "Short",
    outPath,
    `--props=${propsPath}`,
    "--codec=h264",
    "--concurrency=2",
    "--log=info",
  ];

  logg.info(`Rendu Remotion → ${outPath}`, {
    images: imageNames.length,
    music: musicFile || "(aucune)",
    duration: Number(durationInSeconds.toFixed(1)),
  });

  const res = spawnSync("npx", args, {
    cwd: CONFIG.paths.root,
    stdio: "inherit",
    env: process.env,
  });
  if (res.status !== 0) {
    throw new Error(`Remotion render a échoué (code ${res.status}).`);
  }
  if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 50_000) {
    throw new Error("video.mp4 absente ou trop petite après le rendu.");
  }

  fs.writeFileSync(
    path.join(runDir, "render.json"),
    JSON.stringify(
      {
        video: outPath,
        bytes: fs.statSync(outPath).size,
        durationInSeconds,
        music: musicFile || null,
        images: imageNames.length,
        renderedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );
  return outPath;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const runDir = process.env.RUN_DIR || CONFIG.paths.output;
  const out = await renderVideo(runDir);
  logg.info(`OK — ${out}`);
}
