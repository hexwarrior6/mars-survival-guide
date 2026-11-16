import React from "react";
import { registerRoot, Composition } from "remotion";
import { Film31 } from "./Film31";
const Root = () => (
  <Composition
    id="MarsSurvivalGuide"
    component={Film31}
    durationInFrames={930}
    fps={30}
    width={1920}
    height={1080}
  />
);
registerRoot(Root);
