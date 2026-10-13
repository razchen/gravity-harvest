// What a dev page leaves behind when the sidebar swaps it for another (nav.ts): its Phaser game, observers and
// window listeners. Each page registers its own clean-up with onLeave.
const leaving: (() => void)[] = [];

/** Run `fn` when this page is swapped out. */
export const onLeave = (fn: () => void): void => {
  leaving.push(fn);
};

/** Clean up the current page (newest first). */
export function leave(): void {
  while (leaving.length) {
    try {
      leaving.pop()!();
    } catch (e) {
      console.error(e);
    }
  }
}
