// Shared clue board rows: code tiles, 🟢/🟡 counts (never per dial), who tried it.
import type { BoardEntry } from '../shared/vault';
import { h } from './dom';

export const clueSentence = (e: Pick<BoardEntry, 'guess' | 'exact' | 'misplaced' | 'username'>) =>
  `u/${e.username} tried ${e.guess.join(' ')}: ${e.exact} on the right dial, ${e.misplaced} on another dial`;

const peg = (kind: 'green' | 'yellow', n: number) =>
  h(
    'span',
    { class: `peg peg-${kind}${n === 0 ? ' is-zero' : ''}`, 'aria-hidden': 'true' },
    String(n)
  );

export const clueRow = (
  e: BoardEntry,
  opts: { mine: boolean; fresh: boolean }
): HTMLLIElement => {
  const code = h(
    'span',
    { class: 'clue-code', 'aria-hidden': 'true' },
    ...e.guess.map((d) => h('span', { class: 'clue-digit' }, String(d)))
  );
  const who = h(
    'span',
    { class: 'clue-who', 'aria-hidden': 'true' },
    opts.mine
      ? h('span', { class: 'clue-you' }, 'you')
      : h('span', { class: 'clue-name' }, `u/${e.username}`)
  );
  return h(
    'li',
    {
      class: `clue${opts.mine ? ' is-mine' : ''}${opts.fresh ? ' is-new' : ''}`,
      'data-seq': e.seq,
    },
    code,
    h(
      'span',
      { class: 'clue-pegs', 'aria-hidden': 'true' },
      peg('green', e.exact),
      peg('yellow', e.misplaced)
    ),
    who,
    h('span', { class: 'sr-only' }, `${clueSentence(e)}${opts.mine ? ' (you)' : ''}`)
  );
};
