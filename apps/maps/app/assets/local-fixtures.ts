import type { CameraState, WorldSource } from "@jackharrhy/tea-maps-renderer";

declare const LOCAL_FIXTURES_ENABLED: boolean;

export interface LocalFixture {
  readonly id: string;
  readonly label: string;
  readonly namespace?: string;
  readonly aliases: readonly string[];
  readonly source: WorldSource;
  readonly camera?: {
    readonly position: readonly [number, number, number];
    readonly yawDegrees: number;
    readonly pitchDegrees: number;
    readonly fieldOfView: number;
  };
  readonly walkability?: string;
}

export async function loadLocalFixtures(): Promise<LocalFixture[]> {
  if (!LOCAL_FIXTURES_ENABLED) return [];
  const response = await fetch("/local-fixtures.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`Local fixtures: HTTP ${response.status}`);
  return (await response.json()) as LocalFixture[];
}

export function fixtureCamera(fixture: LocalFixture): CameraState | undefined {
  const camera = fixture.camera;
  if (!camera) return undefined;
  return {
    position: [...camera.position],
    yaw: (camera.yawDegrees * Math.PI) / 180,
    pitch: (camera.pitchDegrees * Math.PI) / 180,
    fieldOfView: camera.fieldOfView,
  };
}
