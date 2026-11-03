import React, { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { StudioEnvironment } from './HeroObject';
import { prefersReducedMotion } from './motion';

/** A cube with softened edges, built by extruding a rounded square. */
function roundedBoxGeometry(size = 1, radius = 0.17, bevel = 0.055) {
    const half = size / 2 - bevel;
    const r = Math.min(radius, half);
    const shape = new THREE.Shape();
    shape.moveTo(-half + r, -half);
    shape.lineTo(half - r, -half);
    shape.quadraticCurveTo(half, -half, half, -half + r);
    shape.lineTo(half, half - r);
    shape.quadraticCurveTo(half, half, half - r, half);
    shape.lineTo(-half + r, half);
    shape.quadraticCurveTo(-half, half, -half, half - r);
    shape.lineTo(-half, -half + r);
    shape.quadraticCurveTo(-half, -half, -half + r, -half);

    const geo = new THREE.ExtrudeGeometry(shape, {
        depth: size - bevel * 2,
        bevelEnabled: true,
        bevelSize: bevel,
        bevelThickness: bevel,
        bevelSegments: 4,
        curveSegments: 10,
    });
    geo.translate(0, 0, -(size - bevel * 2) / 2);
    geo.computeVertexNormals();
    return geo;
}

const CUBES = [
    { pos: [-0.95, 0.55, 0.2], size: 1.25, rot: [0.4, 0.6, 0.1], spin: 0.0024 },
    { pos: [0.85, -0.15, -0.4], size: 0.95, rot: [-0.3, 0.9, 0.25], spin: -0.0031 },
    { pos: [0.1, -1.15, 0.5], size: 0.7, rot: [0.7, 0.2, -0.4], spin: 0.0042 },
];

const Cluster = ({ animate }) => {
    const group = useRef(null);
    const parts = useRef([]);

    const geometries = useMemo(
        () => CUBES.map((c) => roundedBoxGeometry(c.size)),
        [],
    );
    const material = useMemo(
        () => new THREE.MeshPhysicalMaterial({
            color: 0xeef3f8, metalness: 1, roughness: 0.13, envMapIntensity: 1.5,
        }),
        [],
    );

    useFrame(() => {
        if (!animate) return;
        if (group.current) group.current.rotation.y += 0.0016;
        parts.current.forEach((mesh, i) => {
            if (!mesh) return;
            mesh.rotation.x += CUBES[i].spin;
            mesh.rotation.y += CUBES[i].spin * 0.7;
        });
    });

    return (
        <group ref={group} rotation={[0.3, 0.5, 0.05]}>
            {CUBES.map((c, i) => (
                <mesh
                    key={i}
                    ref={(el) => { parts.current[i] = el; }}
                    position={c.pos}
                    rotation={c.rot}
                    geometry={geometries[i]}
                    material={material}
                />
            ))}
        </group>
    );
};

/** Drifting chrome cubes used as decoration around the call-to-action bands. */
const CtaObject = ({ className = '', style = null }) => {
    const animate = !prefersReducedMotion();

    return (
        <div className={className} style={style} aria-hidden="true">
            <Canvas
                dpr={[1, 2]}
                camera={{ position: [0, 0, 6.4], fov: 40 }}
                gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
                onCreated={({ gl }) => {
                    gl.toneMapping = THREE.ACESFilmicToneMapping;
                    gl.toneMappingExposure = 1.05;
                }}
            >
                <StudioEnvironment />
                <ambientLight color={0x2a3040} intensity={1.6} />
                <directionalLight color={0xffffff} intensity={1.5} position={[-3, 4, 5]} />
                <pointLight color={0x00e5ff} intensity={11} distance={24} position={[-4, 1.6, 3.6]} />
                <pointLight color={0x8a2be2} intensity={9} distance={24} position={[4, -2, 3]} />
                <Cluster animate={animate} />
            </Canvas>
        </div>
    );
};

export default CtaObject;
