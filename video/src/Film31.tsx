import React from "react";
import {AbsoluteFill,Freeze,staticFile,useCurrentFrame} from "remotion";
import {Audio} from "@remotion/media";
import {Opening} from "./Opening";
import {Film} from "./Film";
/** Map each shot to its own local authored clock. Keeping the freeze below
 * 930 avoids composition-frame clamping and preserves the complete end card. */
export function Film31(){
 const frame=useCurrentFrame();
 const authoredFrame=Math.round(frame*1049/929);
 return <AbsoluteFill style={{background:"#0d0a08"}}>
  {authoredFrame<263&&<Freeze frame={authoredFrame}><Opening/></Freeze>}
  <Freeze frame={Math.max(0,authoredFrame-150)}><Film hideOpening/></Freeze>
  <Audio src={staticFile("score31.wav")} volume={.95}/>
 </AbsoluteFill>
}
