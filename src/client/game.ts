import {
  connectRealtime,
  disconnectRealtime,
  showToast,
} from '@devvit/web/client';
import type { JsonValue } from '@devvit/web/shared';
import { byId } from './dom';
import { VaultGame } from './game-app';
import { fetchLeaderboard, fetchState, postGuess } from './state';

const game = new VaultGame(byId('app'), {
  fetchState,
  postGuess,
  fetchLeaderboard,
  connect: (channel, handlers) => {
    connectRealtime<JsonValue>({
      channel,
      onMessage: (data) => handlers.onMessage(data),
      onConnect: () => handlers.onConnect(),
      onDisconnect: () => handlers.onDisconnect(),
    });
  },
  disconnect: (channel) => disconnectRealtime(channel),
  toast: (text) => showToast(text),
});

game.start();
