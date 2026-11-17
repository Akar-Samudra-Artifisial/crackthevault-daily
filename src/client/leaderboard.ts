// Leaderboard sheet: deepest vault today + all-time record, today's crackers, top
// safecrackers and the player's own standing. Native <dialog> (focus trap, Escape, top layer);
// fetches /api/leaderboard every time it opens and again on refresh() while open.
import type {
  LeaderboardResponse,
  MyStanding,
  SafecrackerRow,
} from '../shared/safecracker';
import type { CrackRecord, DeepestRecord } from '../shared/vault';
import { h } from './dom';
import { fmtInt, ordinal, streakText } from './format';

const dayLabel = (day: string, today: string): string => {
  if (day === today) return 'today';
  const date = new Date(
    Date.UTC(
      Number(day.slice(0, 4)),
      Number(day.slice(4, 6)) - 1,
      Number(day.slice(6, 8))
    )
  );
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
};

const cracksText = (n: number): string =>
  n === 1 ? '1 crack' : `${fmtInt(n)} cracks`;

const deepCard = (
  label: string,
  rec: DeepestRecord | null,
  today: string,
  empty: string
) =>
  h(
    'div',
    { class: `lb-deep${rec ? '' : ' is-empty'}` },
    h('p', { class: 'lb-deep-label' }, label),
    rec
      ? h('p', { class: 'lb-deep-round' }, `Vault #${rec.round}`)
      : h('p', { class: 'lb-deep-none' }, empty),
    rec && h('p', { class: 'lb-deep-who' }, `u/${rec.username}`),
    rec && h('p', { class: 'lb-deep-day' }, dayLabel(rec.day, today))
  );

const crackRow = (c: CrackRecord, me: string | null) =>
  h(
    'li',
    { class: `lb-crack${me === c.username ? ' is-me' : ''}` },
    h(
      'span',
      { class: 'lb-crack-round' },
      h('span', { class: 'sr-only' }, 'Vault '),
      `#${c.round}`
    ),
    h(
      'span',
      { class: 'lb-crack-main' },
      h('span', { class: 'lb-name' }, `u/${c.username}`),
      h(
        'span',
        { class: 'lb-crack-sub' },
        `${c.guesses === 1 ? '1 try' : `${fmtInt(c.guesses)} tries`} · code `,
        h('span', { class: 'lb-code' }, c.code.join(''))
      )
    )
  );

const topRow = (r: SafecrackerRow, me: string | null) => {
  const mine = me === r.username;
  return h(
    'li',
    {
      class: `lb-top${mine ? ' is-me' : ''}${r.rank <= 3 ? ` is-podium rank-${r.rank}` : ''}`,
    },
    h(
      'span',
      { class: 'lb-rank' },
      h('span', { class: 'sr-only' }, 'Rank '),
      String(r.rank)
    ),
    h(
      'span',
      { class: 'lb-top-name' },
      h('span', { class: 'lb-name' }, `u/${r.username}`),
      mine && h('span', { class: 'lb-you' }, 'you')
    ),
    h('span', { class: 'lb-top-cracks' }, cracksText(r.cracks))
  );
};

const standing = (me: MyStanding | null, inTop: boolean) => {
  if (!me)
    return h(
      'p',
      { class: 'lb-me is-out' },
      'Log in to Reddit to join the leaderboard.'
    );
  const where =
    me.rank === null
      ? 'No vault cracked yet — your first crack puts you on the board.'
      : inTop
        ? `${ordinal(me.rank)} place · ${cracksText(me.cracks)}`
        : `${ordinal(me.rank)} place · ${cracksText(me.cracks)} (outside the top 10)`;
  return h(
    'div',
    { class: 'lb-me' },
    h('p', { class: 'lb-me-title' }, `You · u/${me.username}`),
    h('p', { class: 'lb-me-rank' }, where),
    h(
      'p',
      { class: `lb-me-streak${me.streak > 0 ? '' : ' is-zero'}` },
      me.streak > 0
        ? `${streakText(me.streak)} — try a code every day to keep it`
        : 'No streak yet — try a code today to start one'
    )
  );
};

export class LeaderboardSheet {
  private readonly dialog: HTMLDialogElement;
  private readonly body: HTMLElement;
  private readonly status: HTMLElement;
  private readonly statusText: HTMLElement;
  private readonly retry: HTMLButtonElement;
  private readonly content: HTMLElement;
  private readonly load: () => Promise<LeaderboardResponse>;
  private returnFocus: HTMLElement | null = null;
  private request = 0;
  private data: LeaderboardResponse | null = null;

