import { makeProject } from '@revideo/core';
import timeline from './scenes/timeline?scene';
// Caption fonts (Nunito, Anton, ...) — see fonts.css's header for why this
// worker needs its own @font-face registration separate from the browser
// preview's (client/src/index.css). A side-effect import so Vite bundles it
// (and rewrites its relative url() paths to real asset URLs) for every scene.
import './fonts.css';

export default makeProject({
    scenes: [timeline],
});
