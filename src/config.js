// dotenv est optionnel : en GitHub Actions les variables viennent des secrets,
// et on veut pouvoir lancer les scripts sans `npm install` complet.
try {
  await import("dotenv/config");
} catch {
  /* pas de .env : on se contente de process.env */
}
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "..");

const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

/**
 * Périmètre de contenu autorisé. TOUT sujet hors de ces catégories doit être
 * refusé par le générateur de script (garde-fou anti-dérive / désinformation).
 */
export const ALLOWED_CATEGORIES = [
  "developpement-web",
  "developpement-mobile",
  "developpement-desktop",
  "outils-dev",
  "data-analyse",
  "data-science",
  "intelligence-artificielle",
  "vibe-coding",
  "cloud-computing",
  "finance",
  "economie",
];

/**
 * Réservoir de sous-sujets par catégorie. Sert de graine à la sélection ;
 * le LLM affine ensuite l'angle. Rien ici ne sort du périmètre autorisé.
 */
export const TOPIC_POOL = {
  "developpement-web": [
    "les nouveautés de React 19",
    "pourquoi tout le monde parle de HTMX",
    "Server Components expliqués simplement",
    "Vite vs Webpack en 2026",
    "les Web Components sont-ils enfin prêts",
    "Tailwind CSS : pour ou contre",
  ],
  "developpement-mobile": [
    "Flutter vs React Native aujourd'hui",
    "Kotlin Multiplatform en production",
    "les Progressive Web Apps en 2026",
    "SwiftUI : ce qui a changé",
  ],
  "developpement-desktop": [
    "Tauri, l'alternative légère à Electron",
    "pourquoi Electron consomme autant de RAM",
    "créer une app desktop avec Rust",
  ],
  "outils-dev": [
    "les raccourcis Git que personne n'utilise",
    "pourquoi passer à un terminal moderne",
    "les extensions VS Code qui font gagner du temps",
    "comprendre le monorepo en 60 secondes",
    "Docker expliqué à un débutant",
  ],
  "data-analyse": [
    "Polars vs Pandas : le match",
    "DuckDB, la base analytique dans un fichier",
    "les erreurs classiques en visualisation de données",
    "SQL : les fenêtres analytiques expliquées",
  ],
  "data-science": [
    "feature engineering en 60 secondes",
    "pourquoi vos modèles overfittent",
    "MLflow pour suivre vos expériences",
    "le piège du data leakage",
  ],
  "intelligence-artificielle": [
    "RAG expliqué simplement",
    "fine-tuning vs prompt engineering",
    "ce qu'est vraiment un embedding",
    "les agents IA, hype ou réalité",
    "quantization des modèles : pourquoi ça marche",
    "MoE : les modèles à mélange d'experts",
  ],
  "vibe-coding": [
    "coder une app entière au prompt : mon retour",
    "les bonnes pratiques du vibe coding",
    "quand NE PAS faire confiance à l'IA qui code",
  ],
  "cloud-computing": [
    "serverless : quand ça coûte plus cher",
    "comprendre les zones de disponibilité",
    "l'egress, ce coût cloud qu'on oublie",
    "Kubernetes est-il vraiment nécessaire",
  ],
  "finance": [
    "les intérêts composés en 60 secondes",
    "ETF vs actions individuelles",
    "ce qu'est un ratio de Sharpe",
    "diversification : le seul repas gratuit",
  ],
  "economie": [
    "l'inflation expliquée avec un panier de courses",
    "pourquoi les banques centrales montent les taux",
    "PIB : ce que ce chiffre ne dit pas",
    "l'effet de la démographie sur la croissance",
  ],
};

export const CONFIG = {
  videoFormat: process.env.VIDEO_FORMAT || "short",
  width: 1080,
  height: 1920,
  fps: 30,
  targetDurationSeconds: num(process.env.TARGET_DURATION_SECONDS, 50),
  topicHistoryLookback: num(process.env.TOPIC_HISTORY_LOOKBACK, 40),
  whisperModel: process.env.WHISPER_MODEL || "base",
  // Voix off : rotation gérée par src/generate_voice.py (pool ci-dessous).
  // `ttsVoice` ne sert que si on veut FORCER une voix unique via l'env.
  ttsVoice: process.env.TTS_VOICE || "",
  ttsVoicePool: (
    process.env.TTS_VOICE_POOL ||
    [
      "fr-FR-DeniseNeural",
      "fr-FR-HenriNeural",
      "fr-FR-EloiseNeural",
      "fr-FR-RemyMultilingualNeural",
      "fr-FR-VivienneMultilingualNeural",
      "fr-BE-CharlineNeural",
      "fr-BE-GerardNeural",
      "fr-CH-ArianeNeural",
      "fr-CH-FabriceNeural",
    ].join(",")
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  youtubeDailyUploadCap: num(process.env.YOUTUBE_DAILY_UPLOAD_CAP, 6),
  imagesPerVideo: 6,

  paths: {
    root: ROOT,
    output: path.join(ROOT, "output"),
    music: path.join(ROOT, "assets", "music"),
    images: path.join(ROOT, "assets", "images"),
    topicsDb: path.join(ROOT, "src", "db", "topics.json"),
    quotaDb: path.join(ROOT, "src", "db", "quota.json"),
    voiceDb: path.join(ROOT, "src", "db", "voice.json"),
  },

  env: {
    geminiKey: process.env.GEMINI_API_KEY || "",
    groqKey: process.env.GROQ_API_KEY || "",
    pexelsKey: process.env.PEXELS_API_KEY || "",
    youtubeClientId: process.env.YOUTUBE_CLIENT_ID || "",
    youtubeClientSecret: process.env.YOUTUBE_CLIENT_SECRET || "",
    youtubeRefreshToken: process.env.YOUTUBE_REFRESH_TOKEN || "",
    gmailUser: process.env.GMAIL_USER || "",
    gmailAppPassword: process.env.GMAIL_APP_PASSWORD || "",
    validationEmailTo:
      process.env.VALIDATION_EMAIL_TO || process.env.GMAIL_USER || "",
    githubToken: process.env.GITHUB_TOKEN || "",
    githubRepository: process.env.GITHUB_REPOSITORY || "",
  },
};

export function requireEnv(keys) {
  const missing = keys.filter((k) => !CONFIG.env[k]);
  if (missing.length) {
    throw new Error(
      `Variables d'environnement manquantes : ${missing.join(", ")}. ` +
        `Voir .env.example.`
    );
  }
}
