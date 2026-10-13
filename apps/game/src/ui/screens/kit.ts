// Small DOM helpers shared by the screen modules.

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  ...children: (Node | string | null | false)[]): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props);
  for (const c of children) if (c) e.append(c);
  return e;
}

export function button(label: string, onClick: () => void, className = 'menu-btn', disabled = false): HTMLButtonElement {
  const b = el('button', { type: 'button', className, textContent: label, disabled });
  b.addEventListener('click', onClick);
  return b;
}

export function screenPanel(title: string, ...children: (Node | null | false)[]): HTMLElement {
  return el('div', { className: 'screen panel' }, el('h2', { className: 'screen-title', textContent: title }), ...children);
}

export const fmtTime = (ms: number): string => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};

export const fmtDate = (iso: string): string => {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today ? `Today ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
};
