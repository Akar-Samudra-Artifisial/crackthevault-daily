// Local UI preview of the inline splash with mock data: /splash.html?s=board|limit|empty|loggedout
import '../../src/client/style.css';
import '../../src/client/splash.css';
import './preview.css';
import { byId } from '../../src/client/dom';
import { mountSplash } from '../../src/client/splash-view';
import { parseSplashState } from '../../src/shared/splash-state';
import { createMock, scenarioFromUrl } from './mock';

const mock = createMock(scenarioFromUrl());
const view = mountSplash(byId('app'), () =>
  mock.backend.toast('→ requestExpandedMode(game)')
);
// Same path as production: JSON → the splash's light parser.
const st = parseSplashState(JSON.parse(JSON.stringify(mock.state())));
if (st) view.render(st);
else view.fail();
