# AutoCipher

Pipeline **autonome** de génération et publication de **YouTube Shorts** sur des
sujets **tech / data / IA / cloud / finance**, orchestré par **GitHub Actions**,
avec un **garde-fou humain léger** (validation par email + délai automatique).

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
- [Mécanisme de validation](#mécanisme-de-validation)
- [Limites connues](#limites-connues)
- [Dépannage](#dépannage)

---

## Ce que fait le pipeline

À chaque exécution planifiée (**2×/jour**), l'orchestrateur `src/orchestrate.js`
enchaîne :

| # | Étape | Outil | Fichier |
|---|-------|-------|---------|
| 1 | Sélection d'un thème dans le périmètre autorisé + anti-répétition | — | `src/select_topic.js` |
| 2 | Génération script + métadonnées JSON | **Gemini Flash** (défaut `gemini-3.6-flash`, → Groq `openai/gpt-oss-120b` si échec) | `src/generate_script.js` |
| 3 | Voix off française | `edge-tts` | `src/generate_voice.py` |
| 4 | Sous-titres synchronisés mot par mot | `openai-whisper` (local) | `src/generate_subtitles.py` |
| 5 | Images de fond verticales | API **Pexels** | `src/fetch_images.py` |
| 6 | Montage (Ken Burns + sous-titres karaoké + voix + musique) | **Remotion** | `src/render_video.js` + `src/remotion/` |
| 7 | Upload YouTube en **`private`** | YouTube Data API v3 | `src/publish_youtube.js` |
| 8 | Issue GitHub + email de validation + entrée `pending` | Octokit REST + Nodemailer | `src/request_validation.js` |

Puis, séparément, **toutes les 30 min** (`.github/workflows/finalize-publish.yml`) :

| Étape | Description | Fichier |
|-------|-------------|---------|
| Finalisation | Passe la vidéo en **`public`** après 2 h si aucun rejet ; applique les `STOP` | `src/check_approval.js` |

En cas d'erreur à **n'importe quelle étape**, le pipeline s'arrête (`exit 1`) :
aucune vidéo incomplète n'est jamais uploadée ni publiée.

---

## Décisions de conception

Choix retenus (modifiables via variables d'environnement / `src/config.js`) :

| Paramètre | Valeur | Variable |
|-----------|--------|----------|
| Format | **Short vertical 1080×1920, ~50 s** | `VIDEO_FORMAT`, `TARGET_DURATION_SECONDS` |
| Volume | **2 vidéos/jour** (2 crons) | fréquence des crons dans le workflow |
| Validation | **Email + délai auto 2 h** (rejet via commentaire `STOP`) | `APPROVAL_DELAY_HOURS` |
| Voix off | **edge-tts**, `fr-FR-DeniseNeural` | `TTS_VOICE` |
| Plafond upload/jour | **6** (quota YouTube par défaut : 10 000 u, 1 600 u/upload) | `YOUTUBE_DAILY_UPLOAD_CAP` |

> **Pourquoi la vidéo est uploadée en `private` *avant* la validation ?**
> C'est le moyen le plus simple et gratuit d'obtenir un lien de prévisualisation
> fiable, sans avoir à héberger la vidéo ailleurs ni à faire dormir un runner
> GitHub pendant 2 h (ce qui gaspillerait le quota de minutes). Si vous rejetez,
> la vidéo **reste en privé** (ou est supprimée) et n'est jamais rendue visible.

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
│   ├── generate-and-publish.yml   # cron 2×/jour : génère 1 vidéo + demande validation
│   └── finalize-publish.yml       # cron /30min : publie après délai / applique les STOP
├── src/
│   ├── config.js                  # config centrale + périmètre + réservoir de sujets
│   ├── orchestrate.js             # enchaînement de toutes les étapes
│   ├── select_topic.js            # étape 1
│   ├── generate_script.js         # étape 2 — Gemini (+ fallback Groq)
│   ├── generate_voice.py          # étape 3 — edge-tts
│   ├── generate_subtitles.py      # étape 4 — Whisper
│   ├── fetch_images.py            # étape 5 — Pexels
│   ├── render_video.js            # étape 6 — staging + appel Remotion
│   ├── request_validation.js      # étape 7 — issue GitHub + email
│   ├── publish_youtube.js         # étape 8 — upload + gestion quota + changement de visibilité
│   ├── check_approval.js          # job différé — finalisation
│   ├── oauth_setup.js             # utilitaire OAuth2 YouTube (one-shot, local)
│   ├── lib/                       # logger, store JSON atomique, client GitHub, email
│   ├── remotion/                  # Root.tsx, Composition.tsx, SubtitleWord.tsx, schema.ts
│   └── db/
│       ├── topics.json            # historique des sujets traités (anti-répétition)
│       ├── pending.json           # vidéos en attente de passage public
│       ├── history.json           # vidéos publiées / rejetées
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

### 4. Gmail (envoi d'email) — `GMAIL_USER`, `GMAIL_APP_PASSWORD`
1. Activer la **validation en 2 étapes** sur le compte Gmail.
2. <https://myaccount.google.com/apppasswords> → générer un **mot de passe
   d'application** (16 caractères).
3. `GMAIL_USER` = l'adresse ; `GMAIL_APP_PASSWORD` = ce mot de passe
   d'application (jamais le mot de passe principal).
4. Optionnel : `VALIDATION_EMAIL_TO` si le destinataire diffère de `GMAIL_USER`.

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
| `GMAIL_USER` | votre adresse Gmail |
| `GMAIL_APP_PASSWORD` | mot de passe d'application Google |
| `VALIDATION_EMAIL_TO` | *(optionnel)* destinataire de l'email |

`GITHUB_TOKEN` est **fourni automatiquement** par GitHub Actions (permissions
`contents: write` + `issues: write` déjà déclarées dans les workflows).

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

# Pipeline complet SANS upload/email/issue — s'arrête après le rendu :
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

Pipeline complet réel (upload privé + email + issue) : `node src/orchestrate.js`.
Finalisation manuelle : `node src/check_approval.js`.

> **ffmpeg** est requis localement pour `edge-tts`/`ffprobe` et le rendu.
> macOS : `brew install ffmpeg`. En CI, il est installé par le workflow.
> **Alternative Whisper plus légère en CI** : remplacer `openai-whisper` par
> `faster-whisper` dans `requirements.txt` et adapter `generate_subtitles.py`
> (garder le même format de sortie `subtitles.json`).

---

## Fonctionnement en production

1. **Activer les workflows** : onglet *Actions* du dépôt → *I understand… enable*.
2. Les 2 crons de `generate-and-publish.yml` produisent **1 vidéo chacun**
   (2/jour), l'uploadent en **privé** et créent une **issue `validation`** + un
   **email**.
3. `finalize-publish.yml` (toutes les 30 min) passe la vidéo en **public** au
   bout de **2 h** si personne n'a répondu `STOP`.
4. L'état (`src/db/*.json`) est **committé automatiquement** dans le dépôt par les
   workflows (`[skip ci]`), ce qui sert d'historique persistant.

### Recommandation de démarrage (2 premières semaines)

Pour vérifier la fiabilité, augmentez temporairement le délai à
`APPROVAL_DELAY_HOURS: "999"` dans `generate-and-publish.yml` : la vidéo ne
partira alors en public que si **vous** commentez explicitement (ou en abaissant
le délai plus tard). Repassez à `"2"` une fois confiant.

---

## Mécanisme de validation

- **Canal de rejet fiable : l'issue GitHub.** Chaque vidéo en attente a une
  issue avec label `validation`. Y ajouter un commentaire contenant **`STOP`**
  (ou `ANNULER`, `REJET`, `CANCEL`) avant l'échéance ⇒ la vidéo **reste privée**
  et l'issue est close en `not_planned`.
- **Email** : reçu en parallèle, avec le script complet, les métadonnées, le
  lien YouTube privé et (si < 20 Mo) la vidéo en pièce jointe. L'email contient
  le lien direct vers l'issue. *(Répondre au mail ne suffit pas — c'est le
  commentaire d'issue qui fait foi ; l'email est là pour vous notifier.)*
- **Sans rejet** : `check_approval.js` bascule la vidéo en `public`, commente
  l'issue avec le lien final et la close en `completed`.

---

## Limites connues

- **Quota YouTube** : ~6 uploads/jour avec le quota par défaut. Le compteur
  `src/db/quota.json` bloque tout upload au-delà de `YOUTUBE_DAILY_UPLOAD_CAP`.
- **Minutes GitHub Actions** : dépôt privé = 2 000 min/mois gratuites. Le rendu
  Remotion + Whisper prend ~5–12 min/run ; `finalize-publish` ~1 min ×48/jour.
  Sur dépôt **public**, les minutes sont illimitées → recommandé. Sinon,
  espacer `finalize-publish` (`0 */2 * * *`).
- **Fenêtre d'approbation** : la granularité réelle est de 30 min (cron de
  finalisation), donc la publication a lieu entre 2 h 00 et 2 h 30 après l'upload.
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
| `GMAIL … Invalid login` | Utiliser un **mot de passe d'application**, pas le mot de passe du compte. |
| Rendu Remotion échoue en CI | Vérifier que `ffmpeg` est bien installé (étape du workflow) et la RAM du runner. |
| L'issue n'est pas créée | `GITHUB_TOKEN` sans permission `issues: write`, ou `GITHUB_REPOSITORY` absent en local. |

---

## Licence & responsabilité

Vous êtes responsable du contenu publié sur votre chaîne. Ce pipeline est un
outil d'assistance : **gardez le garde-fou humain actif** tant que vous n'avez
pas une confiance élevée dans la qualité des scripts générés.
