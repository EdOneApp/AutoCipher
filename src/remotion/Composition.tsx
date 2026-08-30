import React, { useMemo } from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { SubtitleWord } from "./SubtitleWord";
import type { ShortProps } from "./schema";

const asset = (name: string) => staticFile(`current/${name}`);

/** Fond : images en plein cadre avec effet Ken Burns + fondu enchaîné. */
const KenBurnsImage: React.FC<{
  src: string;
  durationInFrames: number;
  index: number;
}> = ({ src, durationInFrames, index }) => {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [0, durationInFrames], [0, 1], {
    extrapolateRight: "clamp",
  });
  const dir = index % 2 === 0 ? 1 : -1;
  const scale = 1.08 + 0.12 * progress;
  const translateX = dir * 40 * progress;
  const translateY = -30 * progress;
  const opacity = interpolate(frame, [0, 14], [0, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ opacity }}>
      <AbsoluteFill
        style={{
          transform: `scale(${scale}) translate(${translateX}px, ${translateY}px)`,
        }}
      >
        <Img
          src={src}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </AbsoluteFill>
      {/* Dégradé pour lisibilité des sous-titres */}
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(6,8,15,0.55) 0%, rgba(6,8,15,0.15) 35%, rgba(6,8,15,0.35) 62%, rgba(6,8,15,0.9) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};

type Line = {
  words: { text: string; startFrame: number; endFrame: number }[];
  startFrame: number;
  endFrame: number;
};

export const Short: React.FC<ShortProps> = ({
  audioSrc,
  musicSrc,
  images,
  words,
  title,
  handle,
}) => {
  const { fps, durationInFrames } = useVideoConfig();
  const frame = useCurrentFrame();

  // Répartition des images sur toute la durée.
  const imgCount = Math.max(images.length, 1);
  const perImage = Math.ceil(durationInFrames / imgCount);

  // Découpage des mots en lignes de 3–5 mots pour l'affichage.
  const lines: Line[] = useMemo(() => {
    const out: Line[] = [];
    let cur: Line["words"] = [];
    const flush = () => {
      if (!cur.length) return;
      out.push({
        words: cur,
        startFrame: cur[0].startFrame,
        endFrame: cur[cur.length - 1].endFrame,
      });
      cur = [];
    };
    words.forEach((w, i) => {
      cur.push({
        text: w.text,
        startFrame: Math.round(w.start * fps),
        endFrame: Math.round(w.end * fps),
      });
      const longEnough = cur.length >= 4;
      const punctuation = /[.!?…:]$/.test(w.text);
      if ((longEnough && punctuation) || cur.length >= 5 || i === words.length - 1) {
        flush();
      }
    });
    flush();
    return out;
  }, [words, fps]);

  const activeLine =
    lines.find((l) => frame >= l.startFrame - 6 && frame <= l.endFrame + 10) ||
    null;

  return (
    <AbsoluteFill style={{ backgroundColor: "#06080f" }}>
      {images.map((name, i) => (
        <Sequence
          key={name + i}
          from={i * perImage}
          durationInFrames={perImage + 20}
        >
          <KenBurnsImage src={asset(name)} durationInFrames={perImage} index={i} />
        </Sequence>
      ))}

      {/* Handle de chaîne, en haut */}
      <AbsoluteFill
        style={{
          justifyContent: "flex-start",
          alignItems: "center",
          paddingTop: 70,
        }}
      >
        <div
          style={{
            fontFamily: "Inter, Arial, sans-serif",
            fontSize: 34,
            fontWeight: 700,
            color: "rgba(255,255,255,0.9)",
            letterSpacing: 1,
            background: "rgba(0,0,0,0.35)",
            padding: "10px 24px",
            borderRadius: 999,
          }}
        >
          {handle}
        </div>
      </AbsoluteFill>

      {/* Sous-titres synchronisés */}
      <AbsoluteFill
        style={{
          justifyContent: "flex-end",
          alignItems: "center",
          padding: "0 70px 300px",
        }}
      >
        {activeLine && (
          <div
            style={{
              fontFamily: "Inter, Arial, sans-serif",
              fontSize: 72,
              fontWeight: 800,
              lineHeight: 1.25,
              textAlign: "center",
              textShadow: "0 6px 24px rgba(0,0,0,0.7)",
              maxWidth: 900,
            }}
          >
            {activeLine.words.map((w, i) => (
              <SubtitleWord
                key={i}
                text={w.text}
                active={frame >= w.startFrame && frame <= w.endFrame}
                spoken={frame > w.endFrame}
                startFrame={w.startFrame}
              />
            ))}
          </div>
        )}
      </AbsoluteFill>

      {/* Bandeau titre, bas */}
      <AbsoluteFill
        style={{
          justifyContent: "flex-end",
          alignItems: "center",
          paddingBottom: 150,
        }}
      >
        <div
          style={{
            fontFamily: "Inter, Arial, sans-serif",
            fontSize: 30,
            fontWeight: 600,
            color: "rgba(255,255,255,0.75)",
            textAlign: "center",
            maxWidth: 820,
          }}
        >
          {title}
        </div>
      </AbsoluteFill>

      <Audio src={asset(audioSrc)} />
      {musicSrc ? (
        <Audio src={asset(musicSrc)} loop volume={0.12} />
      ) : null}
    </AbsoluteFill>
  );
};
