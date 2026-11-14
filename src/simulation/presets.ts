/** Scripted demo scenarios (all simulated). Each preset seeds the mission
 * selection and an event schedule; every run remains a deterministic replay
 * (E1) because events are keyed to simulated minutes. */

export interface ScenarioPreset {
  id: string;
  label: string;
  siteId: string;
  description: string;
  closureAtSimMinutes?: number;
  batteryLoss?: { atSimMinutes: number; amountUnits: number };
}

export const PRESETS: ScenarioPreset[] = [
  {
    id: "nominal",
    label: "NOMINAL ROUND TRIP",
    siteId: "SITE-A",
    description: "No events: walk to the overlook, complete the 30 min science stop, walk home.",
  },
  {
    id: "closure",
    label: "PASSAGE CLOSES WHILE SAMPLING",
    siteId: "SITE-B",
    closureAtSimMinutes: 130,
    description:
      "During the science stop the central scarp passage closes. The mission aborts and the return replans from the site via a detour (event geometry from the frozen scenario).",
  },
  {
    id: "tight",
    label: "BATTERY: RESERVE BREACHED",
    siteId: "SITE-B",
    batteryLoss: { atSimMinutes: 160, amountUnits: 45 },
    description:
      "Battery failure during the planned return: base is reachable, but arriving home would breach the 20% reserve — an amber outcome, never shown as success.",
  },
  {
    id: "stranded",
    label: "BATTERY: STRANDED NEAR DELTA TOP",
    siteId: "SITE-B",
    batteryLoss: { atSimMinutes: 100, amountUnits: 70 },
    description:
      "Total battery failure late in the outbound leg: the remaining charge cannot cover the walk home. Playback stops with an explicit failure — no safe exit is invented.",
  },
];
