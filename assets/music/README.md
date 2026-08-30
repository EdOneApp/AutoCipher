# Musique de fond — pistes libres de droits UNIQUEMENT

Déposez ici des fichiers audio (`.mp3`) **libres de droits** pour la musique de
fond des vidéos. Le pipeline en tire une au hasard à chaque montage.

## Règles strictes (protection de la chaîne)

- **Jamais** de musique commerciale, extraits de titres connus, ou audio dont
  vous n'êtes pas certain de la licence → risque Content ID, démonétisation,
  voire suppression de la chaîne.
- Sources acceptées :
  - **YouTube Audio Library** (Studio → Audiothèque) — filtrer sur
    « Aucune attribution requise » de préférence.
  - **Creative Commons** : Free Music Archive, ccMixter, Pixabay Music,
    Incompetech (Kevin MacLeod, CC-BY — pensez à créditer dans la description).
- Si la licence demande une **attribution**, ajoutez la ligne de crédit dans
  `CREDITS.md` de ce dossier ; le générateur de description l'inclura.

## Format attendu

- `.mp3`, stéréo, ~-16 LUFS ou plus bas (la musique est déjà atténuée à ~12 %
  du volume dans le montage, sous la voix off).
- Durée ≥ 60 s (bouclée automatiquement si plus courte).

Ce dossier est ignoré par Git (sauf ce README) : les pistes restent locales /
sur le runner.
