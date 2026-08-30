/**
 * Job différé — finalise les vidéos en attente.
 *
 * Pour chaque entrée `pending` :
 *  - un commentaire d'issue contenant « STOP » → REJET : la vidéo reste privée,
 *    l'issue est close, l'entrée part en history (status "rejected").
 *  - sinon, si l'heure `publishAfter` est passée → PUBLICATION : la vidéo
 *    passe en `public`, l'issue est close, l'entrée part en history
 *    (status "published").
 *  - sinon → on ne touche à rien (fenêtre d'approbation encore ouverte).
 *
 * Lancé périodiquement par .github/workflows/finalize-publish.yml (cron).
 */
import { fileURLToPath } from "node:url";
import { CONFIG } from "./config.js";
import { readJson, writeJson } from "./lib/store.js";
import { createLogger } from "./lib/logger.js";
import {
  listIssueComments,
  commentIssue,
  closeIssue,
} from "./lib/github.js";
import { setPrivacy } from "./publish_youtube.js";

const logg = createLogger("check_approval");
const STOP_RE = /\bSTOP\b/i;
const REJECT_RE = /\b(STOP|REJET|REJETER|ANNULE(?:R)?|CANCEL)\b/i;

function isRejection(comments) {
  return comments.some((c) => {
    const body = c.body || "";
    // On ignore les commentaires postés par le bot lui-même.
    if (c.user?.type === "Bot" && /AutoCipher/i.test(body)) return false;
    return STOP_RE.test(body) || REJECT_RE.test(body);
  });
}

export async function checkApproval() {
  const db = readJson(CONFIG.paths.pendingDb, { pending: [] });
  const history = readJson(CONFIG.paths.historyDb, { published: [] });
  if (!db.pending.length) {
    logg.info("Aucune vidéo en attente.");
    return { published: 0, rejected: 0, waiting: 0 };
  }

  const now = Date.now();
  const stillPending = [];
  let published = 0;
  let rejected = 0;
  let waiting = 0;

  for (const item of db.pending) {
    try {
      const comments = await listIssueComments(item.issueNumber);

      if (isRejection(comments)) {
        logg.info(`REJET détecté pour "${item.title}" (issue #${item.issueNumber}).`);
        try {
          await setPrivacy(item.videoId, "private");
        } catch (e) {
          logg.warn(`setPrivacy(private) a échoué : ${e.message}`);
        }
        await commentIssue(
          item.issueNumber,
          `❌ **AutoCipher** — publication annulée (STOP reçu). La vidéo reste en privé : ${item.youtubeUrl}`
        );
        await closeIssue(item.issueNumber, "not_planned");
        history.published.push({
          ...item,
          status: "rejected",
          resolvedAt: new Date().toISOString(),
        });
        rejected++;
        continue;
      }

      if (new Date(item.publishAfter).getTime() <= now) {
        logg.info(`Délai écoulé → publication de "${item.title}".`);
        await setPrivacy(item.videoId, "public");
        await commentIssue(
          item.issueNumber,
          `✅ **AutoCipher** — publiée automatiquement (aucun rejet reçu) : ${item.youtubeUrl}`
        );
        await closeIssue(item.issueNumber, "completed");
        history.published.push({
          ...item,
          status: "published",
          resolvedAt: new Date().toISOString(),
        });
        published++;
        continue;
      }

      waiting++;
      stillPending.push(item);
      logg.info(
        `"${item.title}" — fenêtre encore ouverte jusqu'à ${item.publishAfter}.`
      );
    } catch (err) {
      // On garde l'entrée pour réessayer au prochain passage.
      logg.error(
        `Erreur sur l'entrée ${item.id} (issue #${item.issueNumber}) : ${err.message}`
      );
      stillPending.push(item);
      waiting++;
    }
  }

  writeJson(CONFIG.paths.pendingDb, { ...db, pending: stillPending });
  writeJson(CONFIG.paths.historyDb, history);
  logg.info(
    `Bilan : ${published} publiée(s), ${rejected} rejetée(s), ${waiting} en attente.`
  );
  return { published, rejected, waiting };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const res = await checkApproval();
  // Code de sortie 0 même s'il reste des vidéos en attente : c'est nominal.
  console.log(JSON.stringify(res));
}
