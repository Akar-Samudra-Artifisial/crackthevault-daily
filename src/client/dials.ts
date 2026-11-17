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
    const before = this.locked;
    this.locked = new Map(revealed.map((r) => [r.dial, r.digit]));
    const sameVault = key === this.key && spec.dials === this.dials.length;
    // A dial the drill just opened (same vault) gets a one-off "clunk" pop.
    if (sameVault)
      for (const i of this.locked.keys())
        if (!before.has(i)) this.replay(this.dials[i]?.root, 'is-drill-new');
    if (!sameVault) {
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

  /** `dir`: the way the wheel turned (1 up, -1 down); the new digit rolls in from that side. */
  private set(i: number, value: number, dir: 1 | -1 = 1) {
    if (!this.canEdit(i)) return;
    const range = this.maxDigit + 1;
    const next = ((value % range) + range) % range;
    if (this.values[i] === next) return;
    this.values[i] = next;
    this.sync();
    const d = this.dials[i];
    if (d) {
      d.digit.classList.remove('is-roll-up', 'is-roll-down');
      this.replay(d.digit, dir > 0 ? 'is-roll-up' : 'is-roll-down');
    }
    this.onChange();
  }

  /** Restarts a one-off CSS animation class on the next frame. */
  private replay(el: HTMLElement | undefined, cls: string) {
    if (!el) return;
    el.classList.remove(cls);
    requestAnimationFrame(() => el.classList.add(cls));
  }

  private step(i: number, delta: 1 | -1) {
    this.set(i, (this.values[i] ?? 0) + delta, delta);
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
    else if (e.key === 'Home') this.set(i, 0, -1);
    else if (e.key === 'End') this.set(i, this.maxDigit);
    else if (/^\d$/.test(e.key)) {
      const n = Number(e.key);
      if (n > this.maxDigit) return;
      this.set(i, n, n >= (this.values[i] ?? 0) ? 1 : -1);
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
      const prev = this.values[i] ?? 0;
      const range = this.maxDigit + 1;
      const target = (((startValue + steps) % range) + range) % range;
      // Direction of this notch: forward around the wheel is "up".
      const forward = (target - prev + range) % range <= range / 2;
      this.set(i, startValue + steps, forward ? 1 : -1);
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
