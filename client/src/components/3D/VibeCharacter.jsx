import React, { useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { MeshDistortMaterial, Sphere, Float, Environment, ContactShadows } from '@react-three/drei';
import * as THREE from 'three';

const Orb = ({ isThinking }) => {
    const meshRef = useRef();
    const [hovered, setHover] = useState(false);

    useFrame((state) => {
        // Pulse animation when thinking
        if (meshRef.current) {
            const time = state.clock.getElapsedTime();
            if (isThinking) {
                meshRef.current.scale.x = 1 + Math.sin(time * 5) * 0.1;
                meshRef.current.scale.y = 1 + Math.sin(time * 5) * 0.1;
                meshRef.current.scale.z = 1 + Math.sin(time * 5) * 0.1;
            } else {
                meshRef.current.scale.lerp(new THREE.Vector3(1, 1, 1), 0.1);
            }
        }
    });

    return (
        <Float speed={2} rotationIntensity={1} floatIntensity={2}>
            <Sphere 
                ref={meshRef} 
                args={[1.5, 64, 64]} 
                onPointerOver={() => setHover(true)}
                onPointerOut={() => setHover(false)}
            >
                <MeshDistortMaterial
                    color={hovered || isThinking ? "#00ffff" : "#8a2be2"} // Electric Cyan on hover/think, Neon Purple default
                    attach="material"
                    distort={isThinking ? 0.6 : 0.3} // Distort more when thinking
                    speed={isThinking ? 5 : 2}
                    roughness={0.1}
                    metalness={0.8}
                    emissive={hovered || isThinking ? "#00ffff" : "#8a2be2"}
                    emissiveIntensity={0.5}
                />
            </Sphere>
        </Float>
    );
};

export default function VibeCharacter({ isThinking = false, className = "" }) {
    return (
        <div className={`w-full h-full min-h-[300px] ${className}`}>
            <Canvas camera={{ position: [0, 0, 5], fov: 45 }}>
                <ambientLight intensity={0.5} />
                <directionalLight position={[10, 10, 5]} intensity={1} color="#00ffff" />
                <directionalLight position={[-10, -10, 5]} intensity={1} color="#8a2be2" />
                <Orb isThinking={isThinking} />
                <Environment preset="city" />
                <ContactShadows position={[0, -2, 0]} opacity={0.5} scale={10} blur={2} far={4} />
            </Canvas>
        </div>
    );
}
