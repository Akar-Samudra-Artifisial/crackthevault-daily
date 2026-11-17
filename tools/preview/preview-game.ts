// Local UI preview of the expanded game with mock data:
// /game.html?s=board|drill|cracked|limit|empty|live|loggedout|stale
import '../../src/client/style.css';
import '../../src/client/game.css';
import './preview.css';
import { byId } from '../../src/client/dom';
import { VaultGame } from '../../src/client/game-app';
import { createMock, scenarioFromUrl } from './mock';

const mock = createMock(scenarioFromUrl());
new VaultGame(byId('app'), mock.backend).start();
mock.script();
