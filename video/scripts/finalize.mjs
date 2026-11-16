// AAC packet padding can make a 930-frame export slightly longer than 31 s.
// Trim/re-encode audio to an exact 31 s container. Remotion's encoder writes
// full-range pixel data tagged as limited range, which YouTube renders dark,
// so this step also converts the pictures to true limited range (BT.709
// primaries preserved) in the same encode.
// Usage: node scripts/finalize.mjs [deliverables/<output>.mp4]  (relative to this project's root)
import { execFileSync } from "node:child_process";
import { renameSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const relativeTarget =
  process.argv[2] ?? "deliverables/mars-survival-guide-31s-unified-score.mp4";
const target = fileURLToPath(new URL(`../${relativeTarget}`, import.meta.url));
const temp = target.replace(".mp4", ".finalizing.mp4");
execFileSync(
  "ffmpeg",
  [
    "-v",
    "error",
    "-y",
    "-i",
    target,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0",
    "-vf",
    "scale=in_range=full:out_range=limited",
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "16",
    "-pix_fmt",
    "yuv420p",
    "-color_range",
    "tv",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-t",
    "31",
    "-movflags",
    "+faststart",
    temp,
  ],
  { stdio: "inherit" },
);
const info = JSON.parse(
  execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration,size:stream=codec_name,width,height,r_frame_rate,nb_frames,sample_rate,channels",
      "-of",
      "json",
      temp,
    ],
    { encoding: "utf8" },
  ),
);
if (Math.abs(Number(info.format.duration) - 31) > 0.001)
  throw new Error("Final container must be exactly 31 seconds");
renameSync(temp, target);
const verificationName = relativeTarget
  .split("/")
  .pop()
  .replace(".mp4", "")
  .replace("mars-survival-guide-", "verification-");
writeFileSync(
  fileURLToPath(new URL(`../deliverables/${verificationName}.json`, import.meta.url)),
  JSON.stringify(info, null, 2) + "\n",
);
console.log(
  `Finalized: ${info.format.duration}s, ${info.streams[0].nb_frames} frames, ${info.format.size} bytes`,
);
