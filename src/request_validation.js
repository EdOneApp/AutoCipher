/**
 * Étape 7 — Demande de validation légère avant publication publique.
 *
 * À ce stade la vidéo est DÉJÀ sur YouTube en `private` (visible seulement du
 * propriétaire de la chaîne). On :
 *   1. crée une issue GitHub récapitulative (script + métadonnées + lien) ;
 *   2. envoie un email avec le même résumé (+ la vidéo en pièce jointe si < 20 Mo) ;
 *   3. enregistre une entrée `pending` : elle passera en `public`
 *      automatiquement après APPROVAL_DELAY_HOURS, SAUF si un commentaire
 *      contenant « STOP » est ajouté à l'issue (rejet).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG, requireEnv } from "./config.js";
import { readJson, writeJson } from "./lib/store.js";
import { createLogger } from "./lib/logger.js";
import { createIssue, issueUrl } from "./lib/github.js";
import { sendMail } from "./lib/email.js";

const logg = createLogger("request_validation");
const MAX_ATTACH_BYTES = 20 * 1024 * 1024;

function issueBody({ script, upload, publishAfter, runId }) {
  return `## 🎬 Vidéo en attente de publication

**Titre :** ${script.titre}
**Catégorie :** ${script.categorie}
**Lien YouTube (privé) :** ${upload.url}
**Publication automatique le :** ${publishAfter} (dans ~${CONFIG.approvalDelayHours} h)
**Run :** \`${runId}\`

---

### ✋ Pour ANNULER la publication
Ajoutez un commentaire contenant le mot **STOP** (en majuscules) à cette issue
avant l'heure indiquée. La vidéo restera alors en privé et sera écartée.

Sans commentaire « STOP », la vidéo passera en **public** automatiquement.

---

### Script (voix off)
> ${script.script_complet}

### Découpage
- **Hook :** ${script.hook}
- **Corps :** ${script.corps}
- **CTA :** ${script.cta}

### Métadonnées YouTube
- **Description :**
\`\`\`
${script.description}
\`\`\`
- **Tags :** ${(script.tags || []).join(", ")}
- **Mots-clés images :** ${(script.mots_cles_images || []).join(", ")}
- **Sources citées :** ${(script.sources || []).join(" · ") || "(aucune)"}
- **Fournisseur LLM :** ${script.provider || "?"}

<sub>Issue générée automatiquement par AutoCipher. Label \`validation\`.</sub>`;
}

function emailHtml({ script, upload, publishAfter, issueLink }) {
  return `
  <div style="font-family:Arial,sans-serif;max-width:640px;margin:auto">
    <h2>🎬 ${escapeHtml(script.titre)}</h2>
    <p><b>Catégorie :</b> ${escapeHtml(script.categorie)}<br/>
       <b>YouTube (privé) :</b> <a href="${upload.url}">${upload.url}</a><br/>
       <b>Publication auto le :</b> ${publishAfter} (~${CONFIG.approvalDelayHours} h)</p>
    <p style="background:#fff3cd;border:1px solid #ffe69c;padding:12px;border-radius:8px">
      ✋ <b>Pour annuler :</b> commentez <b>STOP</b> sur
      <a href="${issueLink}">l'issue GitHub</a> avant l'heure indiquée.
      Sinon la vidéo devient publique automatiquement.
    </p>
    <h3>Script</h3>
    <p style="white-space:pre-wrap">${escapeHtml(script.script_complet)}</p>
    <h3>Description YouTube</h3>
    <pre style="white-space:pre-wrap;background:#f5f5f5;padding:10px;border-radius:6px">${escapeHtml(
      script.description
    )}</pre>
    <p><b>Tags :</b> ${escapeHtml((script.tags || []).join(", "))}</p>
    <p style="color:#888;font-size:12px">AutoCipher — pipeline automatique.</p>
  </div>`;
}

const escapeHtml = (s) =>
  String(s || "").replace(/[&<>"]/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
  }[c]));

export async function requestValidation(runDir, upload) {
  requireEnv(["githubToken", "githubRepository"]);
  const script = JSON.parse(
    fs.readFileSync(path.join(runDir, "script.json"), "utf8")
  );
  const runId = path.basename(runDir);
  const now = new Date();
  const publishAfter = new Date(
    now.getTime() + CONFIG.approvalDelayHours * 3600 * 1000
  ).toISOString();

  // 1. Issue GitHub
  const issue = await createIssue({
    title: `🎬 Validation: ${script.titre}`.slice(0, 120),
    body: issueBody({ script, upload, publishAfter, runId }),
    labels: ["validation"],
  });
  const issueLink = issueUrl(issue.number);
  logg.info(`Issue de validation créée : ${issueLink}`);

  // 2. Email
  const attachments = [];
  const videoPath = path.join(runDir, "video.mp4");
  if (
    fs.existsSync(videoPath) &&
    fs.statSync(videoPath).size <= MAX_ATTACH_BYTES
  ) {
    attachments.push({ filename: "preview.mp4", path: videoPath });
  }
  try {
    const messageId = await sendMail({
      subject: `🎬 [AutoCipher] À valider avant ${new Date(publishAfter).toLocaleString(
        "fr-FR"
      )} — ${script.titre}`,
      html: emailHtml({ script, upload, publishAfter, issueLink }),
      text:
        `${script.titre}\n\nYouTube (privé): ${upload.url}\n` +
        `Publication auto: ${publishAfter}\n` +
        `Pour ANNULER: commentez STOP sur ${issueLink}\n\n` +
        `Script:\n${script.script_complet}`,
      attachments,
    });
    logg.info(`Email de validation envoyé (id ${messageId}).`);
  } catch (err) {
    // L'email est un confort : l'issue reste le canal de rejet fiable.
    logg.warn(`Échec envoi email (non bloquant) : ${err.message}`);
  }

  // 3. Entrée pending
  const db = readJson(CONFIG.paths.pendingDb, { pending: [] });
  db.pending.push({
    id: runId,
    title: script.titre,
    category: script.categorie,
    videoId: upload.videoId,
    youtubeUrl: upload.url,
    issueNumber: issue.number,
    issueUrl: issueLink,
    createdAt: now.toISOString(),
    publishAfter,
    status: "pending",
  });
  writeJson(CONFIG.paths.pendingDb, db);
  logg.info(
    `Entrée pending enregistrée (publication auto après ${publishAfter}).`
  );

  return { issueNumber: issue.number, issueUrl: issueLink, publishAfter };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const runDir = process.env.RUN_DIR || CONFIG.paths.output;
  const uploadInfoPath = path.join(runDir, "upload.json");
  if (!fs.existsSync(uploadInfoPath)) {
    console.error(
      "upload.json introuvable — lancez d'abord l'upload (orchestrateur)."
    );
    process.exit(1);
  }
  const upload = JSON.parse(fs.readFileSync(uploadInfoPath, "utf8"));
  console.log(await requestValidation(runDir, upload));
}
