import React, { useEffect, useState } from "react";
import {
  AbsoluteFill,
  Sequence,
  Img,
  staticFile,
  useCurrentFrame,
  interpolate,
  Easing,
  delayRender,
  continueRender,
  cancelRender,
} from "remotion";
import { Audio } from "@remotion/media";
import { Scene, type Mission } from "./Scene";
const amber = "#ffb45e",
  cream = "#f5ead9";
const mono = '"SFMono-Regular",Menlo,Consolas,monospace';
const cuts = [0, 113, 225, 338, 422, 534, 591, 619, 731, 788];
const limit = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
};
function Title({
  eyebrow,
  first,
  second,
  small = false,
}: {
  eyebrow: string;
  first: string;
  second?: string;
  small?: boolean;
}) {
  const f = useCurrentFrame();
  return (
    <div
      style={{
        position: "absolute",
        left: 100,
        top: small ? 660 : 690,
        opacity: interpolate(f, [0, 7], [0, 1], limit),
        translate: `0 ${interpolate(f, [0, 15], [35, 0], { ...limit, easing: Easing.out(Easing.cubic) })}px`,
      }}
    >
      <div
        style={{
          fontFamily: mono,
          fontSize: 19,
          letterSpacing: 5,
          color: amber,
          marginBottom: 20,
        }}
      >
        {eyebrow}
      </div>
      <div
        style={{
          fontSize: small ? 78 : 106,
          lineHeight: 0.98,
          fontWeight: 650,
          letterSpacing: -5,
          textShadow: "0 3px 25px #0008",
        }}
      >
        {first}
        <br />
        {second && <span style={{ color: amber }}>{second}</span>}
      </div>
    </div>
  );
}
function Measure({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit: string;
}) {
  return (
    <div style={{ borderLeft: `2px solid ${amber}`, paddingLeft: 22 }}>
      <div
        style={{
          fontFamily: mono,
          fontSize: 17,
          letterSpacing: 2,
          color: "#c9b8a4",
          marginBottom: 12,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 54, letterSpacing: -2 }}>
        {value}
        <span
          style={{
            fontFamily: mono,
            fontSize: 18,
            color: amber,
            marginLeft: 12,
            letterSpacing: 1,
          }}
        >
          {unit}
        </span>
      </div>
    </div>
  );
}
function Budget({ data }: { data: Mission }) {
  return (
    <div
      style={{
        position: "absolute",
        right: 100,
        top: 320,
        width: 290,
        background: "#15100cdd",
        padding: 34,
        borderTop: `2px solid ${amber}`,
        backdropFilter: "blur(15px)",
      }}
    >
      <div
        style={{
          fontFamily: mono,
          fontSize: 18,
          letterSpacing: 3,
          color: amber,
          marginBottom: 30,
        }}
      >
        ROUND TRIP
      </div>
      <Measure
        label="DISTANCE"
        value={(data.totals.distanceM / 1000).toFixed(2)}
        unit="KM"
      />
      <div style={{ height: 30 }} />
      <Measure
        label="DURATION"
        value={data.totals.minutes.toFixed(0)}
        unit="MIN"
      />
      <div style={{ height: 30 }} />
      <Measure
        label="O₂ / POWER COST"
        value={data.totals.oxygen.toFixed(1)}
        unit="/ 100"
      />
      <div
        style={{
          fontFamily: mono,
          fontSize: 13,
          color: "#a2917f",
          marginTop: 26,
        }}
      >
        SIMULATED BUDGET UNITS
      </div>
    </div>
  );
}
function Helmet({ data }: { data: Mission }) {
  const f = useCurrentFrame();
  const st = data.states[f];
  return (
    <AbsoluteFill
      style={{
        background:
          "radial-gradient(ellipse at center,transparent 45%,#0005 85%,#000a 100%)",
        fontFamily: mono,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: "115px 170px",
          border: "1px solid #ffb45e50",
          borderRadius: "130px 130px 200px 200px",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: 36,
          height: 36,
          border: "1px solid #ffb45e99",
          translate: "-50% -50%",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 225,
          top: 165,
          fontSize: 20,
          letterSpacing: 4,
          color: amber,
        }}
      >
        EVA / ROUTE CAM
      </div>
      <div
        style={{
          position: "absolute",
          right: 225,
          top: 165,
          fontSize: 20,
          color: amber,
        }}
      >
        T+ {st.T.toFixed(0)} MIN
      </div>
      <div
        style={{
          position: "absolute",
          left: 225,
          bottom: 210,
          fontSize: 22,
          lineHeight: 1.9,
        }}
      >
        O₂&nbsp; {st.oxygen.toFixed(1)}
        <br />
        PWR {st.battery.toFixed(1)}
      </div>
      <div
        style={{
          position: "absolute",
          right: 225,
          bottom: 210,
          fontSize: 18,
          color: amber,
          textAlign: "right",
          lineHeight: 1.8,
        }}
      >
        COMPUTED ROUTE
        <br />
        SIMULATED POSITION
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 135,
          width: "100%",
          textAlign: "center",
          fontSize: 45,
          letterSpacing: 8,
        }}
      >
        WALK THE PLAN.
      </div>
    </AbsoluteFill>
  );
}
function Endcard() {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(90deg,#080706ed,#08070699 55%,#08070622)",
        justifyContent: "center",
        paddingLeft: 120,
      }}
    >
      <div
        style={{
          opacity: interpolate(f, [0, 8], [0, 1], limit),
          translate: `${interpolate(f, [0, 18], [45, 0], { ...limit, easing: Easing.out(Easing.cubic) })}px 0`,
        }}
      >
        <div
          style={{
            fontFamily: mono,
            fontSize: 21,
            letterSpacing: 7,
            color: amber,
            marginBottom: 32,
          }}
        >
          PLAN THE WALK. FIND THE WAY HOME.
        </div>
        <div
          style={{
            fontSize: 136,
            fontWeight: 700,
            letterSpacing: -8,
            lineHeight: 0.91,
          }}
        >
          MARS
          <br />
          <span style={{ color: amber }}>SURVIVAL</span>
          <br />
          GUIDE<span style={{ color: amber }}>.</span>
        </div>
        <div
          style={{
            fontSize: 25,
            marginTop: 38,
            color: "#c9b8a4",
            letterSpacing: 2,
          }}
        >
          Real terrain. Decisions that matter.
        </div>
        <div
          style={{
            fontFamily: mono,
            fontSize: 17,
            marginTop: 55,
            color: "#c9b8a4",
          }}
        >
          mars-survival-guide-green.vercel.app{" "}
          <span style={{ color: amber }}>↗</span>
        </div>
      </div>
    </AbsoluteFill>
  );
}
export function Film({ hideOpening = false }: { hideOpening?: boolean }) {
  const f = useCurrentFrame();
  const [data, setData] = useState<Mission | null>(null);
  const [handle] = useState(() => delayRender("Loading verified mission data"));
  useEffect(() => {
    fetch(staticFile("mission.json"))
      .then((r) => {
        if (!r.ok) throw new Error("mission.json missing: run npm run assets");
        return r.json();
      })
      .then((d) => {
        setData(d);
        continueRender(handle);
      })
      .catch(cancelRender);
  }, [handle]);
  if (!data || (hideOpening && f < 113)) return null;
  const mode = f < 113 ? "globe" : f >= 422 && f < 534 ? "helmet" : "terrain";
  const st = data.states[f];
  const cut = cuts.filter((c) => c <= f).at(-1) ?? 0;
  const flash = f === cut && f > 0 ? 0.22 : f === cut + 1 ? 0.07 : 0;
  return (
    <AbsoluteFill
      style={{
        background: "#0d0a08",
        fontFamily: '"Avenir Next","Helvetica Neue",Arial,sans-serif',
        color: cream,
        overflow: "hidden",
      }}
    >
      <Scene data={data} mode={mode} />
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(0deg,#0d0a08db,transparent 43%,transparent 77%,#0d0a0877)",
          pointerEvents: "none",
        }}
      />
      <Sequence from={0} durationInFrames={113} name="01 · Mars / establish">
        <div style={{ position: "absolute", left: 100, top: 230 }}>
          <div
            style={{
              fontFamily: mono,
              color: amber,
              fontSize: 20,
              letterSpacing: 5,
            }}
          >
            MARS SURVIVAL GUIDE
          </div>
          <div
            style={{
              fontSize: 140,
              fontWeight: 650,
              letterSpacing: -8,
              lineHeight: 0.92,
              marginTop: 30,
            }}
          >
            EVERY
            <br />
            STEP
            <br />
            <span style={{ color: amber }}>COUNTS.</span>
          </div>
        </div>
        <div
          style={{
            position: "absolute",
            right: 100,
            bottom: 155,
            fontFamily: mono,
            fontSize: 18,
            color: amber,
            textAlign: "right",
            lineHeight: 1.8,
          }}
        >
          JEZERO CRATER
          <br />
          18.47° N / 77.43° E<br />
          MARS
        </div>
      </Sequence>
      <Sequence from={113} durationInFrames={112} name="02 · Real terrain">
        <Title
          eyebrow="01 / EXPLORE"
          first="REAL MARS."
          second="REAL TERRAIN."
        />
        <div
          style={{
            position: "absolute",
            right: 100,
            top: 200,
            fontFamily: mono,
            textAlign: "right",
            fontSize: 20,
            lineHeight: 1.8,
            color: "#c9b8a4",
          }}
        >
          NASA / MRO CTX
          <br />
          <span style={{ color: amber }}>5.12 × 5.12 KM</span>
          <br />
          20 M PLANNING GRID
        </div>
      </Sequence>
      <Sequence
        from={225}
        durationInFrames={113}
        name="03 · Plan the round trip"
      >
        <Title
          eyebrow="02 / PLAN"
          first="CHOOSE A TARGET."
          second="TRACE YOUR RETURN."
          small
        />
        <Budget data={data} />
      </Sequence>
      <Sequence from={338} durationInFrames={84} name="04 · Working console">
        <AbsoluteFill style={{ background: "#0d0a08" }} />
        <div style={{ position: "absolute", left: 100, top: 235, width: 500 }}>
          <div
            style={{
              fontFamily: mono,
              color: amber,
              fontSize: 20,
              letterSpacing: 4,
              marginBottom: 25,
            }}
          >
            MISSION CONTROL
          </div>
          <div
            style={{
              fontSize: 86,
              fontWeight: 650,
              lineHeight: 1,
              letterSpacing: -5,
            }}
          >
            ONE
            <br />
            CONNECTED
            <br />
            <span style={{ color: amber }}>CONSOLE.</span>
          </div>
          <div
            style={{
              fontSize: 25,
              lineHeight: 1.6,
              color: "#c9b8a4",
              marginTop: 30,
            }}
          >
            Terrain. Routes. Resources.
          </div>
        </div>
        <div
          style={{
            position: "absolute",
            left: 675,
            top: 180,
            width: 1450,
            height: 816,
            rotate: "-3deg",
            boxShadow: "0 20px 80px #000",
            border: "1px solid #ffb45e55",
            scale: interpolate(f, [338, 422], [0.93, 1.01], limit),
          }}
        >
          <Img
            src={staticFile("console.png")}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </div>
      </Sequence>
      {mode === "helmet" && <Helmet data={data} />}
      <Sequence from={534} durationInFrames={57} name="06 · Mission progress">
        <Title eyebrow="03 / EXECUTE" first="FOLLOW THE ROUTE." small />
        <div
          style={{
            position: "absolute",
            right: 100,
            top: 200,
            fontFamily: mono,
            color: amber,
            fontSize: 26,
          }}
        >
          T+ {st.T.toFixed(0)} MIN
        </div>
      </Sequence>
      <Sequence from={591} durationInFrames={28} name="07 · Closure / impact">
        <AbsoluteFill
          style={{
            background: "#160b08e8",
            justifyContent: "center",
            paddingLeft: 115,
          }}
        >
          <div
            style={{
              fontFamily: mono,
              fontSize: 23,
              letterSpacing: 8,
              color: "#ff7a6b",
              marginBottom: 25,
            }}
          >
            SIMULATED EVENT / T+130 MIN
          </div>
          <div
            style={{
              fontSize: 155,
              fontWeight: 700,
              letterSpacing: -8,
              lineHeight: 1,
            }}
          >
            PASSAGE
            <br />
            <span style={{ color: "#ff7a6b" }}>CLOSED.</span>
          </div>
        </AbsoluteFill>
      </Sequence>
      <Sequence from={619} durationInFrames={112} name="08 · Emergency return">
        <Title
          eyebrow="04 / ADAPT"
          first="CONDITIONS CHANGE."
          second="THE ROUTE ADAPTS."
          small
        />
        <div
          style={{
            position: "absolute",
            right: 100,
            top: 205,
            fontFamily: mono,
            textAlign: "right",
            fontSize: 20,
            lineHeight: 1.9,
          }}
        >
          <span style={{ color: "#ff7a6b" }}>■ PASSAGE CLOSED</span>
          <br />
          <span style={{ color: amber }}>— EMERGENCY RETURN</span>
          <br />
          T+ {st.T.toFixed(0)} MIN
        </div>
      </Sequence>
      <Sequence from={731} durationInFrames={57} name="09 · Return verified">
        <Title
          eyebrow="05 / RETURN VERIFIED"
          first={st.phase === "completed" ? "BACK AT BASE." : "RETURN TO BASE."}
          second="RESERVE INTACT."
          small
        />
        <div style={{ position: "absolute", right: 100, top: 260, width: 260 }}>
          <Measure
            label="O₂ REMAINING"
            value={st.oxygen.toFixed(1)}
            unit="/ 100"
          />
          <div style={{ height: 35 }} />
          <Measure
            label="POWER REMAINING"
            value={st.battery.toFixed(1)}
            unit="/ 100"
          />
        </div>
      </Sequence>
      <Sequence
        from={788}
        durationInFrames={112}
        name="10 · Mars Survival Guide"
      >
        <Endcard />
      </Sequence>
      <div
        style={{
          position: "absolute",
          top: 62,
          left: 100,
          right: 100,
          display: "flex",
          justifyContent: "space-between",
          fontFamily: mono,
          fontSize: 16,
          letterSpacing: 3,
          color: "#c9b8a4",
        }}
      >
        <span>
          <span
            style={{
              display: "inline-block",
              width: 9,
              height: 9,
              background: amber,
              marginRight: 15,
            }}
          />
          MSG / JEZERO
        </span>
        <span>
          MISSION SIMULATION <span style={{ color: amber }}>●</span>
        </span>
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 52,
          left: 100,
          right: 100,
          display: "flex",
          justifyContent: "space-between",
          fontFamily: mono,
          fontSize: 14,
          letterSpacing: 2,
          color: "#bcae9d",
        }}
      >
        <span>REAL NASA TERRAIN · SIMULATED MISSION</span>
        <span>DISPLAY RELIEF ×4.5 / ARTISTIC LIGHTING</span>
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          width: `${(f / 899) * 100}%`,
          height: 3,
          background: amber,
        }}
      />
      <AbsoluteFill
        style={{ background: "#fff3dd", opacity: flash, pointerEvents: "none" }}
      />
      <AbsoluteFill
        style={{
          background: "#080706",
          opacity: interpolate(f, [0, 9, 882, 899], [1, 0, 0, 1], limit),
          pointerEvents: "none",
        }}
      />
    </AbsoluteFill>
  );
}
