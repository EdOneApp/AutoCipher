import React from "react";
import {
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

type Props = {
  text: string;
  active: boolean;
  spoken: boolean;
  /** Frame (absolue) où le mot commence à être prononcé. */
  startFrame: number;
};

/**
 * Un mot de sous-titre, style « karaoké » :
 *  - gris quand pas encore prononcé,
 *  - blanc + léger pop + surlignage quand c'est son tour,
 *  - blanc atténué une fois passé.
 */
export const SubtitleWord: React.FC<Props> = ({
  text,
  active,
  spoken,
  startFrame,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const pop = active
    ? spring({
        frame: frame - startFrame,
        fps,
        config: { damping: 12, stiffness: 200, mass: 0.5 },
        durationInFrames: 12,
      })
    : 1;

  const scale = active ? interpolate(pop, [0, 1], [0.82, 1]) : 1;
  const color = active ? "#ffffff" : spoken ? "#dfe6f2" : "#8b93a7";

  return (
    <span
      style={{
        display: "inline-block",
        margin: "0 10px",
        transform: `scale(${scale})`,
        color,
        background: active ? "rgba(88,101,242,0.95)" : "transparent",
        borderRadius: 14,
        padding: active ? "2px 14px" : "2px 0",
        transition: "background 90ms linear",
      }}
    >
      {text}
    </span>
  );
};
