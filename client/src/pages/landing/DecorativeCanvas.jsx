import React from 'react';
import { Canvas } from '@react-three/fiber';

/**
 * A react-three-fiber Canvas for decoration only. When the browser cannot give
 * a WebGL context, it renders nothing instead of the scene.
 *
 * Canvas rethrows a renderer creation failure ("Error creating WebGL context")
 * into the surrounding React tree. The app has no error boundary above the
 * landing page, so one failed decorative canvas unmounted the whole page,
 * signup buttons included.
 */

let webglSupport = null;

function hasWebGL() {
    if (webglSupport !== null) return webglSupport;
    try {
        const canvas = document.createElement('canvas');
        // three.js r163+ needs WebGL2
        const gl = canvas.getContext('webgl2');
        webglSupport = !!gl;
        if (gl) gl.getExtension('WEBGL_lose_context')?.loseContext();
    } catch (err) {
        console.error('[DecorativeCanvas] WebGL support check failed:', err.message);
        webglSupport = false;
    }
    return webglSupport;
}

class CanvasErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { failed: false };
    }

    static getDerivedStateFromError() {
        return { failed: true };
    }

    componentDidCatch(error) {
        console.error('[DecorativeCanvas] 3D decoration disabled:', error?.message || error);
    }

    render() {
        return this.state.failed ? null : this.props.children;
    }
}

const DecorativeCanvas = ({ children, ...canvasProps }) => {
    if (!hasWebGL()) return null;

    return (
        <CanvasErrorBoundary>
            <Canvas {...canvasProps}>{children}</Canvas>
        </CanvasErrorBoundary>
    );
};

export default DecorativeCanvas;
