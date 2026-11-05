// Entry point: creates the Phaser game and registers the scenes.
import { translatePage } from './i18n.js';
import { initNative } from './systems/Native.js';
import { BootScene } from './scenes/BootScene.js';
import { GameScene } from './scenes/GameScene.js';

translatePage();                  // English: page text + left-to-right layout
initNative();                     // Android app: back button, background pause (nothing in a browser)

window.game = new Phaser.Game({   // exposed on window for debugging
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#8fc45a',
  pixelArt: true,                       // keeps pixel art crisp when zoomed
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
  input: { activePointers: 3 },
  // performance on phones: whole pixels, ask for the fast GPU, no extras we don't use
  render: { roundPixels: true, antialias: false, powerPreference: 'high-performance', batchSize: 4096 },
  fps: { target: 60, smoothStep: true },
  disableContextMenu: true,
  banner: false,
  scene: [BootScene, GameScene],
});
