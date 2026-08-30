/**
 * Utilitaire À LANCER UNE SEULE FOIS en local pour obtenir le
 * YOUTUBE_REFRESH_TOKEN (ensuite stocké en secret GitHub).
 *
 *   1. Crée des identifiants OAuth2 "Application de bureau" dans
 *      console.cloud.google.com et mets YOUTUBE_CLIENT_ID / _SECRET dans .env
 *   2. Ajoute http://localhost:53682 comme URI de redirection autorisé
 *   3. node src/oauth_setup.js
 *   4. Autorise dans le navigateur ; le refresh token s'affiche ici.
 *
 * Écran de consentement en mode "Test" : ajoute ton adresse Google comme
 * utilisateur de test. Aucun passage en revue Google n'est nécessaire pour un
 * usage limité à ta propre chaîne.
 */
import http from "node:http";
import { google } from "googleapis";
import { CONFIG } from "./config.js";

const REDIRECT = "http://localhost:53682";
const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube",
];

if (!CONFIG.env.youtubeClientId || !CONFIG.env.youtubeClientSecret) {
  console.error(
    "YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET manquants dans .env"
  );
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(
  CONFIG.env.youtubeClientId,
  CONFIG.env.youtubeClientSecret,
  REDIRECT
);

const authUrl = oauth2.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: SCOPES,
});

const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith("/?")) {
    res.writeHead(404);
    res.end();
    return;
  }
  const code = new URL(req.url, REDIRECT).searchParams.get("code");
  if (!code) {
    res.writeHead(400);
    res.end("Pas de code dans la réponse.");
    return;
  }
  try {
    const { tokens } = await oauth2.getToken(code);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      "<h2>OK — refresh token récupéré.</h2><p>Retourne au terminal.</p>"
    );
    console.log("\n=====================================================");
    if (tokens.refresh_token) {
      console.log("YOUTUBE_REFRESH_TOKEN=" + tokens.refresh_token);
    } else {
      console.log(
        "Aucun refresh_token renvoyé. Révoque l'accès de l'app dans " +
          "https://myaccount.google.com/permissions puis relance ce script."
      );
    }
    console.log("=====================================================\n");
  } catch (err) {
    res.writeHead(500);
    res.end("Erreur : " + err.message);
    console.error(err);
  } finally {
    server.close();
    setTimeout(() => process.exit(0), 500);
  }
});

server.listen(53682, () => {
  console.log("Ouvre cette URL dans ton navigateur :\n");
  console.log(authUrl + "\n");
});
