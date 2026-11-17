// The big moment: the wheel spins, the bolts pull in, the thick door swings open on its hinges,
// the gold inside glints, the code is revealed, confetti. CSS drives the timeline (game.css);
// prefers-reduced-motion shows the open vault at once.
import { codeCells, codeLabel } from '../shared/crack-code';
import type { CrackRecord } from '../shared/vault';
import { h } from './dom';
import { ordinal, streakText } from './format';
import { vaultDoor } from './vault-door';

const CONFETTI = 46;
const CONFETTI_COLORS = ['brass', 'red', 'green', 'yellow', 'cream'];
/** Runware art (public/brand, copied to dist/client by Vite); game view only, never the splash. */
const GOLD_SRC = '/brand/vault-gold.webp';
/** Stacked steel discs between the door's face and back: the visible thickness of the door. */
const DOOR_EDGE_LAYERS = 10;
/** Locking bolts around the door (degrees; 0 = right, away from the hinge). */
const BOLT_ANGLES = [-90, -45, 0, 45, 90];
const SPARKS = 5;

/** CSS custom properties through CSSOM (not a style attribute, which a strict CSP may block). */
const withVars = <T extends HTMLElement>(
  node: T,
  vars: Record<string, string>
): T => {
  for (const [k, v] of Object.entries(vars)) node.style.setProperty(k, v);
  return node;
};

/** The swinging door: face (shared SVG + bolts), edge layers, back plate. */
const swingDoor = (): HTMLElement =>
  h(
    'div',
    { class: 'crack-door' },
    h('div', { class: 'door-back' }),
    ...Array.from({ length: DOOR_EDGE_LAYERS }, (_, k) =>
      withVars(
        h('div', {
          class:
            k === 0 || k === DOOR_EDGE_LAYERS - 1
              ? 'door-edge is-outer'
              : 'door-edge',
        }),
        {
          '--k': String((k + 1) / (DOOR_EDGE_LAYERS + 1)),
        }
      )
    ),
    h(
      'div',
      { class: 'door-face' },
      ...BOLT_ANGLES.map((a) =>
        withVars(h('span', { class: 'door-bolt' }), { '--a': `${a}deg` })
      ),
      vaultDoor()
    )
  );

export type CrackMoment = {
  crack: CrackRecord;
  mine: boolean;
  /** Cracker's streak and all-time cracks here (from the `cracked` event); null when unknown. */
  cracker: { streak: number; cracks: number | null } | null;
};

export class CrackOverlay {
  private readonly root: HTMLElement;
  private readonly kicker: HTMLElement;
  private readonly title: HTMLElement;
  private readonly code: HTMLElement;
  private readonly meta: HTMLElement;
  private readonly flair: HTMLElement;
  private readonly stats: HTMLElement;
  private readonly next: HTMLButtonElement;
  private readonly confetti: HTMLElement;
  private onClose: () => void = () => {};
  private returnFocus: HTMLElement | null = null;

  constructor(parent: HTMLElement) {
    this.kicker = h('p', { class: 'crack-kicker' });
    this.title = h('h2', { class: 'crack-title', id: 'crack-title' });
    this.code = h('div', { class: 'crack-code' });
    this.meta = h('p', { class: 'crack-meta' });
    this.flair = h('p', { class: 'crack-flair' });
    this.stats = h('p', { class: 'crack-stats', hidden: true });
    this.next = h('button', {
      class: 'btn btn-primary btn-xl crack-next',
      type: 'button',
    });
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
      // Scrolls when the webview is shorter than the scene (desktop modal), never clips.
      h(
        'div',
        { class: 'crack-scroll' },
        h(
          'div',
          { class: 'crack-stage' },
          h(
            'div',
            { class: 'crack-vault', 'aria-hidden': 'true' },
            h(
              'div',
              { class: 'crack-frame' },
              h(
                'div',
                { class: 'crack-interior' },
                h('div', { class: 'crack-glow' }),
                h('div', { class: 'crack-shelf' }),
                h('img', {
                  class: 'crack-gold',
                  src: GOLD_SRC,
                  alt: '',
                  width: 480,
                  height: 301,
                  loading: 'lazy',
                  decoding: 'async',
                }),
                h(
                  'div',
                  { class: 'crack-sparks' },
                  ...Array.from({ length: SPARKS }, (_, i) =>
                    h('span', { class: `spark s${i + 1}` })
                  )
                )
              )
            ),
            swingDoor(),
            h('span', { class: 'crack-hinge h1' }),
            h('span', { class: 'crack-hinge h2' })
          ),
          this.kicker,
          this.title,
          this.code,
          this.meta,
          this.flair,
          this.stats,
          this.next
        )
      )
    );
    // The overlay img is lazy and hidden until a crack: warm the cache now so the gold is
    // decoded by the time the door opens.
    const warm = new Image();
    warm.decoding = 'async';
    warm.src = GOLD_SRC;
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
    const { crack, mine, cracker } = moment;
    this.onClose = onClose;
    this.returnFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    // Every crack is today's deepest (vaults open in order). A title only: the Reddit flair
    // is set best effort by the server and may be missing or kept by a moderator.
    this.kicker.textContent = `★ Deepest vault today: #${crack.round} ★`;
    this.flair.replaceChildren(
      mine ? "You are today's " : `u/${crack.username} is today's `,
      h('strong', {}, 'Safecracker 🔓')
    );
    const stats = [
      cracker && cracker.streak > 0 ? streakText(cracker.streak) : null,
      cracker?.cracks ? `${ordinal(cracker.cracks)} vault cracked here` : null,
    ].filter((t) => t !== null);
    this.stats.hidden = stats.length === 0;
    this.stats.textContent = stats.join(' · ');
    this.title.textContent = mine
      ? `You cracked Vault #${crack.round}!`
      : `u/${crack.username} cracked Vault #${crack.round}!`;
    this.code.setAttribute('aria-label', codeLabel(crack.code));
    this.code.setAttribute('role', 'img');
    // One plate per position (repeats included). The plate is always visible; only the number
    // on it flips in, so a frame caught mid-animation never looks like a missing digit.
    this.code.replaceChildren(
      ...codeCells(crack.code).map((cell) =>
        withVars(
          h(
            'span',
            { class: 'crack-digit' },
            h('span', { class: 'crack-digit-face' }, cell.digit)
          ),
          { '--i': String(cell.index) }
        )
      )
    );
    this.code.dataset['dials'] = String(crack.code.length);
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
          h('span', {
            class: `bit bit-${color}${i % 3 === 0 ? ' is-round' : ''}`,
          }),
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
