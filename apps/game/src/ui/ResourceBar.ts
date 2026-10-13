import { $ } from './dom';
import type { HudBridge } from './HudBridge';

/** Credits, power, population. */
export class ResourceBar {
  private readonly credits = $('#credits');
  private readonly power = $('#power');
  private readonly pop = $('#pop');
  private last = -1;

  constructor(private readonly game: HudBridge) {}

  refresh(): void {
    const credits = this.game.credits();
    if (credits !== this.last) {
      this.credits.textContent = credits.toLocaleString();
      if (credits > this.last && this.last >= 0) {
        this.credits.classList.remove('flash');
        void this.credits.offsetWidth; // restart the flash animation
        this.credits.classList.add('flash');
      }
      this.last = credits;
    }
    this.credits.parentElement!.title = `Credits: ${credits.toLocaleString()}`;
    const p = this.game.power();
    this.power.textContent = `${p.used} / ${p.made}`;
    this.power.parentElement!.classList.toggle('low', p.low);
    const pop = this.game.population();
    this.pop.textContent = `${pop.units} / ${pop.cap}`;
  }
}
