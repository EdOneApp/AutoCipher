import { z } from "zod";

export const wordSchema = z.object({
  text: z.string(),
  start: z.number(),
  end: z.number(),
});

export const shortSchema = z.object({
  /** Nom de fichier sous public/current/ (ex: "voice.mp3"). */
  audioSrc: z.string(),
  /** Nom de fichier musique sous public/current/, ou "" si aucune. */
  musicSrc: z.string(),
  /** Noms de fichiers image sous public/current/. */
  images: z.array(z.string()),
  words: z.array(wordSchema),
  durationInSeconds: z.number(),
  title: z.string(),
  handle: z.string(),
});

export type ShortProps = z.infer<typeof shortSchema>;
