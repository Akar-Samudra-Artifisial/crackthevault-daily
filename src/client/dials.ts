// Code input: one dial per digit. Tap ▲/▼, drag the window up/down, or use the keyboard
// (arrows, digit keys, Home/End). Dials opened by the drill are locked and pre-filled.
import type { DialReveal } from '../shared/vault';
import { h, s } from './dom';

const DRAG_STEP_PX = 26;

type Dial = {
  root: HTMLElement;
  win: HTMLElement;
  digit: HTMLElement;
  up: HTMLButtonElement;
  down: HTMLButtonElement;
};

const chevron = (dir: 'up' | 'down') =>
  s(
    'svg',
    { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' },
    s('path', {
      d: dir === 'up' ? 'M5 15l7-7 7 7' : 'M5 9l7 7 7-7',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 4,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    })
  );

export class Dials {
  private readonly root: HTMLElement;
  private readonly onChange: () => void;
  private dials: Dial[] = [];
  private values: number[] = [];
  private locked = new Map<number, number>();
  private maxDigit = 9;
  private key = '';
  private disabled = false;

  constructor(root: HTMLElement, onChange: () => void) {
    this.root = root;
    this.onChange = onChange;
  }

  /** Rebuilds when `key` (day:round) or the dial count changes; otherwise refreshes locks. */
  setSpec(
    key: string,
    spec: { dials: number; maxDigit: number },
    revealed: readonly DialReveal[]
  ) {
    this.locked = new Map(revealed.map((r) => [r.dial, r.digit]));
    if (key !== this.key || spec.dials !== this.dials.length) {
      this.key = key;
      this.maxDigit = spec.maxDigit;
      this.values = Array.from({ length: spec.dials }, () => 0);
      this.dials = this.values.map((_, i) => this.build(i, spec.dials));
      this.root.replaceChildren(...this.dials.map((d) => d.root));
      this.root.style.setProperty('--dials', String(spec.dials));
    }
    for (const [dial, digit] of this.locked) this.values[dial] = digit;
    this.sync();
  }

  setDisabled(disabled: boolean) {
    this.disabled = disabled;
    this.sync();
  }

  value(): number[] {
    return [...this.values];
  }

  hasRepeats(): boolean {
    return new Set(this.values).size !== this.values.length;
  }

  focusFirst() {
    const first = this.dials.find((_, i) => !this.locked.has(i));
    first?.win.focus();
  }

  private build(i: number, count: number): Dial {
    const up = h('button', {
      class: 'dial-step',
      type: 'button',
      tabindex: -1,
      'aria-label': `Dial ${i + 1} up`,
    });
    up.append(chevron('up'));
    const down = h('button', {
      class: 'dial-step',
      type: 'button',
      tabindex: -1,
      'aria-label': `Dial ${i + 1} down`,
    });
    down.append(chevron('down'));
    const digit = h('span', { class: 'dial-digit', text: '0' });
    const win = h(
      'div',
      {
        class: 'dial-window',
        role: 'spinbutton',
        tabindex: 0,
        'aria-valuemin': 0,
        'aria-valuemax': this.maxDigit,
      },
      digit,
      h('span', { class: 'dial-lock', 'aria-hidden': 'true', text: 'drilled' })
    );
    const root = h('div', { class: 'dial' }, up, win, down);

    up.addEventListener('click', () => this.step(i, 1));
    down.addEventListener('click', () => this.step(i, -1));
    win.addEventListener('keydown', (e) => this.onKey(e, i, count));
    this.attachDrag(win, i);
    return { root, win, digit, up, down };
  }

  private canEdit(i: number) {
    return !this.disabled && !this.locked.has(i);
  }

  private set(i: number, value: number) {
    if (!this.canEdit(i)) return;
    const range = this.maxDigit + 1;
    const next = ((value % range) + range) % range;
    if (this.values[i] === next) return;
    this.values[i] = next;
    this.sync();
    const d = this.dials[i];
    if (d) {
      d.digit.classList.remove('is-bump');
      requestAnimationFrame(() => d.digit.classList.add('is-bump'));
    }
    this.onChange();
  }

  private step(i: number, delta: number) {
    this.set(i, (this.values[i] ?? 0) + delta);
  }

  private focusNext(i: number, count: number, dir: 1 | -1) {
    for (let j = i + dir; j >= 0 && j < count; j += dir) {
      if (!this.locked.has(j)) {
        this.dials[j]?.win.focus();
        return;
      }
    }
  }

  private onKey(e: KeyboardEvent, i: number, count: number) {
    if (e.key === 'ArrowUp') this.step(i, 1);
    else if (e.key === 'ArrowDown') this.step(i, -1);
    else if (e.key === 'ArrowRight') this.focusNext(i, count, 1);
    else if (e.key === 'ArrowLeft') this.focusNext(i, count, -1);
    else if (e.key === 'Home') this.set(i, 0);
    else if (e.key === 'End') this.set(i, this.maxDigit);
    else if (/^\d$/.test(e.key)) {
      const n = Number(e.key);
      if (n > this.maxDigit) return;
      this.set(i, n);
      this.focusNext(i, count, 1);
    } else return;
    e.preventDefault();
  }

  private attachDrag(win: HTMLElement, i: number) {
    let startY = 0;
    let startValue = 0;
    let dragging = false;
    win.addEventListener('pointerdown', (e) => {
      if (!this.canEdit(i)) return;
      dragging = true;
      startY = e.clientY;
      startValue = this.values[i] ?? 0;
      win.setPointerCapture(e.pointerId);
    });
    win.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const steps = Math.trunc((startY - e.clientY) / DRAG_STEP_PX);
      this.set(i, startValue + steps);
    });
    const end = () => {
      dragging = false;
    };
    win.addEventListener('pointerup', end);
    win.addEventListener('pointercancel', end);
  }

  private sync() {
    this.dials.forEach((d, i) => {
      const value = this.values[i] ?? 0;
      const locked = this.locked.has(i);
      d.digit.textContent = String(value);
      d.root.classList.toggle('is-drilled', locked);
      d.root.classList.toggle('is-disabled', this.disabled);
      d.win.setAttribute('aria-valuenow', String(value));
      d.win.setAttribute('aria-valuemax', String(this.maxDigit));
      d.win.setAttribute(
        'aria-label',
        locked ? `Dial ${i + 1}, drilled open` : `Dial ${i + 1}`
      );
      if (locked || this.disabled) d.win.setAttribute('aria-readonly', 'true');
      else d.win.removeAttribute('aria-readonly');
      d.up.disabled = !this.canEdit(i);
      d.down.disabled = !this.canEdit(i);
    });
  }
}
