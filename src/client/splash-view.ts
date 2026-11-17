// Inline (feed) view: vault door, today's vault, status, your tries, "Crack it".
// No Devvit imports here so the local preview can mount it with mock data.
import type { StateResponse } from '../shared/api';
import { h } from './dom';
import { codesLeftText, codesLeftWord, triesText } from './format';
import { vaultDoor } from './vault-door';

export type SplashView = {
  render: (state: StateResponse) => void;
  fail: () => void;
};

export const mountSplash = (
  root: HTMLElement,
  onStart: (event: MouseEvent) => void
): SplashView => {
  const kicker = h('p', { class: 'splash-kicker', text: 'Daily vault' });
  const title = h('h1', { class: 'splash-title', text: 'Crack the Vault' });
  const status = h('p', {
    class: 'splash-status',
    text: "Loading today's vault…",
  });
  const cracked = h('p', { class: 'splash-cracked', hidden: true });
  const tries = h('p', { class: 'splash-tries', hidden: true });
  const button = h('button', {
    class: 'btn btn-primary btn-xl splash-button',
    type: 'button',
    text: 'Crack it',
  });
  button.addEventListener('click', onStart);

  root.replaceChildren(
    h(
      'main',
      { class: 'splash-card' },
      h('div', { class: 'splash-door' }, vaultDoor()),
      h(
        'div',
        { class: 'splash-text' },
        kicker,
        title,
        status,
        cracked,
        tries,
        button
      )
    )
  );

  const render = (st: StateResponse) => {
    kicker.textContent = `${st.spec.name} · ${st.spec.difficulty}`;
    title.textContent = `Vault #${st.round}`;

    const codes = h(
      'strong',
      { class: 'splash-codes' },
      codesLeftText(st.codesLeft, st.codesLeftStale)
    );
    const clues = st.boardTotal === 1 ? '1 clue' : `${st.boardTotal} clues`;
    status.replaceChildren(
      codes,
      ` ${codesLeftWord(st.codesLeft)} · ${clues} on the board`
    );

    const last = st.cracks[st.cracks.length - 1];
    cracked.hidden = !last;
    if (last)
      cracked.textContent = `🔓 Vault #${last.round} cracked by u/${last.username}`;

    tries.hidden = false;
    if (!st.username) {
      tries.textContent = 'Log in to try codes';
      button.textContent = 'Watch the board';
    } else if (st.guessesLeft <= 0) {
      tries.textContent = 'Out of tries today — watch the crew';
      button.textContent = 'Watch the board';
    } else {
      tries.textContent = `You have ${triesText(st.guessesLeft)} today`;
      button.textContent = 'Crack it';
    }
  };

  const fail = () => {
    status.textContent = "Couldn't load the vault — tap to try inside";
  };

  return { render, fail };
};
