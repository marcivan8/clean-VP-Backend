import React, { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { prefersReducedMotion } from './motion';

/**
 * Decorative hero object: three chrome rings orbiting an iridescent core.
 *
 * The environment map is generated from a 2D canvas rather than loaded from a
 * CDN HDRI. Metal and glass have nothing to reflect without one — they render
 * flat and cheap — and generating it locally keeps the page free of an external
 * fetch that the CSP would have to allow.
 */

export const StudioEnvironment = () => {
    const { gl, scene } = useThree();

    useEffect(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            console.error('[HeroObject] no 2d context for the environment map');
            return undefined;
        }

        const grad = ctx.createLinearGradient(0, 0, 0, 512);
        grad.addColorStop(0, '#39445a');
        grad.addColorStop(0.42, '#121922');
        grad.addColorStop(1, '#04060a');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 1024, 512);

        const blob = (cx, cy, r, color, alpha) => {
            const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
            rg.addColorStop(0, color);
            rg.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.globalAlpha = alpha;
            ctx.fillStyle = rg;
            ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
            ctx.globalAlpha = 1;
        };
        blob(240, 110, 240, '#ffffff', 0.95);
        blob(690, 140, 250, '#00e5ff', 0.6);
        blob(900, 320, 230, '#8a2be2', 0.55);

        let texture = null;
        let envMap = null;
        let pmrem = null;
        try {
            texture = new THREE.CanvasTexture(canvas);
            texture.mapping = THREE.EquirectangularReflectionMapping;
            texture.colorSpace = THREE.SRGBColorSpace;
            pmrem = new THREE.PMREMGenerator(gl);
            envMap = pmrem.fromEquirectangular(texture).texture;
            scene.environment = envMap;
        } catch (err) {
            console.error('[HeroObject] environment map generation failed:', err.message);
        } finally {
            if (pmrem) pmrem.dispose();
            if (texture) texture.dispose();
        }

        return () => {
            scene.environment = null;
            if (envMap) envMap.dispose();
        };
    }, [gl, scene]);

    return null;
};

const Gyroscope = ({ animate }) => {
    const group = useRef(null);
    const ringA = useRef(null);
    const ringB = useRef(null);
    const ringC = useRef(null);

    const chrome = useMemo(() => new THREE.MeshPhysicalMaterial({
        color: 0xf0f4f8, metalness: 1, roughness: 0.11, envMapIntensity: 1.5,
    }), []);

    const core = useMemo(() => new THREE.MeshPhysicalMaterial({
        color: 0x9fd8e8,
        metalness: 0.55,
        roughness: 0.14,
        iridescence: 0.9,
        iridescenceIOR: 1.4,
        iridescenceThicknessRange: [120, 500],
        clearcoat: 1,
        clearcoatRoughness: 0.08,
        envMapIntensity: 1.5,
    }), []);

    useEffect(() => () => {
        chrome.dispose();
        core.dispose();
    }, [chrome, core]);

    useFrame(() => {
        if (!animate) return;
        if (group.current) {
            group.current.rotation.y += 0.0022;
            group.current.rotation.x += 0.0009;
        }
        // each ring turns on its own axis so it reads as a mechanism,
        // not a single object being spun
        if (ringA.current) ringA.current.rotation.z += 0.0032;
        if (ringB.current) ringB.current.rotation.y += 0.0045;
        if (ringC.current) ringC.current.rotation.x -= 0.0026;
    });

    return (
        <group ref={group} rotation={[0.42, 0.62, 0.08]}>
            <mesh ref={ringA} material={chrome}>
                <torusGeometry args={[1.62, 0.085, 24, 150]} />
            </mesh>
            <mesh ref={ringB} material={chrome} rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[1.38, 0.075, 24, 150]} />
            </mesh>
            <mesh ref={ringC} material={chrome} rotation={[0, 0, Math.PI / 2]}>
                <torusGeometry args={[1.14, 0.065, 24, 150]} />
            </mesh>
            <mesh material={core}>
                <sphereGeometry args={[0.62, 64, 64]} />
            </mesh>
        </group>
    );
};

const HeroObject = ({ className = '', style = null }) => {
    const animate = !prefersReducedMotion();

    return (
        <div className={`vl-canvas-host ${className}`} style={style} aria-hidden="true">
            <Canvas
                dpr={[1, 2]}
                camera={{ position: [0, 0, 7.8], fov: 40 }}
                gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
                onCreated={({ gl }) => {
                    gl.setClearColor(0x000000, 0);
                    gl.toneMapping = THREE.ACESFilmicToneMapping;
                    gl.toneMappingExposure = 1.05;
                }}
            >
                <StudioEnvironment />
                <ambientLight color={0x2a3040} intensity={1.6} />
                <directionalLight color={0xffffff} intensity={1.6} position={[-3, 4, 5]} />
                <pointLight color={0x00e5ff} intensity={13} distance={24} position={[-4, 1.6, 3.6]} />
                <pointLight color={0x8a2be2} intensity={11} distance={24} position={[4, -2, 3]} />
                <Gyroscope animate={animate} />
            </Canvas>
        </div>
    );
};

export default HeroObject;
