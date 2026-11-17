// Expanded game view. All I/O goes through `Backend`, so the local preview (tools/preview) can
// mount the same UI with mock data. Follows docs/client-contract.md for realtime + refetch.
import {
  parseRealtimeEvent,
  type ActiveVault,
  type GuessRejectCode,
  type GuessResponse,
  type RealtimeClue,
  type StateResponse,
} from '../shared/api';
import {
  applyRealtimeClue,
  mergeState,
  rememberOwnSeqs,
  type OwnSeqs,
} from '../shared/client-state';
import type { LeaderboardResponse } from '../shared/safecracker';
import type { CrackRecord } from '../shared/vault';
import { clueRow, clueSentence } from './board';
import { CrackOverlay, type CrackMoment } from './celebrate';
import { Dials } from './dials';
import { h } from './dom';
import {
  clockSkew,
  codesLeftText,
  codesLeftWord,
  fmtClock,
  fmtDuration,
  fmtInt,
  msUntilUtcMidnight,
  specText,
  streakText,
  tierText,
  triesText,
} from './format';
import { LeaderboardSheet } from './leaderboard';
import { Sfx } from './sfx';

export type RealtimeHandlers = {
  onMessage: (raw: unknown) => void;
  onConnect: () => void;
  onDisconnect: () => void;
};

export type Backend = {
  fetchState: () => Promise<StateResponse>;
  postGuess: (state: StateResponse, guess: string) => Promise<GuessResponse>;
  fetchLeaderboard: () => Promise<LeaderboardResponse>;
  connect: (channel: string, handlers: RealtimeHandlers) => void;
  disconnect: (channel: string) => void;
  toast: (text: string) => void;
};

const POLL_MS = 30_000;
/** First refetch while codesLeft is pending/stale; doubles per try (2, 4, 8, 16, 32 s). */
const STALE_REFETCH_MS = 2_000;
/** Refetches per pending/stale condition (same vault, clue count and opened dials). */
const STALE_MAX_TRIES = 5;
/** A drill time that is already past and does not move: retry after 10 s, 20 s … up to 60 s. */
const DRILL_RETRY_MS = 10_000;
const DRILL_RETRY_MAX_MS = 60_000;
/** At most one refetch per this long for realtime messages that fail to parse. */
const MALFORMED_REFRESH_MS = 10_000;
const MAX_TIMEOUT_MS = 2_000_000_000;

const REJECT_TEXT: Record<GuessRejectCode, string> = {
  limit: "You're out of tries for today — new tries at 00:00 UTC.",
  invalid: "That code doesn't fit this vault. Check the dials.",
  account:
    'Your account is a little too new to try codes. Keep watching the board!',
  busy: 'The vault is busy — give it a second and try again.',
  stale: 'This vault just changed. Here is the latest — your try was not used.',
};

type Ui = {
  vaultNumber: HTMLElement;
  theme: HTMLElement;
  spec: HTMLElement;
  drillChip: HTMLElement;
  deepestChip: HTMLButtonElement;
  streak: HTMLElement;
  codesLeft: HTMLElement;
  codesWord: HTMLElement;
  boardCount: HTMLElement;
  board: HTMLOListElement;
  boardScroll: HTMLElement;
  boardEmpty: HTMLElement;
  live: HTMLElement;
  dials: HTMLElement;
  tryButton: HTMLButtonElement;
  tries: HTMLElement;
  dockNote: HTMLElement;
  dock: HTMLElement;
  error: HTMLElement;
  errorText: HTMLElement;
  retry: HTMLButtonElement;
  sound: HTMLButtonElement;
};

