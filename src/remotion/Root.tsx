import React from "react";
import { Composition } from "remotion";
import { Short } from "./Composition";
import { shortSchema, type ShortProps } from "./schema";

const FPS = 30;

const defaultProps: ShortProps = {
  audioSrc: "voice.mp3",
  musicSrc: "",
  images: [],
  words: [],
  durationInSeconds: 50,
  title: "Aperçu AutoCipher",
  handle: "@autocipher",
};

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="Short"
      component={Short}
      schema={shortSchema}
      defaultProps={defaultProps}
      fps={FPS}
      width={1080}
      height={1920}
      durationInFrames={Math.round(defaultProps.durationInSeconds * FPS)}
      calculateMetadata={({ props }: { props: ShortProps }) => {
        const words = props.words ?? [];
        const lastWordEnd = words.length ? words[words.length - 1].end : 0;
        const secs =
          Math.max(props.durationInSeconds || 0, lastWordEnd) + 1.2; // marge fin
        return {
          durationInFrames: Math.max(FPS, Math.round(secs * FPS)),
        };
      }}
    />
  );
};
