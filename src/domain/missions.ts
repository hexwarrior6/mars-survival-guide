/** Mission locations shown on the Mars globe (public/data/missions.json).
 *
 * A location with a terrain package can be loaded; the rest are future mission
 * areas. The manifest is the only place a new location needs to be added: the
 * app reads its lat/lon for the pin and its `path` for the package.
 */

export interface MissionLocation {
  id: string;
  /** short uppercase label on the pin */
  name: string;
  /** one-line description under the name */
  label: string;
  lat: number;
  lon: number;
  /** package root, e.g. /data/jezero; only for package: true */
  path?: string;
  /** true when a terrain package exists for this location */
  package: boolean;
}

export const FALLBACK_MISSIONS: MissionLocation[] = [
  {
    id: "jezero",
    name: "JEZERO",
    label: "Jezero Crater · western delta",
    lat: 18.47095,
    lon: 77.42716,
    path: "/data/jezero",
    package: true,
  },
];

export function availableMissions(missions: MissionLocation[]): MissionLocation[] {
  return missions.filter((m) => m.package && typeof m.path === "string");
}
