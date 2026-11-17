// Inline (feed) view: vault door, today's vault, status, your tries, "Crack it".
// No Devvit imports here so the local preview can mount it with mock data.
// Imports stay tiny on purpose (splash budget < 10 KB gzip): no shared/api or format.ts.
import { tierText, type SplashState } from '../shared/splash-state';
import { h } from './dom';
import { codesLeftText, codesLeftWord, streakText, triesText } from './text';
import { vaultDoor } from './vault-door';

export type SplashView = {
  render: (state: SplashState) => void;
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
  const streak = h('p', { class: 'splash-streak', hidden: true });
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
        streak,
        button
      )
    )
  );

  const render = (st: SplashState) => {
    kicker.textContent = `${st.spec.name} · ${tierText(st.spec)}`;
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

    const last = st.lastCrack;
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
    streak.hidden = !st.username || st.streak <= 0;
    streak.textContent =
      st.guessesUsed > 0
        ? streakText(st.streak)
        : `${streakText(st.streak)} — try today to keep it`;
  };

  const fail = () => {
    status.textContent = "Couldn't load the vault — tap to try inside";
  };

  return { render, fail };
};
