import React from "react";
import { AbsoluteFill, Sequence, staticFile } from "remotion";
import { Audio } from "@remotion/media";
import { Opening } from "./Opening";
import { Film } from "./Film";
export function Film35() {
  return (
    <AbsoluteFill style={{ background: "#0d0a08" }}>
      <Sequence
        from={0}
        durationInFrames={263}
        name="Continuous Mars → Jezero → mission approach"
      >
        <Opening />
      </Sequence>
      <Sequence
        from={150}
        durationInFrames={900}
        name="Mission feature montage"
      >
        <Film hideOpening />
      </Sequence>
      <Audio src={staticFile("score35.wav")} volume={0.85} />
    </AbsoluteFill>
  );
}
