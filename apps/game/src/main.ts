import Phaser from 'phaser';
import { ASSET_BASE } from './assets/url';
import { DPR } from './config/game';
import { GameFlow } from './app/GameFlow';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
import { MenuScene } from './scenes/MenuScene';
import './ui/hud.css';
import './ui/screens/screens.css';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: document.body,
  backgroundColor: '#000000', // matches the fog the land fades into past the field
  // Canvas at full device resolution, shown at CSS size (sharp on Retina)
  scale: { mode: Phaser.Scale.NONE, width: window.innerWidth * DPR, height: window.innerHeight * DPR, zoom: 1 / DPR },
  // assets come from S3 in a build (assets/url.ts); textures from another origin need CORS
  loader: { baseURL: ASSET_BASE, crossOrigin: 'anonymous' },
  render: { mipmapFilter: 'LINEAR_MIPMAP_LINEAR', roundPixels: true },
  scene: [BootScene, MenuScene, GameScene],
});

// Menus, match lifecycle, saving and autosave
const flow = new GameFlow(game);

window.addEventListener('resize', () => game.scale.resize(window.innerWidth * DPR, window.innerHeight * DPR));

// console / e2e debugging
if (import.meta.env.DEV) Object.assign(window as object, { game, flow, GameScene });
