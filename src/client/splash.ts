import { requestExpandedMode } from '@devvit/web/client';
import { byId } from './dom';
import { mountSplash } from './splash-view';
import { fetchState } from './state';

const view = mountSplash(byId('app'), (event) => {
  requestExpandedMode(event, 'game');
});

const load = async () => {
  try {
    view.render(await fetchState());
  } catch (error) {
    console.error('[splash] loading the vault failed:', error);
    view.fail();
  }
};

void load();
