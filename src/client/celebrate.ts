// The big moment: the wheel spins, the door swings open, the code is revealed, confetti.
// CSS drives the timeline (game.css); prefers-reduced-motion shows the open vault at once.
import type { CrackRecord } from '../shared/vault';
import { h } from './dom';
import { vaultDoor } from './vault-door';

const CONFETTI = 46;
const CONFETTI_COLORS = ['brass', 'red', 'green', 'yellow', 'cream'];

/** CSS custom properties through CSSOM (not a style attribute, which a strict CSP may block). */
const withVars = <T extends HTMLElement>(node: T, vars: Record<string, string>): T => {
  for (const [k, v] of Object.entries(vars)) node.style.setProperty(k, v);
  return node;
};

export type CrackMoment = {
  crack: CrackRecord;
  mine: boolean;
};

export class CrackOverlay {
  private readonly root: HTMLElement;
  private readonly kicker: HTMLElement;
  private readonly title: HTMLElement;
  private readonly code: HTMLElement;
  private readonly meta: HTMLElement;
  private readonly next: HTMLButtonElement;
  private readonly confetti: HTMLElement;
  private onClose: () => void = () => {};
  private returnFocus: HTMLElement | null = null;

  constructor(parent: HTMLElement) {
    this.kicker = h('p', { class: 'crack-kicker' });
    this.title = h('h2', { class: 'crack-title', id: 'crack-title' });
    this.code = h('div', { class: 'crack-code' });
    this.meta = h('p', { class: 'crack-meta' });
    this.next = h('button', { class: 'btn btn-primary btn-xl crack-next', type: 'button' });
    this.confetti = h('div', { class: 'confetti', 'aria-hidden': 'true' });
    this.next.addEventListener('click', () => this.close());

    this.root = h(
      'div',
      {
        class: 'crack-overlay',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'crack-title',
        hidden: true,
      },
      h('div', { class: 'crack-rays', 'aria-hidden': 'true' }),
      this.confetti,
      h(
        'div',
        { class: 'crack-stage' },
        h(
          'div',
          { class: 'crack-vault', 'aria-hidden': 'true' },
          h(
            'div',
            { class: 'crack-interior' },
            h('div', { class: 'crack-glow' }),
            h(
              'div',
              { class: 'crack-gold' },
              h('span', { class: 'bar b1' }),
              h('span', { class: 'bar b2' }),
              h('span', { class: 'bar b3' })
            )
          ),
          h('div', { class: 'crack-door' }, vaultDoor())
        ),
        this.kicker,
        this.title,
        this.code,
        this.meta,
        this.next
      )
    );
    this.root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
      if (e.key === 'Tab') {
        e.preventDefault();
        this.next.focus();
      }
    });
    parent.append(this.root);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(moment: CrackMoment, onClose: () => void) {
    const { crack, mine } = moment;
    this.onClose = onClose;
    this.returnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.kicker.textContent =
      crack.round === 1
        ? '★ Safecracker of the Day ★'
        : `★ Deepest vault today: #${crack.round} ★`;
    this.title.textContent = mine
      ? `You cracked Vault #${crack.round}!`
      : `u/${crack.username} cracked Vault #${crack.round}!`;
    this.code.setAttribute('aria-label', `The code was ${crack.code.join(' ')}`);
    this.code.setAttribute('role', 'img');
    this.code.replaceChildren(
      ...crack.code.map((d, i) =>
        withVars(h('span', { class: 'crack-digit' }, String(d)), { '--i': String(i) })
      )
    );
    this.meta.textContent =
      crack.guesses === 1
        ? 'Opened on the very first try'
        : `Opened after ${crack.guesses} tries by the crowd`;
    this.next.textContent = `On to Vault #${crack.round + 1}`;
    this.confetti.replaceChildren(
      ...Array.from({ length: CONFETTI }, (_, i) => {
        const color = CONFETTI_COLORS[i % CONFETTI_COLORS.length] ?? 'brass';
        const x = Math.round(Math.random() * 100);
        const drift = Math.round((Math.random() - 0.5) * 160);
        const delay = (1.3 + Math.random() * 1.1).toFixed(2);
        const dur = (2.2 + Math.random() * 1.6).toFixed(2);
        const spin = Math.round(360 + Math.random() * 720);
        return withVars(
          h('span', { class: `bit bit-${color}${i % 3 === 0 ? ' is-round' : ''}` }),
          {
            '--x': `${x}%`,
            '--drift': `${drift}px`,
            '--delay': `${delay}s`,
            '--dur': `${dur}s`,
            '--spin': `${spin}deg`,
          }
        );
      })
    );
    this.root.hidden = false;
    // Restart the CSS timeline every time.
    this.root.classList.remove('is-playing');
    requestAnimationFrame(() => {
      this.root.classList.add('is-playing');
      this.next.focus({ preventScroll: true });
    });
  }

  close() {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.root.classList.remove('is-playing');
    this.confetti.replaceChildren();
    const cb = this.onClose;
    this.onClose = () => {};
    this.returnFocus?.focus({ preventScroll: true });
    cb();
  }
}
