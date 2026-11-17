import { requestExpandedMode } from '@devvit/web/client';
import { parseSplashState } from '../shared/splash-state';
import { byId } from './dom';
import { mountSplash } from './splash-view';

const view = mountSplash(byId('app'), (event) => {
  requestExpandedMode(event, 'game');
});

const load = async () => {
  try {
    const res = await fetch('/api/state');
    const body: unknown = await res.json();
    const state = parseSplashState(body);
    if (!state)
      throw new Error(`unexpected /api/state response (${res.status})`);
    view.render(state);
  } catch (error) {
    console.error('[splash] loading the vault failed:', error);
    view.fail();
  }
};

void load();
