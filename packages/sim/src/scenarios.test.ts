// Every scenario is a legal map: buildings fit and don't overlap, ramps are open, units start on open ground.
import { describe, expect, it } from 'vitest';
import { Grid } from './grid.js';
import { ROSTER, VENT_KIND, footprint, refineryDock, sceneryKind } from './layout.js';
import { SCENARIOS } from './scenarios.js';

describe.each(Object.values(SCENARIOS))('scenario $id', (sc) => {
  const map = new Grid(sc.map.width, sc.map.height);
  const occupied = new Set<number>();

  it('buildings are inside the map and do not overlap', () => {
    for (const b of sc.buildings) {
      const size = footprint(b.type);
      for (let x = b.tx; x < b.tx + size; x++) {
        for (let y = b.ty; y < b.ty + size; y++) {
          expect(map.inBounds(x, y)).toBe(true);
          const k = map.key(x, y);
          expect(occupied.has(k), `${b.type} at ${b.tx},${b.ty} overlaps another building`).toBe(false);
          occupied.add(k);
        }
      }
    }
  });

  it('refinery ramps are open', () => {
    for (const b of sc.buildings.filter((x) => x.type === 'refinery')) {
      for (const [x, y] of [[b.tx + 2, b.ty + 4], [b.tx + 2, b.ty + 5]]) {
        expect(map.inBounds(x, y)).toBe(true);
        expect(occupied.has(map.key(x, y))).toBe(false);
      }
    }
  });

  it('units start on open ground inside the map', () => {
    for (const u of sc.units) {
      const tx = Math.floor(u.gx);
      const ty = Math.floor(u.gy);
      expect(map.inBounds(tx, ty)).toBe(true);
      expect(occupied.has(map.key(tx, ty)), `${u.type} at ${u.gx},${u.gy} starts inside a building`).toBe(false);
    }
  });

  it('every side starts with a building, the human with a refinery and harvester', () => {
    for (const team of Object.keys(sc.players)) expect(sc.buildings.some((b) => b.team === team)).toBe(true);
    for (const b of sc.buildings) expect(ROSTER.buildings as readonly string[]).toContain(b.type);
    for (const u of sc.units) expect(ROSTER.units as readonly string[]).toContain(u.type);
    const human = Object.entries(sc.players).find(([, p]) => p.human)![0];
    expect(sc.buildings.some((b) => b.team === human && b.type === 'refinery')).toBe(true);
    expect(sc.units.some((u) => u.team === human && u.type === 'harvester')).toBe(true);
  });

  it('gravity vents are inside the map, clear of the start, and at the point the two bases mirror around', () => {
    const size = sceneryKind(VENT_KIND).size;
    for (const v of sc.vents ?? []) {
      for (let x = v.tx; x < v.tx + size; x++) {
        for (let y = v.ty; y < v.ty + size; y++) {
          expect(map.inBounds(x, y)).toBe(true);
          expect(occupied.has(map.key(x, y)), `vent at ${v.tx},${v.ty} overlaps a building`).toBe(false);
        }
      }
      // its ore ring (radius ENGINE.ventOreRadius, a little more at its ragged edge) stays off buildings, units and fields
      const reach = 6;
      for (const b of sc.buildings) {
        const n = footprint(b.type);
        expect(Math.max(b.tx - (v.tx + size - 1), v.tx - (b.tx + n - 1), b.ty - (v.ty + size - 1), v.ty - (b.ty + n - 1))).toBeGreaterThan(reach);
      }
      for (const u of sc.units) expect(Math.hypot(u.gx - (v.tx + size / 2), u.gy - (v.ty + size / 2))).toBeGreaterThan(reach);
      for (const f of sc.oreFields) expect(Math.hypot(f.centre.tx - v.tx, f.centre.ty - v.ty)).toBeGreaterThan(reach + f.radius * 1.3);
    }
    if (sc.id === 'skirmish') {
      // the bases are mirror images left to right (tile tx <-> width - 1 - tx; ramps and exits all face +gy, so this
      // is the mirror that keeps them facing into the map for both), and so is the landscape
      const W = sc.map.width;
      expect(sc.mirrorX).toBe(true);
      const mirror = (b: { type: string; tx: number; ty: number }) => ({ type: b.type, tx: W - b.tx - footprint(b.type), ty: b.ty });
      const of = (team: string) => sc.buildings.filter((b) => b.team === team).map(({ type, tx, ty }) => ({ type, tx, ty }));
      expect(of('player').map(mirror)).toEqual(of('enemy'));
      // a refinery's dock is within 0.2 tiles of its mirror image's
      const dock = (team: string) => {
        const r = sc.buildings.find((b) => b.team === team && b.type === 'refinery')!;
        return refineryDock(r.tx, r.ty).dock;
      };
      expect(Math.abs(W - dock('player').gx - dock('enemy').gx)).toBeLessThanOrEqual(0.2 + 1e-9);
      expect(dock('enemy').gy).toBe(dock('player').gy);
      const units = (team: string) => sc.units.filter((u) => u.team === team).map((u) => ({ type: u.type, gx: +u.gx.toFixed(3), gy: u.gy }));
      expect(units('player').map((u) => ({ ...u, gx: +(W - u.gx).toFixed(3) }))).toEqual(units('enemy'));
      const fields = sc.oreFields;
      expect(fields[1].mirrorOf).toBe(0);
      expect(fields[1].centre).toEqual({ tx: W - 1 - fields[0].centre.tx, ty: fields[0].centre.ty });
      for (const v of sc.vents ?? []) expect(W - v.tx - size).toBe(v.tx);
      expect(sc.vents?.length).toBe(1);
    }
  });

  it('ore fields and the camera are on the map', () => {
    for (const f of sc.oreFields) expect(map.inBounds(f.centre.tx, f.centre.ty)).toBe(true);
    expect(map.inBounds(Math.floor(sc.camera.gx), Math.floor(sc.camera.gy))).toBe(true);
  });
});
