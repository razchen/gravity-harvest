import type { ToastCode } from '../data/toasts';
import { $ } from './dom';

/** One-line message under the resource bar. */
export class Toast {
  private readonly el = $('#toast');
  private timer = 0;

  /** `sound`: called with every message shown, with its code if it has one (it sounds the ones that refuse). */
  constructor(private readonly sound: (code: ToastCode | undefined) => void = () => {}) {}

  show(text: string, code?: ToastCode): void {
    this.sound(code);
    this.el.textContent = text;
    this.el.classList.add('show');
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.el.classList.remove('show'), 2400);
  }
}
