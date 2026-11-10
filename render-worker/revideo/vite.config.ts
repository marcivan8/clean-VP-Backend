import { defineConfig } from 'vite';
import revideoPluginModule from '@revideo/vite-plugin';

// @revideo/vite-plugin ships CommonJS `exports.default`; depending on the
// Vite/esbuild interop path, the default import can be either the plugin
// function itself or the CommonJS namespace wrapper containing it.
const revideoPlugin = revideoPluginModule.default || revideoPluginModule;

export default defineConfig({
    plugins: [
        revideoPlugin({
            project: './src/project.ts',
            // Revideo 0.10's production default is the invalid esbuild target
            // "modules". Its editor build uses esnext, which is also the
            // correct output target for this modern headless Chrome worker.
            buildForEditor: true,
        }),
    ],
});
