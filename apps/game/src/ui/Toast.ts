import { $ } from './dom';

/** One-line message under the resource bar. */
export class Toast {
  private readonly el = $('#toast');
  private timer = 0;

  show(text: string): void {
    this.el.textContent = text;
    this.el.classList.add('show');
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.el.classList.remove('show'), 2400);
  }
}