const buildUi = (root: HTMLElement): Ui => {
  const ui: Ui = {
    vaultNumber: h('span', { class: 'vault-number', text: 'Vault' }),
    theme: h('span', { class: 'vault-theme' }),
    spec: h('p', { class: 'vault-spec', text: "Opening today's vault…" }),
    drillChip: h('p', { class: 'chip chip-drill', hidden: true }),
    // The 🏆 chip is the leaderboard button.
    deepestChip: h('button', {
      class: 'chip chip-deepest chip-button',
      type: 'button',
      'aria-haspopup': 'dialog',
      text: '🏆 Leaderboard',
    }),
    streak: h('p', { class: 'streak', hidden: true }),
    codesLeft: h('span', { class: 'codes-n', text: '…' }),
    codesWord: h('span', { class: 'codes-word', text: 'codes left' }),
    boardCount: h('span', { text: '0' }),
    board: h('ol', { class: 'board', 'aria-labelledby': 'board-title' }),
    boardScroll: h('div', {
      class: 'board-scroll',
      tabindex: 0,
      'aria-label': 'Clue board',
    }),
    boardEmpty: h(
      'p',
      { class: 'board-empty', hidden: true },
      h('strong', {}, 'No clues yet.'),
      ' Every try lands here for everyone — the first one is the bravest.'
    ),
    live: h('p', {
      class: 'sr-only',
      'aria-live': 'polite',
      'aria-atomic': 'true',
    }),
    dials: h('div', {
      class: 'dials',
      role: 'group',
      'aria-label': 'Your code',
    }),
    tryButton: h('button', {
      class: 'btn btn-primary try-button',
      type: 'button',
      text: 'Try code',
    }),
    tries: h('p', { class: 'tries', 'aria-live': 'polite' }),
    dockNote: h('p', { class: 'dock-note', hidden: true }),
    dock: h('section', { class: 'dock', 'aria-label': 'Try a code' }),
    error: h('div', { class: 'error-banner', role: 'alert', hidden: true }),
    errorText: h('span', {}),
    retry: h('button', {
      class: 'btn btn-ghost',
      type: 'button',
      text: 'Retry',
    }),
    // Toggle button: the name stays "Sound effects", aria-pressed says whether they're on.
    sound: h('button', {
      class: 'sound-toggle',
      type: 'button',
      'aria-label': 'Sound effects',
    }),
  };
  ui.boardScroll.append(ui.board, ui.boardEmpty);
  ui.error.append(ui.errorText, ui.retry);
  ui.dock.append(
    ui.dials,
    h(
      'div',
      { class: 'dock-row' },
      ui.tryButton,
      h('div', { class: 'dock-status' }, ui.tries, ui.streak)
    ),
    ui.dockNote
  );
  root.replaceChildren(
    h(
      'div',
      { class: 'game-shell' },
      h(
        'header',
        { class: 'vault-head' },
        // Wordmark from public/brand (copied to dist/client by Vite); game view only, the
        // splash stays raster-free. width/height reserve the box so nothing jumps on load.
        h('img', {
          class: 'vault-logo',
          src: '/brand/logo.webp',
          width: 320,
          height: 135,
          alt: 'Crack the Vault',
          loading: 'lazy',
          decoding: 'async',
        }),
        h(
          'div',
          { class: 'vault-head-text' },
          h('h1', { class: 'vault-title' }, ui.vaultNumber, ui.theme),
          ui.spec
        ),
        ui.sound
      ),
      h('div', { class: 'chips' }, ui.drillChip, ui.deepestChip),
      ui.error,
      h(
        'main',
        { class: 'board-panel' },
        h(
          'div',
          { class: 'board-top' },
          h('p', { class: 'codes-left' }, ui.codesLeft, ui.codesWord),
          h(
            'div',
            { class: 'board-meta' },
            h(
              'h2',
              { class: 'board-title', id: 'board-title' },
              'Clue board · ',
              ui.boardCount
            ),
            h(
              'p',
              { class: 'legend' },
              h('span', { class: 'peg peg-green', 'aria-hidden': 'true' }),
              ' right dial',
              h('span', { class: 'peg peg-yellow', 'aria-hidden': 'true' }),
              ' other dial'
            )
          )
        ),
        ui.boardScroll,
        ui.live
      ),
      ui.dock
    )
  );
  return ui;
};