  constructor(parent: HTMLElement, load: () => Promise<LeaderboardResponse>) {
    this.load = load;
    const close = h('button', {
      class: 'btn btn-ghost lb-close',
      type: 'button',
      'aria-label': 'Close leaderboard',
      text: '✕',
    });
    this.statusText = h('span', {});
    this.retry = h('button', {
      class: 'btn btn-ghost',
      type: 'button',
      text: 'Retry',
      hidden: true,
    });
    this.status = h(
      'div',
      { class: 'lb-status', role: 'status' },
      this.statusText,
      this.retry
    );
    this.content = h('div', { class: 'lb-content' });
    this.body = h('div', { class: 'lb-body' }, this.status, this.content);
    this.dialog = h(
      'dialog',
      { class: 'lb-sheet', 'aria-labelledby': 'lb-title' },
      h(
        'div',
        { class: 'lb-head' },
        h('h2', { class: 'lb-title', id: 'lb-title' }, '🏆 Safecrackers'),
        close
      ),
      this.body
    );
    close.addEventListener('click', () => this.close());
    this.retry.addEventListener('click', () => {
      void this.refresh();
    });
    // Tap on the backdrop (outside the sheet) closes it.
    this.dialog.addEventListener('click', (e) => {
      if (e.target === this.dialog) this.close();
    });
    // Escape (native cancel) and close() both end here: give focus back to the opener.
    this.dialog.addEventListener('close', () => {
      this.returnFocus?.focus({ preventScroll: true });
      this.returnFocus = null;
    });
    parent.append(this.dialog);
  }

  get isOpen(): boolean {
    return this.dialog.open;
  }

  open(opener: HTMLElement | null) {
    if (this.dialog.open) return;
    this.returnFocus = opener;
    this.dialog.showModal();
    this.body.scrollTop = 0;
    void this.refresh();
  }

  close() {
    if (this.dialog.open) this.dialog.close();
  }

  /** Refetches when open (e.g. after a `cracked` event); a late older answer is dropped. */
  async refresh(): Promise<void> {
    if (!this.dialog.open) return;
    const id = ++this.request;
    this.setStatus(this.data ? 'Updating…' : 'Loading the leaderboard…', false);
    this.content.setAttribute('aria-busy', 'true');
    try {
      const data = await this.load();
      if (id !== this.request) return;
      this.data = data;
      this.render(data);
      this.setStatus(null, false);
    } catch (error) {
      if (id !== this.request) return;
      console.error('[leaderboard] /api/leaderboard failed:', error);
      this.setStatus(
        this.data
          ? "Couldn't update the leaderboard — showing the last one."
          : "Couldn't load the leaderboard.",
        true
      );
    } finally {
      if (id === this.request) this.content.removeAttribute('aria-busy');
    }
  }

  private setStatus(text: string | null, failed: boolean) {
    this.status.hidden = text === null;
    this.status.classList.toggle('is-error', failed);
    this.statusText.textContent = text ?? '';
    this.retry.hidden = !failed;
  }

  private render(lb: LeaderboardResponse) {
    const me = lb.me?.username ?? null;
    const inTop = lb.top.some((r) => r.username === me);
    const newestFirst = [...lb.crackers].reverse();
    const earlier = lb.crackersTotal - lb.crackers.length;

    this.content.replaceChildren(
      h(
        'section',
        { class: 'lb-section', 'aria-labelledby': 'lb-deep-title' },
        h('h3', { class: 'lb-h', id: 'lb-deep-title' }, 'Deepest vault'),
        h(
          'div',
          { class: 'lb-deep-grid' },
          deepCard('Today', lb.today, lb.day, 'Nothing cracked yet'),
          deepCard('All-time record', lb.record, lb.day, 'No record yet')
        )
      ),
      h(
        'section',
        { class: 'lb-section', 'aria-labelledby': 'lb-today-title' },
        h(
          'h3',
          { class: 'lb-h', id: 'lb-today-title' },
          'Cracked today',
          h('span', { class: 'lb-count' }, fmtInt(lb.crackersTotal))
        ),
        newestFirst.length > 0
          ? h(
              'ol',
              { class: 'lb-list' },
              ...newestFirst.map((c) => crackRow(c, me))
            )
          : h(
              'p',
              { class: 'lb-empty' },
              'No vault cracked yet today. The first crack earns the Safecracker of the Day flair 🔓'
            ),
        earlier > 0 &&
          h(
            'p',
            { class: 'lb-more' },
            `+ ${fmtInt(earlier)} earlier ${earlier === 1 ? 'crack' : 'cracks'}`
          )
      ),
      h(
        'section',
        { class: 'lb-section', 'aria-labelledby': 'lb-top-title' },
        h(
          'h3',
          { class: 'lb-h', id: 'lb-top-title' },
          'Top safecrackers',
          h('span', { class: 'lb-sub' }, 'all time')
        ),
        lb.top.length > 0
          ? h('ol', { class: 'lb-list' }, ...lb.top.map((r) => topRow(r, me)))
          : h(
              'p',
              { class: 'lb-empty' },
              'Nobody has cracked a vault here yet. Be the first name on this list.'
            ),
        standing(lb.me, inTop)
      )
    );
  }
}
