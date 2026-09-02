# AutoCipher

Pipeline **autonome** de génération et publication de **YouTube Shorts** sur des
sujets **tech / data / IA / cloud / finance**, orchestré par **GitHub Actions**.
Chaque vidéo est **publiée directement en public** (aucune étape de validation),
à raison de **4 vidéos/jour** avec une **voix off qui change à chaque run**.

**Budget : 0 €.** Tous les services utilisés ont un palier gratuit permanent.
La génération de texte passe par l'**API Google Gemini** (gratuite), avec
**Groq** en secours — pas d'API payante à l'usage.

---

## Sommaire

- [Ce que fait le pipeline](#ce-que-fait-le-pipeline)
- [Décisions de conception](#décisions-de-conception)
- [Périmètre de contenu](#périmètre-de-contenu-strict)
- [Structure du dépôt](#structure-du-dépôt)
- [Obtenir les clés API](#obtenir-les-clés-api)
- [Authentification OAuth2 YouTube (une seule fois)](#authentification-oauth2-youtube-une-seule-fois)
- [Configurer les secrets GitHub](#configurer-les-secrets-github)
- [Tester en local](#tester-en-local)
- [Fonctionnement en production](#fonctionnement-en-production)
- [Limites connues](#limites-connues)
- [Dépannage](#dépannage)

---

## Ce que fait le pipeline

À chaque exécution planifiée (**4×/jour** — minuit, 8 h, 16 h, 20 h heure de
Côte d'Ivoire), l'orchestrateur `src/orchestrate.js` enchaîne :

| # | Étape | Outil | Fichier |
|---|-------|-------|---------|
| 1 | Sélection d'un thème dans le périmètre autorisé + anti-répétition | — | `src/select_topic.js` |
| 2 | Génération script + métadonnées JSON | **Gemini Flash** (défaut `gemini-3.6-flash`, → Groq `openai/gpt-oss-120b` si échec) | `src/generate_script.js` |
| 3 | Voix off française — **voix tirée au sort à chaque run** (pool FR/BE/CH, H+F) | `edge-tts` | `src/generate_voice.py` |
| 4 | Sous-titres synchronisés mot par mot | `openai-whisper` (local) | `src/generate_subtitles.py` |
| 5 | Images de fond verticales | API **Pexels** | `src/fetch_images.py` |
| 6 | Montage (Ken Burns + sous-titres karaoké + voix + musique) | **Remotion** | `src/render_video.js` + `src/remotion/` |
| 7 | Upload YouTube **directement en `public`** | YouTube Data API v3 | `src/publish_youtube.js` |

En cas d'erreur à **n'importe quelle étape**, le pipeline s'arrête (`exit 1`) :
aucune vidéo incomplète n'est jamais uploadée ni publiée.

---

## Décisions de conception

Choix retenus (modifiables via variables d'environnement / `src/config.js`) :

| Paramètre | Valeur | Variable |
|-----------|--------|----------|
| Format | **Short vertical 1080×1920, ~50 s** | `VIDEO_FORMAT`, `TARGET_DURATION_SECONDS` |
| Volume | **4 vidéos/jour** (4 crons : 00 h, 08 h, 16 h, 20 h) | fréquence des crons dans le workflow |
| Publication | **Directe en `public`** — aucune validation, aucun délai | — |
| Voix off | **edge-tts**, **rotation** dans un pool de 9 voix FR/BE/CH (H+F), la voix change à chaque run et évite les 3 dernières | `TTS_VOICE_POOL`, `TTS_VOICE` (forcer une voix), `TTS_VOICE_AVOID_LAST` |
| Plafond upload/jour | **6** (quota YouTube par défaut : 10 000 u, 1 600 u/upload) | `YOUTUBE_DAILY_UPLOAD_CAP` |

> **Rotation des voix.** `src/generate_voice.py` tire une voix au sort dans
> `DEFAULT_VOICE_POOL` en excluant les dernières utilisées ; l'état est persisté
> dans `src/db/voice.json` (committé par le workflow, donc la rotation continue
> d'un run à l'autre). Pour forcer une voix unique : `TTS_VOICE=fr-FR-HenriNeural`.

---

## Périmètre de contenu (strict)

Seules ces catégories sont autorisées (`src/config.js` → `ALLOWED_CATEGORIES`) :

`developpement-web`, `developpement-mobile`, `developpement-desktop`,
`outils-dev`, `data-analyse`, `data-science`, `intelligence-artificielle`,
`vibe-coding`, `cloud-computing`, `finance`, `economie`.

Le prompt de génération **refuse explicitement** tout autre sujet (actualité
générale, politique, people, santé, « tendances virales »…) et impose :

- **aucune affirmation factuelle non vérifiable** : soit une source est citée
  dans le champ `sources`, soit la formulation reste générale / pédagogique ;
- ton clair, sans hype trompeuse, une idée par phrase.

Si le LLM renvoie une catégorie hors périmètre ou un `refus`, le run **échoue
proprement** (pas de contournement).

---

## Structure du dépôt

```
AutoCipher/
├── .github/workflows/
│   └── generate-and-publish.yml   # cron 4×/jour : génère 1 vidéo + publie en public
├── src/
│   ├── config.js                  # config centrale + périmètre + réservoir de sujets + pool de voix
│   ├── orchestrate.js             # enchaînement de toutes les étapes
│   ├── select_topic.js            # étape 1
│   ├── generate_script.js         # étape 2 — Gemini (+ fallback Groq)
│   ├── generate_voice.py          # étape 3 — edge-tts + rotation des voix
│   ├── generate_subtitles.py      # étape 4 — Whisper
│   ├── fetch_images.py            # étape 5 — Pexels
│   ├── render_video.js            # étape 6 — staging + appel Remotion
│   ├── publish_youtube.js         # étape 7 — upload public + gestion quota
│   ├── oauth_setup.js             # utilitaire OAuth2 YouTube (one-shot, local)
│   ├── lib/                       # logger, store JSON atomique
│   ├── remotion/                  # Root.tsx, Composition.tsx, SubtitleWord.tsx, schema.ts
│   └── db/
│       ├── topics.json            # historique des sujets traités (anti-répétition)
│       ├── voice.json             # état de rotation des voix off
│       └── quota.json             # compteur d'uploads YouTube du jour
├── assets/
│   ├── music/                     # VOS pistes libres de droits (voir assets/music/README.md)
│   └── images/                    # images Pexels téléchargées par run (git-ignoré)
├── public/current/               # assets stagés pour Remotion (git-ignoré)
├── output/                       # sorties par run (git-ignoré)
├── .env.example
├── package.json / requirements.txt
├── remotion.config.ts / tsconfig.json
└── README.md
```

---

## Obtenir les clés API

Toutes gratuites, sans carte bancaire (sauf éventuellement Google Cloud selon
votre compte — l'API YouTube reste dans le palier gratuit).

### 1. Google Gemini — `GEMINI_API_KEY`
1. Aller sur <https://ai.google.dev> (Google AI Studio) → **Get API Key**.
2. Génération instantanée. Vérifier le quota du jour dans AI Studio
   (les paliers évoluent ; à contrôler avant d'augmenter le volume).

### 1 bis. Groq (secours) — `GROQ_API_KEY`
1. <https://console.groq.com> → créer un compte → **API Keys** → nouvelle clé.
2. Gratuit, sans CB. Utilisé automatiquement si Gemini échoue / dépasse son quota.

### 2. Pexels — `PEXELS_API_KEY`
1. <https://www.pexels.com/api/> → créer un compte → clé générée instantanément.

### 3. YouTube Data API v3 — `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN`
1. <https://console.cloud.google.com> → créer un projet.
2. **APIs & Services → Library** → activer **YouTube Data API v3**.
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   → type **Desktop app**. Noter le *Client ID* et le *Client secret*.
4. **OAuth consent screen** : type **External**, statut **Testing** suffit pour
   un usage personnel. Ajouter votre adresse Google dans **Test users**.
   (Pas de passage en revue Google nécessaire pour publier sur votre propre chaîne.)
5. Ajouter `http://localhost:53682` dans les **Authorized redirect URIs** du
   client OAuth.
6. Obtenir le `refresh_token` : voir la section suivante.
7. Quota : par défaut **10 000 unités/jour** (visible dans
   *APIs & Services → Quotas*). Un upload coûte **1 600 u** → **~6 uploads/jour**
   max. Une augmentation se demande via un formulaire Google (revue manuelle).

> Il n'y a **pas** de clé Gmail à configurer : le pipeline ne publie plus
> d'email de validation (publication directe en public).

---

## Authentification OAuth2 YouTube (une seule fois)

En local, avec `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` déjà dans `.env` :

```bash
npm install
npm run oauth-setup
```

1. Le script affiche une URL → l'ouvrir dans le navigateur.
2. Se connecter avec le compte Google **propriétaire de la chaîne YouTube**,
   accepter les permissions (`youtube.upload` + `youtube`).
3. Le terminal affiche `YOUTUBE_REFRESH_TOKEN=1//0g...` → le copier.
4. Le mettre dans `.env` (local) **et** en secret GitHub (production).

> Si aucun refresh token n'apparaît : révoquer l'accès de l'app dans
> <https://myaccount.google.com/permissions> puis relancer `npm run oauth-setup`.

---

## Configurer les secrets GitHub

**Settings → Secrets and variables → Actions → New repository secret**, un par un :

| Secret | Source |
|--------|--------|
| `GEMINI_API_KEY` | Google AI Studio |
| `GROQ_API_KEY` | console.groq.com |
| `PEXELS_API_KEY` | pexels.com/api |
| `YOUTUBE_CLIENT_ID` | Google Cloud Console (OAuth client) |
| `YOUTUBE_CLIENT_SECRET` | Google Cloud Console (OAuth client) |
| `YOUTUBE_REFRESH_TOKEN` | `npm run oauth-setup` |

`GITHUB_TOKEN` est **fourni automatiquement** par GitHub Actions (permission
`contents: write` déjà déclarée dans le workflow, pour committer `src/db/*.json`).

*(Optionnel)* **Variables** (onglet *Variables*, pas *Secrets*) :
`CHANNEL_HANDLE` = `@votrechaine` (affiché en haut de la vidéo).

### Musique

Déposez des pistes **libres de droits** (`.mp3`) dans `assets/music/`
(voir `assets/music/README.md`). En CI, committez-les dans le dépôt **seulement
si leur licence l'autorise**, ou ajoutez une étape de téléchargement depuis une
source vous appartenant. Sans piste, la vidéo est produite **sans musique**.

---

## Tester en local

Prérequis : **Node ≥ 20**, **Python 3.11**, **ffmpeg**, et ~2 Go libres
(modèle Whisper + Chrome headless de Remotion).

```bash
cp .env.example .env         # puis remplir les clés
npm install
pip install -r requirements.txt

# Pipeline complet SANS upload — s'arrête après le rendu :
node src/orchestrate.js --dry-run
# → produit output/<runId>/video.mp4
```

Étapes isolées :

```bash
RUN_DIR=output/test node src/select_topic.js
RUN_DIR=output/test node src/generate_script.js
RUN_DIR=output/test python src/generate_voice.py
RUN_DIR=output/test python src/generate_subtitles.py --model base
RUN_DIR=output/test python src/fetch_images.py
RUN_DIR=output/test node src/render_video.js
npm run remotion:studio          # prévisualiser la composition dans le navigateur
```

Pipeline complet réel (rendu + **upload public direct**) : `node src/orchestrate.js`.

> **ffmpeg** est requis localement pour `edge-tts`/`ffprobe` et le rendu.
> macOS : `brew install ffmpeg`. En CI, il est installé par le workflow.
> **Alternative Whisper plus légère en CI** : remplacer `openai-whisper` par
> `faster-whisper` dans `requirements.txt` et adapter `generate_subtitles.py`
> (garder le même format de sortie `subtitles.json`).

---

## Fonctionnement en production

1. **Activer les workflows** : onglet *Actions* du dépôt → *I understand… enable*.
2. Les 4 crons de `generate-and-publish.yml` produisent **1 vidéo chacun**
   (4/jour, à 00 h / 08 h / 16 h / 20 h heure de Côte d'Ivoire) et l'**uploadent
   directement en `public`**. Il n'y a plus ni issue, ni email, ni délai.
3. La voix off **change à chaque run** (rotation dans le pool, cf. *Décisions de
   conception*).
4. L'état (`src/db/*.json` : `topics.json`, `voice.json`, `quota.json`) est
   **committé automatiquement** dans le dépôt par le workflow (`[skip ci]`), ce
   qui sert d'historique persistant.

> ⚠️ **Plus de garde-fou humain.** Chaque vidéo générée est publiée telle quelle.
> Le seul filtre restant est *préventif* (contraintes du prompt de génération,
> cf. *Périmètre de contenu*). Surveillez la chaîne les premiers jours.

### Rattrapage des vidéos privées (ancien flux)

Les 7 vidéos uploadées en `private` avant ce changement sont listées dans
`src/db/backlog.json`. Pour les rendre publiques d'un coup : onglet *Actions* →
**Rattrapage — publier les vidéos privées en attente** → *Run workflow*
(ou `node src/publish_backlog.js` en local). Ensuite, `backlog.json`,
`src/publish_backlog.js` et `.github/workflows/publish-backlog.yml` peuvent être
supprimés.

---

## Limites connues

- **Quota YouTube** : ~6 uploads/jour avec le quota par défaut. Le compteur
  `src/db/quota.json` bloque tout upload au-delà de `YOUTUBE_DAILY_UPLOAD_CAP`.
  Avec 4 vidéos/jour on reste sous ce plafond (garde une marge pour les
  déclenchements manuels).
- **Minutes GitHub Actions** : dépôt privé = 2 000 min/mois gratuites. Le rendu
  Remotion + Whisper prend ~5–12 min/run, soit ~4×/jour. Sur dépôt **public**,
  les minutes sont illimitées → recommandé.
- **Publication immédiate** : aucune fenêtre de relecture. Une vidéo ratée est
  publique dès la fin du run ; il faut la retirer manuellement sur YouTube.
- **Whisper en CI** : le modèle `base` est mis en cache entre runs ; le premier
  run est plus lent (téléchargement du modèle).
- **Fact-checking** : purement *préventif* (contraintes de prompt). Il ne
  vérifie pas les faits en ligne — d'où le garde-fou humain.
- **Musique** : aucune piste n'est fournie (question de licence). À vous d'en
  ajouter dans `assets/music/`, **libres de droits uniquement**.
- **`madeForKids`** : déclaré `false`. Ajustez si votre contenu s'adresse aux
  enfants (obligation COPPA).

---

## Dépannage

| Symptôme | Piste |
|----------|-------|
| `Aucune clé LLM configurée` | Renseigner `GEMINI_API_KEY` (et/ou `GROQ_API_KEY`). |
| `Le LLM a refusé le sujet` | Le sujet tiré est jugé hors périmètre ; relancer le run. |
| `Plafond d'uploads YouTube atteint` | Normal si 6 uploads déjà faits aujourd'hui (UTC). |
| `videos.insert a échoué … quotaExceeded` | Quota Google réel dépassé ; attendre le reset (minuit Pacifique). |
| Pas de refresh token | Révoquer l'accès dans myaccount.google.com/permissions, relancer `oauth-setup`. |
| La voix ne change pas | Vérifier que `src/db/voice.json` est bien committé par le workflow ; `TTS_VOICE` défini force une voix unique. |
| Rendu Remotion échoue en CI | Vérifier que `ffmpeg` est bien installé (étape du workflow) et la RAM du runner. |
| L'état n'est pas committé | `GITHUB_TOKEN` sans permission `contents: write`. |

---

## Licence & responsabilité

Vous êtes responsable du contenu publié sur votre chaîne. Ce pipeline publie
**automatiquement en public**, sans relecture : surveillez la chaîne de près,
surtout au démarrage, et retirez manuellement toute vidéo problématique.