export class VaultGame {
  private readonly backend: Backend;
  private readonly ui: Ui;
  private readonly dials: Dials;
  private readonly overlay: CrackOverlay;
  private readonly leaderboard: LeaderboardSheet;
  private readonly sfx = new Sfx();
  /** day:round and opened dials last rendered, so a newly drilled dial clunks once. */
  private drillSeen = { key: '', open: 0 };

  private state: StateResponse | null = null;
  private seen = new Set<number>();
  /** day:round whose board was painted last; a new key paints without the "fresh" animation. */
  private paintedVault = '';
  private renderedSeq = 0;
  private freshSeqs = new Set<number>();
  private skew = 0;
  private sending = false;
  private fetching = false;
  private refetchQueued = false;
  private celebrated = new Set<string>();
  private pendingState: StateResponse | null = null;
  /** Own clue seqs already counted as tries today (survive the 100-clue board cut). */
  private ownSeqs: OwnSeqs | null = null;
  private channel: string | null = null;
  private connected = false;
  private disposed = false;
  private lastMalformedAt = 0;
  private staleKey = '';
  private staleTries = 0;
  private drillTarget: number | null = null;
  private drillFires = 0;

  private tickTimer: number | undefined;
  private drillTimer: number | undefined;
  private staleTimer: number | undefined;
  private midnightTimer: number | undefined;
  private pollTimer: number | undefined;

  private readonly onVisibility = () => {
    const visible = document.visibilityState === 'visible';
    this.sfx.setVisible(visible);
    if (visible) void this.refresh();
    this.updatePolling();
  };

