/**
 * Étape 2 — Génération du script + métadonnées.
 *
 * LLM principal  : Google Gemini 2.5 Flash (gratuit, GEMINI_API_KEY).
 * Secours        : Groq (llama-3.3-70b-versatile, gratuit, GROQ_API_KEY).
 *
 * Garde-fous imposés par le prompt :
 *  - sujet STRICTEMENT dans le périmètre autorisé, sinon le champ `refus` est
 *    rempli et on régénère / on abandonne le run ;
 *  - aucune affirmation factuelle non vérifiable : soit une source est citée,
 *    soit la formulation reste générale / pédagogique ;
 *  - pas de politique, d'actualité générale, de contenu sensible.
 *
 * Sortie : objet JSON validé + `script_complet` (texte prêt pour la voix off).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG, ALLOWED_CATEGORIES } from "./config.js";
import { createLogger } from "./lib/logger.js";

const logg = createLogger("generate_script");

const WORDS_PER_SECOND = 2.6; // débit voix off FR moyen
const targetWords = Math.round(
  CONFIG.targetDurationSeconds * WORDS_PER_SECOND
);

function buildPrompt(topic) {
  return `Tu es le scénariste d'une chaîne YouTube Shorts francophone sérieuse et
pédagogique, strictement spécialisée dans : développement (web, mobile,
desktop), outils de développement, data analyse, data science, intelligence
artificielle, vibe coding, cloud computing, finance et économie.

SUJET IMPOSÉ :
- catégorie : ${topic.category}
- angle : "${topic.angle}"

RÈGLES ABSOLUES (le non-respect invalide la réponse) :
1. Reste STRICTEMENT dans le périmètre ci-dessus. Aucune actualité générale,
   politique, people, santé, sujet sensible ou "tendance virale". Si l'angle
   demandé sort du périmètre, renvoie {"refus": "<raison>"} et rien d'autre.
2. N'invente AUCUN chiffre, date, citation, nom d'entreprise ou statistique
   que tu ne peux pas justifier. Pour toute affirmation factuelle précise,
   soit tu cites une source vérifiable dans "sources", soit tu reformules de
   manière générale ("souvent", "en général", "l'idée est que..."). En cas de
   doute, privilégie l'explication conceptuelle plutôt que le fait daté.
3. Ton : clair, direct, accessible à un débutant curieux. Pas de hype creuse,
   pas de superlatifs trompeurs.
4. Durée cible ~${CONFIG.targetDurationSeconds}s, soit environ ${targetWords}
   mots au TOTAL pour hook + corps + cta réunis. Reste proche de cette cible.
5. Français correct, phrases courtes, une idée par phrase (bon pour les
   sous-titres synchronisés).

RÉPONDS UNIQUEMENT avec un objet JSON valide, sans texte autour, de la forme :
{
  "categorie": "<une valeur EXACTE parmi: ${ALLOWED_CATEGORIES.join(", ")}>",
  "hook": "<1 à 2 phrases d'accroche>",
  "corps": "<le cœur explicatif, 3 à 6 phrases>",
  "cta": "<1 phrase d'appel à l'action: abonne-toi / commente, etc.>",
  "titre": "<titre YouTube <= 90 caractères, accrocheur mais honnête>",
  "description": "<description YouTube 2-4 phrases + éventuelles sources>",
  "tags": ["<5 à 12 tags pertinents, sans #>"],
  "mots_cles_images": ["<4 à 8 mots-clés EN ANGLAIS pour une banque d'images (Pexels), concrets et visuels>"],
  "sources": ["<0 à 3 sources vérifiables si des faits précis sont cités, sinon liste vide>"],
  "refus": null
}`;
}

function validateScript(raw) {
  if (!raw || typeof raw !== "object") throw new Error("Réponse LLM non-JSON.");
  if (raw.refus) {
    throw new Error(`Le LLM a refusé le sujet (hors périmètre) : ${raw.refus}`);
  }
  const required = ["categorie", "hook", "corps", "cta", "titre", "description"];
  for (const k of required) {
    if (!raw[k] || typeof raw[k] !== "string" || !raw[k].trim()) {
      throw new Error(`Champ manquant ou vide dans le script : ${k}`);
    }
  }
  if (!ALLOWED_CATEGORIES.includes(raw.categorie)) {
    throw new Error(
      `Catégorie hors périmètre renvoyée par le LLM : "${raw.categorie}"`
    );
  }
  const tags = Array.isArray(raw.tags) ? raw.tags.filter(Boolean) : [];
  const imgKw = Array.isArray(raw.mots_cles_images)
    ? raw.mots_cles_images.filter(Boolean)
    : [];
  if (imgKw.length < 2) {
    throw new Error("mots_cles_images insuffisants (< 2).");
  }
  const sources = Array.isArray(raw.sources) ? raw.sources.filter(Boolean) : [];

  const titre = raw.titre.trim().slice(0, 100);
  const script_complet = [raw.hook, raw.corps, raw.cta]
    .map((s) => s.trim())
    .join(" ")
    .replace(/\s+/g, " ");

  const wordCount = script_complet.split(/\s+/).length;
  if (wordCount < 40) {
    throw new Error(`Script trop court (${wordCount} mots).`);
  }
  if (wordCount > targetWords * 1.8) {
    logg.warn(
      `Script long (${wordCount} mots, cible ${targetWords}) — la voix off ` +
        `dépassera peut-être la durée cible.`
    );
  }

  let description = raw.description.trim();
  if (sources.length) {
    description += `\n\nSources :\n- ${sources.join("\n- ")}`;
  }
  description +=
    "\n\n—\nVidéo générée automatiquement. Un correctif ? Commentez, on corrige.";

  return {
    categorie: raw.categorie,
    hook: raw.hook.trim(),
    corps: raw.corps.trim(),
    cta: raw.cta.trim(),
    titre,
    description,
    tags,
    mots_cles_images: imgKw,
    sources,
    script_complet,
    wordCount,
  };
}

function extractJson(text) {
  if (!text) throw new Error("Réponse vide du LLM.");
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Pas d'objet JSON détecté.");
  return JSON.parse(candidate.slice(start, end + 1));
}

// Les paliers gratuits Gemini changent souvent de nom de modèle : on essaie une
// liste de candidats (surchargée par GEMINI_MODEL) et on garde le premier qui répond.
const GEMINI_MODELS = [
  ...(process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL] : []),
  "gemini-3.6-flash",
  "gemini-flash-latest",
  "gemini-2.5-flash",
];

async function callGeminiModel(prompt, model) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${CONFIG.env.geminiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.8,
        maxOutputTokens: 2048,
        responseMimeType: "application/json",
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`Gemini (${model}) HTTP ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts
    ?.map((p) => p.text)
    .join("");
  return extractJson(text);
}

async function callGemini(prompt) {
  let lastErr;
  for (const model of GEMINI_MODELS) {
    try {
      return await callGeminiModel(prompt, model);
    } catch (err) {
      lastErr = err;
      // 404 = modèle indisponible → on tente le suivant ; autre erreur → on arrête.
      if (!/HTTP 404/.test(err.message)) throw err;
      logg.warn(`Gemini modèle indisponible, essai suivant : ${model}`);
    }
  }
  throw lastErr;
}

// Modèle Groq surchargeable par GROQ_MODEL. Défaut : gpt-oss-120b (chemin de
// migration officiel après le retrait de llama-3.3-70b-versatile en juin 2026).
const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";

async function callGroq(prompt) {
  const res = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CONFIG.env.groqKey}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.8,
        max_tokens: 2048,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Tu réponds uniquement avec un objet JSON valide, sans texte autour.",
          },
          { role: "user", content: prompt },
        ],
      }),
    }
  );
  if (!res.ok) {
    throw new Error(`Groq HTTP ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  return extractJson(data?.choices?.[0]?.message?.content);
}

export async function generateScript(topic, { attempts = 2 } = {}) {
  const prompt = buildPrompt(topic);
  const providers = [];
  if (CONFIG.env.geminiKey) providers.push(["gemini", callGemini]);
  if (CONFIG.env.groqKey) providers.push(["groq", callGroq]);
  if (!providers.length) {
    throw new Error(
      "Aucune clé LLM configurée (GEMINI_API_KEY ou GROQ_API_KEY)."
    );
  }

  let lastErr;
  for (const [name, fn] of providers) {
    for (let i = 1; i <= attempts; i++) {
      try {
        logg.info(`Appel ${name} (tentative ${i}/${attempts})`);
        const raw = await fn(prompt);
        const script = validateScript(raw);
        logg.info("Script validé", {
          provider: name,
          categorie: script.categorie,
          mots: script.wordCount,
          titre: script.titre,
        });
        return { ...script, provider: name };
      } catch (err) {
        lastErr = err;
        logg.warn(`${name} échec : ${err.message}`);
      }
    }
  }
  throw new Error(
    `Génération de script impossible après tous les fournisseurs. ` +
      `Dernière erreur : ${lastErr?.message}`
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const runDir = process.env.RUN_DIR || CONFIG.paths.output;
  fs.mkdirSync(runDir, { recursive: true });
  const topicPath = path.join(runDir, "topic.json");
  const topic = fs.existsSync(topicPath)
    ? JSON.parse(fs.readFileSync(topicPath, "utf8"))
    : { category: "intelligence-artificielle", angle: "RAG expliqué simplement" };
  const script = await generateScript(topic);
  fs.writeFileSync(
    path.join(runDir, "script.json"),
    JSON.stringify(script, null, 2)
  );
  logg.info(`Écrit dans ${path.join(runDir, "script.json")}`);
}
