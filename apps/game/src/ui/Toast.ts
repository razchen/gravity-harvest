import { $ } from './dom';

/** One-line message under the resource bar. */
export class Toast {
  private readonly el = $('#toast');
  private timer = 0;

  /** `sound`: called with every message shown (it sounds the ones that refuse or warn). */
  constructor(private readonly sound: (text: string) => void = () => {}) {}

  show(text: string): void {
    this.sound(text);
    this.el.textContent = text;
    this.el.classList.add('show');
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.el.classList.remove('show'), 2400);
  }
}
