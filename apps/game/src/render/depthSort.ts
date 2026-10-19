import type Phaser from 'phaser';

/**
 * The depths being sorted, read once into plain numbers. They're read from `_depth`, the field behind `depth` (as
 * Phaser's own sort does): the getter costs a call per object, which over the whole list was most of the sort.
 */
let depths = new Float64Array(1024);

/** A game object, as far as sorting goes. */
export interface Depthed {
  _depth: number;
}

/**
 * Sorts `list` by depth in place, keeping things of equal depth in the order they're in (as Phaser's own sort does),
 * by insertion: almost free when the list is nearly in order already, which it is from one frame to the next (a few
 * hundred units move a little, a few effects are added; the thousands of trees and decals stay put). Gives up,
 * returning false, once it has moved things more than `budget` places in all; the list is then partly sorted, still
 * stably, for a full sort to finish.
 */
export function insertionSortByDepth(list: Depthed[], budget = list.length * 32): boolean {
  const n = list.length;
  if (depths.length < n) depths = new Float64Array(n * 2);
  const ds = depths;
  for (let i = 0; i < n; i++) ds[i] = list[i]._depth;
  let moves = 0;
  for (let i = 1; i < n; i++) {
    const d = ds[i];
    if (ds[i - 1] <= d) continue;
    const o = list[i];
    let j = i - 1;
    while (j >= 0 && ds[j] > d) {
      ds[j + 1] = ds[j];
      list[j + 1] = list[j];
      j--;
    }
    ds[j + 1] = d;
    list[j + 1] = o;
    moves += i - 1 - j;
    if (moves > budget) return false;
  }
  return true;
}

const byDepth = (a: Depthed, b: Depthed) => a._depth - b._depth;

/**
 * The scene's display list sorts itself with an insertion sort ahead of Phaser's full sort (the same order: both are
 * stable). Every frame a unit moves its depth changes, and each change has the whole list re-sorted, scenery and all.
 */
export function useIncrementalDepthSort(scene: Phaser.Scene): void {
  const list = scene.sys.displayList;
  list.depthSort = () => {
    if (!list.sortChildrenFlag) return;
    const items = list.list as unknown as Depthed[];
    if (!insertionSortByDepth(items)) items.sort(byDepth); // (stable, as Phaser's own sort)
    list.sortChildrenFlag = false;
  };
}