  constructor(root: HTMLElement, backend: Backend) {
    this.backend = backend;
    this.ui = buildUi(root);
    this.dials = new Dials(this.ui.dials, () => {
      this.sfx.tick();
      this.renderDock();
    });
    this.renderSound();
    this.ui.sound.addEventListener('click', () => {
      this.sfx.setMuted(!this.sfx.isMuted);
      this.renderSound();
    });
    this.overlay = new CrackOverlay(document.body);
    this.leaderboard = new LeaderboardSheet(document.body, () =>
      this.backend.fetchLeaderboard()
    );
    this.ui.deepestChip.addEventListener('click', () => {
      this.leaderboard.open(this.ui.deepestChip);
    });
    this.ui.tryButton.addEventListener('click', () => {
      void this.submit();
    });
    this.ui.retry.addEventListener('click', () => {
      void this.refresh();
    });
    this.ui.dials.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void this.submit();
      }
    });
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  start() {
    if (this.disposed || this.tickTimer !== undefined) return;
    this.tickTimer = window.setInterval(() => this.tick(), 1000);
    void this.refresh();
  }

  /** Stops timers, the visibility listener and the realtime subscription. */
  dispose() {
    this.disposed = true;
    window.clearInterval(this.tickTimer);
    window.clearInterval(this.pollTimer);
    window.clearTimeout(this.drillTimer);
    window.clearTimeout(this.staleTimer);
    window.clearTimeout(this.midnightTimer);
    this.tickTimer = undefined;
    this.pollTimer = undefined;
    this.drillTimer = undefined;
    this.staleTimer = undefined;
    this.midnightTimer = undefined;
    document.removeEventListener('visibilitychange', this.onVisibility);
    if (this.channel) this.backend.disconnect(this.channel);
    this.channel = null;
    this.connected = false;
    this.pendingState = null;
    this.leaderboard.close();
    this.sfx.dispose();
  }

  /* ---------------- Data ---------------- */

  async refresh(): Promise<void> {
    if (this.disposed) return;
    if (this.fetching) {
      this.refetchQueued = true;
      return;
    }
    this.fetching = true;
    try {
      const st = await this.backend.fetchState();
      this.ui.error.hidden = true;
      this.applyState(st);
    } catch (error) {
      console.error('[game] /api/state failed:', error);
      this.ui.errorText.textContent = this.state
        ? 'Lost touch with the vault. The board may be behind.'
        : "Couldn't open today's vault.";
      this.ui.error.hidden = false;
    } finally {
      this.fetching = false;
      if (this.refetchQueued) {
        this.refetchQueued = false;
        void this.refresh();
      }
    }
  }

  /**
   * Takes a snapshot (/api/state or the state in a guess response) through mergeState: an older
   * snapshot never removes clues or gives back tries; an earlier vault/day is ignored.
   */
  private applyState(incoming: StateResponse) {
    if (this.disposed) return;
    if (this.overlay.isOpen) {
      this.pendingState = mergeState(this.pendingState, incoming).state;
      return;
    }
    const prev = this.state;
    // Own clues of every snapshot are remembered before the board may cut them.
    this.ownSeqs = rememberOwnSeqs(this.ownSeqs, incoming);
    const { kind, state: st } = mergeState(prev, incoming);
    if (kind === 'older') {
      this.state = st;
      this.renderDock();
      return;
    }
    // Missed a crack of today (polling, reconnect): celebrate it from the state's crack list.
    // A new UTC day ('new-day') starts clean and never celebrates.
    if (prev && kind === 'new-round') {
      const crack = st.cracks.find((c) => c.round === prev.round);
      if (crack && this.celebrate(crack, st)) return;
    }
    if (kind !== 'same') {
      this.seen = new Set();
      this.renderedSeq = 0;
      this.freshSeqs.clear();
    }
    this.state = st;
    this.skew = clockSkew(incoming.serverTime);
    this.dials.setSpec(`${st.day}:${st.round}`, st.spec, st.drill.revealed);
    this.subscribe(st.channel);
    this.render();
    this.schedule();
  }

  private patchActive(active: ActiveVault) {
    const st = this.state;
    if (
      !st ||
      active.round !== st.round ||
      active.totalGuesses < st.totalGuesses
    )
      return;
    this.state = {
      ...st,
      totalGuesses: active.totalGuesses,
      boardTotal: Math.max(st.boardTotal, active.boardTotal),
      codesLeft: active.codesLeft,
      codesLeftStale: active.codesLeftStale,
      drill: active.drill,
    };
    this.dials.setSpec(`${st.day}:${st.round}`, st.spec, active.drill.revealed);
  }

  /** True when the clue is new and someone else's (it gets the quieter clue sound). */
  private addClue(clue: RealtimeClue): boolean {
    const st = this.state;
    if (!st) return false;
    // Own clue from another tab/device also uses one of this tab's tries.
    const { state: next, own } = applyRealtimeClue(st, clue, this.ownSeqs);
    this.ownSeqs = own;
    if (next === st) return false;
    this.state = next;
    if (clue.username === st.username) return false;
    this.ui.live.textContent = clueSentence(clue);
    return true;
  }

  /* ---------------- Realtime ---------------- */

  private subscribe(channel: string) {
    if (this.channel === channel) return;
    if (this.channel) this.backend.disconnect(this.channel);
    this.channel = channel;
    this.connected = false;
    this.updatePolling();
    // Late callbacks of a channel we already left (day change, dispose) are ignored.
    this.backend.connect(channel, {
      onMessage: (raw) => {
        if (this.channel === channel) this.onRealtime(raw);
      },
      onConnect: () => {
        if (this.channel !== channel) return;
        this.connected = true;
        this.updatePolling();
      },
      onDisconnect: () => {
        if (this.channel !== channel) return;
        this.connected = false;
        this.updatePolling();
      },
    });
  }

  private onRealtime(raw: unknown) {
    const ev = parseRealtimeEvent(raw);
    const st = this.state;
    if (!st) return;
    if (!ev) {
      const now = Date.now();
      if (now - this.lastMalformedAt >= MALFORMED_REFRESH_MS) {
        this.lastMalformedAt = now;
        void this.refresh();
      }
      return;
    }
    // UTC day change: a later day refetches and starts clean (applyState never celebrates a
    // new day); a message of an earlier day is late and ignored.
    if (ev.day < st.day) return;
    if (ev.day > st.day) {
      void this.refresh();
      return;
    }
    if (ev.type === 'cracked') {
      if (ev.round < st.round) return;
      if (ev.round === st.round) {
        this.addClue(ev.clue);
        this.render();
      }
      this.celebrate(ev.crack, null, {
        streak: ev.crackerStreak,
        cracks: ev.crackerCracks,
      });
      void this.refresh();
      void this.leaderboard.refresh();
      return;
    }
    if (ev.active.round > st.round) {
      void this.refresh();
      return;
    }
    if (ev.type === 'clue') {
      if (this.addClue(ev.clue))
        this.sfx.clue(ev.clue.exact, ev.clue.misplaced, true);
      this.patchActive(ev.active);
      const cur = this.state;
      if (cur && ev.deepest) this.state = { ...cur, deepest: ev.deepest };
    } else {
      this.patchActive(ev.active);
    }
    this.render();
    this.schedule();
  }

  private updatePolling() {
    const want =
      !this.disposed &&
      !this.connected &&
      document.visibilityState === 'visible';
    if (want && this.pollTimer === undefined) {
      this.pollTimer = window.setInterval(() => {
        void this.refresh();
      }, POLL_MS);
    } else if (!want && this.pollTimer !== undefined) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  private schedule() {
    const st = this.state;
    if (!st) return;
    const now = Date.now() + this.skew;

    const target = st.drill.nextDrillAt;
    if (target === null) {
      window.clearTimeout(this.drillTimer);
      this.drillTimer = undefined;
      this.drillTarget = null;
    } else if (target !== this.drillTarget || this.drillTimer === undefined) {
      if (target !== this.drillTarget) {
        this.drillTarget = target;
        this.drillFires = 0;
      }
      // Past and not moving (clock skew, slow request): back off instead of a 1 s loop.
      const floor =
        this.drillFires === 0
          ? 1000
          : Math.min(DRILL_RETRY_MS * this.drillFires, DRILL_RETRY_MAX_MS);
      window.clearTimeout(this.drillTimer);
      this.drillTimer = window.setTimeout(
        () => {
          this.drillTimer = undefined;
          this.drillFires += 1;
          void this.refresh();
        },
        Math.min(Math.max(target - now + 1000, floor), MAX_TIMEOUT_MS)
      );
    }

    if (st.codesLeft === null || st.codesLeftStale) {
      const key = `${st.day}:${st.round}:${st.boardTotal}:${st.drill.revealed.length}`;
      if (key !== this.staleKey) {
        this.staleKey = key;
        this.staleTries = 0;
      }
      if (this.staleTimer === undefined && this.staleTries < STALE_MAX_TRIES) {
        this.staleTimer = window.setTimeout(
          () => {
            this.staleTimer = undefined;
            this.staleTries += 1;
            void this.refresh();
          },
          STALE_REFETCH_MS * 2 ** this.staleTries
        );
      }
    } else {
      window.clearTimeout(this.staleTimer);
      this.staleTimer = undefined;
    }

    window.clearTimeout(this.midnightTimer);
    this.midnightTimer = window.setTimeout(
      () => {
        void this.refresh();
      },
      Math.min(msUntilUtcMidnight(now) + 1500, MAX_TIMEOUT_MS)
    );
  }

  /* ---------------- Guessing ---------------- */

  private async submit() {
    const st = this.state;
    if (
      !st ||
      this.sending ||
      this.overlay.isOpen ||
      !st.username ||
      st.guessesLeft <= 0
    )
      return;
    if (st.spec.unique && this.dials.hasRepeats()) {
      this.backend.toast('Each digit can be used only once in this vault.');
      return;
    }
    const guess = this.dials.value();
    this.sfx.submit();
    this.sending = true;
    this.renderDock();
    let res: GuessResponse;
    try {
      res = await this.backend.postGuess(st, guess.join(''));
    } catch (error) {
      console.error('[game] /api/guess failed:', error);
      this.backend.toast(
        "Couldn't send your code — check your connection and try again."
      );
      this.sending = false;
      this.renderDock();
      // The try may have landed: refetch so tries left and the board are not stale.
      void this.refresh();
      return;
    }
    this.sending = false;
    if (res.status === 'rejected') {
      this.backend.toast(
        res.code === 'invalid' ? res.message : REJECT_TEXT[res.code]
      );
      this.applyState(res.state);
      return;
    }
    const r = res.result;
    if (r.cracked) {
      const crack = res.state.cracks.find((c) => c.round === r.round);
      const mine = { streak: res.state.streak, cracks: null };
      if (crack && this.celebrate(crack, res.state, mine)) return;
    } else {
      this.backend.toast(
        `${r.guess.join(' ')} → 🟢 ${r.exact} right dial · 🟡 ${r.misplaced} other dial`
      );
      this.ui.live.textContent = `Your try ${r.guess.join(' ')}: ${r.exact} on the right dial, ${r.misplaced} on another dial.`;
      this.sfx.clue(r.exact, r.misplaced, false);
    }
    this.applyState(res.state);
  }

  /**
   * Shows the open-vault moment once per (day, round). False when already celebrated. It stays
   * open until the player closes it (button or Escape), so focus and screen readers are never cut
   * off mid-announcement; snapshots that land meanwhile are merged into pendingState. While the
   * leaderboard is open the player is already looking at the cracks: a toast instead.
   */
  private celebrate(
    crack: CrackRecord,
    next: StateResponse | null,
    cracker: CrackMoment['cracker'] = null
  ): boolean {
    const day = next?.day ?? this.state?.day ?? '';
    const key = `${day}:${crack.round}`;
    if (this.celebrated.has(key)) return false;
    this.celebrated.add(key);
    const me = next?.username ?? this.state?.username ?? null;
    const mine = me !== null && me === crack.username;
    if (this.leaderboard.isOpen) {
      this.backend.toast(
        mine
          ? `🔓 You cracked Vault #${crack.round}!`
          : `🔓 u/${crack.username} cracked Vault #${crack.round}!`
      );
      return false;
    }
    if (next) this.pendingState = mergeState(this.pendingState, next).state;
    this.sfx.open();
    this.overlay.open({ crack, mine, cracker }, () => {
      if (this.disposed) return;
      const pending = this.pendingState;
      this.pendingState = null;
      if (pending) this.applyState(pending);
      else void this.refresh();
      this.dials.focusFirst();
    });
    return true;
  }

  /* ---------------- Rendering ---------------- */

  private render() {
    const st = this.state;
    if (!st) return;
    this.ui.vaultNumber.textContent = `Vault #${st.round}`;
    this.ui.theme.textContent = st.spec.name;
    this.ui.spec.textContent = `${specText(st.spec)}${st.spec.unique ? ' · no repeats' : ''} · ${tierText(st.spec)}`;

    const deepest = st.deepest;
    // Accessible name keeps the visible text (WCAG 2.5.3) behind a hidden "Leaderboard:".
    this.ui.deepestChip.replaceChildren(
      h('span', { class: 'sr-only' }, deepest ? 'Leaderboard: ' : ''),
      h(
        'span',
        { class: 'chip-label' },
        deepest
          ? `🏆 Deepest #${deepest.round} · u/${deepest.username}`
          : '🏆 Leaderboard'
      ),
      h('span', { class: 'chip-caret', 'aria-hidden': 'true' }, '›')
    );

    this.ui.streak.hidden = !st.username || st.streak <= 0;
    this.ui.streak.textContent = streakText(st.streak);

    this.ui.codesLeft.textContent = codesLeftText(
      st.codesLeft,
      st.codesLeftStale
    );
    this.ui.codesWord.textContent =
      st.codesLeft === 1 && !st.codesLeftStale
        ? 'code left — crack it!'
        : codesLeftWord(st.codesLeft);
    this.ui.codesLeft.classList.toggle(
      'is-pending',
      st.codesLeft === null || st.codesLeftStale
    );
    this.ui.boardCount.textContent =
      st.boardTotal === 1 ? '1 try' : `${fmtInt(st.boardTotal)} tries`;

    this.renderBoard(st);
    this.renderDock();
    this.tick();

    const drillKey = `${st.day}:${st.round}`;
    const open = st.drill.revealed.length;
    if (drillKey === this.drillSeen.key && open > this.drillSeen.open)
      this.sfx.clunk();
    this.drillSeen = { key: drillKey, open };
  }

  private renderSound() {
    const on = !this.sfx.isMuted;
    this.ui.sound.setAttribute('aria-pressed', String(on));
    this.ui.sound.replaceChildren(
      h('span', { 'aria-hidden': 'true' }, on ? '🔊' : '🔇')
    );
  }

  private renderBoard(st: StateResponse) {
    const scroller = this.ui.boardScroll;
    const nearBottom =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
    // First paint of a vault (load, new vault, new day) shows its clues without animation; every
    // clue after that — including the very first clue of an empty vault — animates in.
    const vaultKey = `${st.day}:${st.round}`;
    const firstPaint = this.paintedVault !== vaultKey;
    this.paintedVault = vaultKey;
    for (const e of st.board) {
      if (!this.seen.has(e.seq)) {
        this.seen.add(e.seq);
        if (!firstPaint) this.freshSeqs.add(e.seq);
      }
    }
    this.ui.board.replaceChildren(
      ...st.board.map((e) =>
        clueRow(e, {
          mine: st.username !== null && e.username === st.username,
          fresh: this.freshSeqs.has(e.seq) && e.seq > this.renderedSeq,
        })
      )
    );
    const maxSeq = st.board.reduce((m, e) => Math.max(m, e.seq), 0);
    this.renderedSeq = Math.max(this.renderedSeq, maxSeq);
    this.ui.boardEmpty.hidden = st.board.length > 0;
    if (st.boardTotal > st.board.length) {
      this.ui.board.prepend(
        h(
          'li',
          { class: 'board-trim' },
          `${fmtInt(st.boardTotal - st.board.length)} older clues not shown`
        )
      );
    }
    if (firstPaint || nearBottom)
      requestAnimationFrame(() => {
        scroller.scrollTop = scroller.scrollHeight;
      });
  }

  private renderDock() {
    const st = this.state;
    const ui = this.ui;
    if (!st) {
      ui.tryButton.disabled = true;
      return;
    }
    const loggedOut = !st.username;
    const out = st.guessesLeft <= 0;
    const blocked = loggedOut || out;
    this.dials.setDisabled(blocked || this.sending);
    ui.dock.classList.toggle('is-blocked', blocked);
    ui.tryButton.disabled = blocked || this.sending;
    ui.tryButton.textContent = this.sending
      ? 'Trying…'
      : out
        ? 'Out of tries'
        : 'Try code';
    ui.tries.textContent = loggedOut
      ? 'Log in to play'
      : triesText(st.guessesLeft);
    ui.tries.classList.toggle('is-last', st.guessesLeft === 1);
    ui.dockNote.hidden = !blocked;
    if (loggedOut)
      ui.dockNote.textContent =
        'Log in to Reddit to try codes. The board is live — watch the crew work.';
  }

  /** Once a second: drill countdown and the "new tries" countdown. */
  private tick() {
    const st = this.state;
    if (!st) return;
    const now = Date.now() + this.skew;
    const open = st.drill.revealed.length;
    const next = st.drill.nextDrillAt;
    this.ui.drillChip.hidden = false;
    this.ui.drillChip.classList.toggle('is-open', open > 0);
    // Last minute before the next dial opens: the chip pulses (CSS; off with reduced motion).
    this.ui.drillChip.classList.toggle(
      'is-soon',
      next !== null && next - now < 60_000
    );
    this.ui.drillChip.textContent =
      next === null
        ? `🔩 Drill done · ${open} open`
        : `🔩 ${open > 0 ? `${open} open · next ` : 'Next dial '}${fmtClock(next - now)}`;
    this.ui.drillChip.title =
      next === null
        ? 'The drill has opened all the dials it will open'
        : `The drill opens one dial every 6 hours. Next dial in ${fmtDuration(next - now)}`;
    if (st.username && st.guessesLeft <= 0) {
      this.ui.dockNote.textContent = `You've used your ${st.guessLimit} tries. New tries in ${fmtDuration(msUntilUtcMidnight(now))} — keep watching, the board is live.`;
    }
  }
}
