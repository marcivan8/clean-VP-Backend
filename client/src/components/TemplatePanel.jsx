import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import useTimelineStore from '../store/useTimelineStore';
import { TEMPLATE_KINDS, drawTemplate, templateParams } from '../motion/TemplateGraphics.js';
import { ICON_NAMES } from '../motion/IconLibrary.js';
import { VECTOR_ILLUSTRATIONS, VECTOR_ILLUSTRATION_BACKGROUNDS } from '../motion/VectorIllustrationLibrary.js';
import { evaluateMotionCompatibility } from '../agent/AnimationCompatibilityEvaluator.js';
import { sampleAnimation } from '../motion/MotionResolver.js';
import { remapSceneObjectTime } from '../motion/TimeRemap.js';
import { SCENE3D_BLEND_MODES, SCENE3D_CAMERA_DEFAULTS, SCENE3D_TEXTURE_MASK_SHAPES } from '../motion/Scene3D.js';
import { validateMotionExpression } from '../motion/MotionExpression.js';

/**
 * R89 (to-do A5) — insert animated templates at the playhead, and edit the
 * selected one. The drawing is motion/TemplateGraphics.js (preview and export).
 */
const field = 'w-full bg-white/5 border border-border rounded px-2 py-1 text-xs text-foreground outline-none';
const parseSceneColorChannel = (color, channel) => {
    const value = String(color || '').replace(/^#/, '');
    const hex = value.length === 3 ? value.split('').map(character => character + character).join('') : value;
    const parsed = Number.parseInt(hex.slice(channel * 2, channel * 2 + 2), 16);
    return Number.isFinite(parsed) ? parsed : 0;
};

const VectorEditor = ({ trackId, clip }) => {
    const { t } = useTranslation('editor');
    const vector = clip.vector || {};
    const [draft, setDraft] = useState(vector);
    const vectorKey = JSON.stringify(vector);
    useEffect(() => setDraft(vector), [vectorKey]);
    const commit = (patch) => {
        const next = { ...draft, ...patch };
        setDraft(next);
        useTimelineStore.getState().updateClip(trackId, clip.id, { vector: next });
    };
    const fieldInput = (key, label, options = {}) => (
        <label className="block space-y-1" key={key}>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t(`vector.${label}`)}</span>
            <input className={field} type={options.number ? 'number' : 'text'} step={options.step || 'any'} value={draft[key] ?? ''}
                onChange={event => setDraft({ ...draft, [key]: options.number ? (event.target.value === '' ? '' : Number(event.target.value)) : event.target.value })}
                onBlur={() => commit({ [key]: draft[key] })} />
        </label>
    );
    const motion = draft.motion || {};
    const commitMotion = patch => commit({ motion: { ...motion, ...patch } });
    const motionInput = (key, label) => (
        <label className="block space-y-1" key={key}>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t(`templates.vector.${label}`)}</span>
            <textarea rows={3} className={`${field} font-mono`} value={motion[key] || ''}
                onChange={event => setDraft({ ...draft, motion: { ...motion, [key]: event.target.value } })}
                onBlur={() => commitMotion({ [key]: motion[key] })} />
        </label>
    );
    return <div className="mt-3 space-y-2 border-t border-border/50 pt-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('vector.title')}</div>
        <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('vector.shape')}</span>
            <select className={field} value={draft.kind || 'path'} onChange={event => commit({ kind: event.target.value })}>
                {['path', 'rect', 'circle', 'ellipse', 'capsule', 'callout', 'polygon', 'star', 'arrow'].map(kind => <option key={kind} value={kind}>{kind}</option>)}
            </select>
        </label>
        <div className="grid grid-cols-2 gap-2">{fieldInput('w', 'width', { number: true })}{fieldInput('h', 'height', { number: true })}</div>
        {draft.kind === 'path' && <>{fieldInput('pathData', 'pathData')}
            {motionInput('pathFrom', 'morphFrom')}{motionInput('pathTo', 'morphTo')}
            <label className="block space-y-1">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('vector.morphStartTime')}</span>
                <input className={field} type="number" min="0" step="0.05" value={motion.morphStartTime ?? ''}
                    onChange={event => setDraft({ ...draft, motion: { ...motion, morphStartTime: event.target.value === '' ? '' : Number(event.target.value) } })}
                    onBlur={() => commitMotion({ morphStartTime: Math.max(0, Number(motion.morphStartTime) || 0) })} />
            </label>
            <label className="block space-y-1">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('vector.morphDuration')}</span>
                <input className={field} type="number" min="0.01" step="0.05" value={motion.morphDuration ?? ''}
                    onChange={event => setDraft({ ...draft, motion: { ...motion, morphDuration: Number(event.target.value) } })}
                    onBlur={() => commitMotion({ morphDuration: motion.morphDuration })} />
            </label>
        </>}
        <div className="grid grid-cols-2 gap-2">
            {fieldInput('fill', 'fill')}{fieldInput('stroke', 'stroke')}{fieldInput('strokeWidth', 'strokeWidth', { number: true })}
        </div>
        <div className="grid grid-cols-2 gap-2">{fieldInput('x', 'x', { number: true })}{fieldInput('y', 'y', { number: true })}</div>
    </div>;
};

const IllustrationSwatch = ({ illustration }) => {
    const ref = useRef(null);
    useEffect(() => {
        const canvas = ref.current;
        const ctx = canvas?.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawTemplate(ctx, 'icon', illustration, 1.2, 3, {});
    }, [illustration]);
    return <canvas ref={ref} width={48} height={48} aria-hidden="true" className="w-9 h-9 shrink-0" />;
};

const TemplateEditor = ({ trackId, clip }) => {
    const { t } = useTranslation('editor');
    const kind = clip.template.kind;
    const p = templateParams(kind, clip.template.params);
    // Local text so typing does not write a history entry per keystroke. Sync
    // from saved params when an assistant edit or undo changes the clip.
    const [draft, setDraft] = useState(p);
    const paramsKey = JSON.stringify(clip.template.params || {});
    const [numberDrafts, setNumberDrafts] = useState({});
    const [selected3DObject, setSelected3DObject] = useState(0);
    const [text3DDraft, setText3DDraft] = useState('');
    const [selected3DProperty, setSelected3DProperty] = useState('rotationY');
    const [selected3DCameraProperty, setSelected3DCameraProperty] = useState('z');
    const [expressionProperty3D, setExpressionProperty3D] = useState('scale');
    const [expressionDraft3D, setExpressionDraft3D] = useState('');
    const [expressionError3D, setExpressionError3D] = useState('');
    const [selected3DLight, setSelected3DLight] = useState(0);
    const [selected3DLightProperty, setSelected3DLightProperty] = useState('intensity');
    const [meshGeometryDraft3D, setMeshGeometryDraft3D] = useState('');
    const [meshGeometryError3D, setMeshGeometryError3D] = useState('');
    const [keyframeEasing, setKeyframeEasing] = useState('easeInOutCubic');
    const currentTime = useTimelineStore(state => state.currentTime);
    const audioReactiveAssets = useTimelineStore(useShallow(state => (state.assets || []).filter(asset => ['audio', 'video'].includes(asset.type))));
    useEffect(() => {
        setDraft(templateParams(kind, clip.template.params));
        setNumberDrafts({});
    }, [paramsKey, kind]);
    useEffect(() => {
        setExpressionDraft3D(objects3d[selected3DObject]?.expressions?.[expressionProperty3D] || '');
        setExpressionError3D('');
    }, [selected3DObject, expressionProperty3D, paramsKey]);
    useEffect(() => {
        setText3DDraft(objects3d[selected3DObject]?.content || '');
    }, [selected3DObject, paramsKey, objects3d[selected3DObject]?.content]);
    useEffect(() => {
        const selected = (draft.scene?.objects || [])[selected3DObject] || {};
        setMeshGeometryDraft3D(JSON.stringify({ vertices: selected.vertices || [], faces: selected.faces || [], ...(selected.uvs ? { uvs: selected.uvs } : {}) }, null, 2));
        setMeshGeometryError3D('');
    }, [selected3DObject, paramsKey, draft.scene?.objects?.[selected3DObject]?.vertices, draft.scene?.objects?.[selected3DObject]?.faces, draft.scene?.objects?.[selected3DObject]?.uvs]);

    const setExpressionValidationError = validation => setExpressionError3D(
        validation.valid ? '' : t(`templates.scene3d.expressionErrors.${validation.reason}`, { name: validation.detail || '' }),
    );
    const commit = (patch) => {
        const next = { ...draft, ...patch };
        setDraft(next);
        try {
            useTimelineStore.getState().updateTemplateParams(trackId, clip.id, patch);
        } catch (err) {
            console.error('[TemplatePanel] update failed:', err);
        }
    };
    const text = (key, opts = {}) => (
        <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t(`templates.fields.${key}`)}</span>
            {opts.multiline ? (
                <textarea rows={opts.rows || 4} className={`${field} font-mono`} value={draft[key] ?? ''}
                    onChange={e => setDraft({ ...draft, [key]: e.target.value })}
                    onBlur={e => commit({ [key]: e.target.value })} />
            ) : (
                <input className={field} type={opts.number ? 'number' : 'text'} value={draft[key] ?? ''}
                    onChange={e => setDraft({ ...draft, [key]: e.target.value })}
                    onBlur={e => commit({ [key]: opts.number ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value })}
                    onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
            )}
        </label>
    );
    const color = (key) => (
        <label className="flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t(`templates.fields.${key}`)}</span>
            <input type="color" value={draft[key] || '#FFE500'} onChange={e => commit({ [key]: e.target.value })}
                className="w-7 h-7 rounded border border-border bg-transparent p-0.5 cursor-pointer" />
        </label>
    );
    const scene3d = draft.scene || {};
    const objects3d = Array.isArray(scene3d.objects) ? scene3d.objects : [];
    const particles3d = scene3d.particles || {};
    const emitter3d = particles3d.emitter || {};
    const object3d = objects3d[selected3DObject] || {};
    const descendantIds3d = new Set();
    const findDescendants3d = (parentId) => {
        for (const child of objects3d) {
            if (child?.parentId === parentId && child.id && !descendantIds3d.has(child.id)) {
                descendantIds3d.add(child.id);
                findDescendants3d(child.id);
            }
        }
    };
    if (object3d.id) findDescendants3d(object3d.id);
    const update3DScene = (scenePatch) => commit({ scene: { ...scene3d, ...scenePatch } });
    const update3DParticles = (particlePatch) => update3DScene({ particles: { ...particles3d, ...particlePatch } });
    const update3DEmitter = (emitterPatch) => update3DParticles({ emitter: { ...emitter3d, ...emitterPatch } });
    const update3DObject = (objectPatch) => update3DScene({ objects: objects3d.map((object, index) => index === selected3DObject ? { ...object, ...objectPatch } : object) });
    const update3DShadowReceiver = enabled => update3DObject({ receivesShadow: enabled });
    const keyframeProperties3D = {
        positionX: { key: 'x', base: Number(object3d.position?.x) || 0, kind: 'add' },
        positionY: { key: 'y', base: Number(object3d.position?.y) || 0, kind: 'add' },
        positionZ: { key: 'z', base: Number(object3d.position?.z) || 0, kind: 'add' },
        rotationX: { key: 'rotationX', base: Number(object3d.rotation?.x) || 0, kind: 'add', axis: 'x' },
        rotationY: { key: 'rotationY', base: Number(object3d.rotation?.y) || 0, kind: 'add', axis: 'y' },
        rotationZ: { key: 'rotationZ', base: Number(object3d.rotation?.z) || 0, kind: 'add', axis: 'z' },
        scaleX: { key: 'scaleX', base: Number(object3d.scale?.x ?? 1), kind: 'multiply' },
        scaleY: { key: 'scaleY', base: Number(object3d.scale?.y ?? 1), kind: 'multiply' },
        scaleZ: { key: 'scaleZ', base: Number(object3d.scale?.z ?? 1), kind: 'multiply' },
        radius: { key: 'radius', base: Number(object3d.radius ?? (object3d.type === 'torus' ? 0.8 : 0.65)), kind: 'add' },
        height: { key: 'height', base: Number(object3d.height ?? 1.5), kind: 'add' },
        tube: { key: 'tube', base: Number(object3d.tube ?? 0.2), kind: 'add' },
        sizeX: { key: 'sizeX', base: Number(object3d.size?.x ?? 1), kind: 'add' },
        sizeY: { key: 'sizeY', base: Number(object3d.size?.y ?? 1), kind: 'add' },
        sizeZ: { key: 'sizeZ', base: Number(object3d.size?.z ?? 1), kind: 'add' },
        opacity: { key: 'opacity', base: Number(object3d.opacity ?? 1), kind: 'multiply' },
        roughness: { key: 'roughness', base: Number(object3d.material?.roughness ?? 0.62), kind: 'add' },
        metalness: { key: 'metalness', base: Number(object3d.material?.metalness ?? 0.08), kind: 'add' },
        emissiveIntensity: { key: 'emissiveIntensity', base: Number(object3d.material?.emissiveIntensity ?? 0), kind: 'add' },
        colorR: { key: 'colorR', base: parseSceneColorChannel(object3d.color || object3d.material?.color || '#7C3AED', 0), kind: 'absolute' },
        colorG: { key: 'colorG', base: parseSceneColorChannel(object3d.color || object3d.material?.color || '#7C3AED', 1), kind: 'absolute' },
        colorB: { key: 'colorB', base: parseSceneColorChannel(object3d.color || object3d.material?.color || '#7C3AED', 2), kind: 'absolute' },
        emissiveR: { key: 'emissiveR', base: parseSceneColorChannel(object3d.material?.emissiveColor || object3d.material?.emissive || '#000000', 0), kind: 'absolute' },
        emissiveG: { key: 'emissiveG', base: parseSceneColorChannel(object3d.material?.emissiveColor || object3d.material?.emissive || '#000000', 1), kind: 'absolute' },
        emissiveB: { key: 'emissiveB', base: parseSceneColorChannel(object3d.material?.emissiveColor || object3d.material?.emissive || '#000000', 2), kind: 'absolute' },
    };
    const keyframeSpec = keyframeProperties3D[selected3DProperty] || keyframeProperties3D.rotationY;
    const localPlayhead = Math.max(0, Math.min(Number(clip.duration) || 0, (Number(currentTime) || 0) - (Number(clip.start) || 0)));
    const cameraDefaults3D = SCENE3D_CAMERA_DEFAULTS;
    const camera3d = scene3d.camera || {};
    const cameraTrackId3D = `scene3d-camera-${selected3DCameraProperty}`;
    const cameraTrack3D = (camera3d.animations || []).find(animation => animation.id === cameraTrackId3D);
    const cameraTrackStart3D = Math.max(0, Number(cameraTrack3D?.startTime) || 0);
    const cameraTrackTime3D = localPlayhead - cameraTrackStart3D;
    const cameraTrackValue3D = cameraTrack3D && cameraTrackTime3D >= 0 ? sampleAnimation(cameraTrack3D, cameraTrackTime3D)[selected3DCameraProperty] : undefined;
    const cameraDof3D = camera3d.depthOfField || scene3d.depthOfField || {};
    const cameraDofProperties3D = { dofFocusDistance: ['focusDistance', Number(camera3d.z ?? cameraDefaults3D.z)], dofFocusRange: ['focusRange', 0.35], dofStrength: ['strength', 1], dofMaxBlur: ['maxBlur', 6] };
    const cameraDofProperty3D = cameraDofProperties3D[selected3DCameraProperty];
    const cameraValue3D = Number.isFinite(cameraTrackValue3D) ? cameraTrackValue3D
        : cameraDofProperty3D ? Number(cameraDof3D[cameraDofProperty3D[0]] ?? cameraDofProperty3D[1])
            : Number(camera3d[selected3DCameraProperty] ?? cameraDefaults3D[selected3DCameraProperty]);
    const lights3d = Array.isArray(scene3d.lights) && scene3d.lights.length ? scene3d.lights : [{ position: { x: -3, y: 5, z: 6 }, intensity: 0.9, color: '#FFFFFF' }];
    const light3d = lights3d[Math.min(selected3DLight, lights3d.length - 1)] || lights3d[0];
    const lightPropertyBase3D = {
        intensity: Number(light3d.intensity ?? 0.8), range: Number(light3d.range ?? 24), decay: Number(light3d.decay ?? 0.3), angle: Number(light3d.angle ?? 60),
        width: Number(light3d.width ?? 4), height: Number(light3d.height ?? 4),
        positionX: Number(light3d.position?.x ?? 0), positionY: Number(light3d.position?.y ?? 0), positionZ: Number(light3d.position?.z ?? 0),
        directionX: Number(light3d.direction?.x ?? 0), directionY: Number(light3d.direction?.y ?? 0), directionZ: Number(light3d.direction?.z ?? 0),
        targetX: Number(light3d.target?.x ?? 0), targetY: Number(light3d.target?.y ?? 0), targetZ: Number(light3d.target?.z ?? 0),
        colorR: parseSceneColorChannel(light3d.color || '#FFFFFF', 0),
        colorG: parseSceneColorChannel(light3d.color || '#FFFFFF', 1),
        colorB: parseSceneColorChannel(light3d.color || '#FFFFFF', 2),
    };
    const lightTrackId3D = `scene3d-light-${selected3DLight}-${selected3DLightProperty}`;
    const lightTrack3D = (light3d.animations || []).find(animation => animation.id === lightTrackId3D);
    const lightTrackStart3D = Math.max(0, Number(lightTrack3D?.startTime) || 0);
    const lightTrackTime3D = localPlayhead - lightTrackStart3D;
    const lightTrackValue3D = lightTrack3D && lightTrackTime3D >= 0
        ? sampleAnimation(lightTrack3D, lightTrackTime3D)[selected3DLightProperty] : undefined;
    const lightValue3D = Number.isFinite(lightTrackValue3D) ? lightTrackValue3D : lightPropertyBase3D[selected3DLightProperty];
    const add3DLightKeyframe = (value = lightValue3D) => {
        const animations = [...(light3d.animations || [])];
        const index = animations.findIndex(animation => animation.id === lightTrackId3D);
        const track = index >= 0 ? animations[index] : { id: lightTrackId3D, startTime: 0, duration: Number(clip.duration) || 1, easing: keyframeEasing, keyframes: [] };
        const keyframes = [...(track.keyframes || [])];
        if (index < 0 && localPlayhead > 0.001) keyframes.push({ time: 0, easing: 'linear', properties: { [selected3DLightProperty]: lightPropertyBase3D[selected3DLightProperty] } });
        const trackTime = Math.max(0, localPlayhead - Math.max(0, Number(track.startTime) || 0));
        const existing = keyframes.findIndex(keyframe => Math.abs(Number(keyframe.time) - trackTime) < 0.001);
        const keyframe = { ...(existing >= 0 ? keyframes[existing] : {}), time: trackTime, easing: keyframeEasing,
            properties: { ...(existing >= 0 ? keyframes[existing].properties : {}), [selected3DLightProperty]: value } };
        if (existing >= 0) keyframes[existing] = keyframe; else keyframes.push(keyframe);
        keyframes.sort((a, b) => Number(a.time) - Number(b.time));
        const nextTrack = { ...track, duration: Number(clip.duration) || track.duration || 1, easing: keyframeEasing, keyframes };
        if (index >= 0) animations[index] = nextTrack; else animations.push(nextTrack);
        update3DScene({ lights: lights3d.map((light, lightIndex) => lightIndex === Math.min(selected3DLight, lights3d.length - 1) ? { ...light, animations } : light) });
    };
    const add3DCameraKeyframe = (value = cameraValue3D) => {
        const baseValue = cameraDofProperty3D ? Number(cameraDof3D[cameraDofProperty3D[0]] ?? cameraDofProperty3D[1])
            : Number(camera3d[selected3DCameraProperty] ?? cameraDefaults3D[selected3DCameraProperty]);
        const animations = [...(camera3d.animations || [])];
        const index = animations.findIndex(animation => animation.id === cameraTrackId3D);
        const track = index >= 0 ? animations[index] : { id: cameraTrackId3D, startTime: 0, duration: Number(clip.duration) || 1, easing: keyframeEasing, keyframes: [] };
        const keyframes = [...(track.keyframes || [])];
        if (index < 0 && localPlayhead > 0.001) keyframes.push({ time: 0, easing: 'linear', properties: { [selected3DCameraProperty]: baseValue } });
        const trackTime = Math.max(0, localPlayhead - Math.max(0, Number(track.startTime) || 0));
        const existing = keyframes.findIndex(keyframe => Math.abs(Number(keyframe.time) - trackTime) < 0.001);
        const keyframe = { ...(existing >= 0 ? keyframes[existing] : {}), time: trackTime, easing: keyframeEasing, properties: { ...(existing >= 0 ? keyframes[existing].properties : {}), [selected3DCameraProperty]: value } };
        if (existing >= 0) keyframes[existing] = keyframe; else keyframes.push(keyframe);
        keyframes.sort((a, b) => Number(a.time) - Number(b.time));
        const next = { ...track, duration: Number(clip.duration) || track.duration || 1, easing: keyframeEasing, keyframes };
        if (index >= 0) animations[index] = next; else animations.push(next);
        update3DScene({ camera: { ...camera3d, animations } });
    };
    const propertyTrackId = `scene3d-track-${selected3DProperty}`;
    const propertyTrack = (object3d.animations || []).find(animation => animation.id === propertyTrackId);
    const propertyTrackStart = Math.max(0, Number(propertyTrack?.startTime) || 0);
    const propertyTrackTime = localPlayhead - propertyTrackStart;
    const sampledTrackValue = propertyTrack && propertyTrackTime >= 0 ? sampleAnimation(propertyTrack, propertyTrackTime)[keyframeSpec.key] : undefined;
    const actual3DPropertyValue = keyframeSpec.kind === 'absolute'
        ? (Number.isFinite(sampledTrackValue) ? sampledTrackValue : keyframeSpec.base)
        : keyframeSpec.kind === 'multiply'
        ? keyframeSpec.base * (Number.isFinite(sampledTrackValue) ? sampledTrackValue : 1)
        : keyframeSpec.base + (Number.isFinite(sampledTrackValue) ? sampledTrackValue : 0);
    const current3DKeyframe = propertyTrackTime >= 0 ? propertyTrack?.keyframes?.find(keyframe => Math.abs(Number(keyframe.time) - propertyTrackTime) < 0.001) : undefined;
    const add3DKeyframe = () => {
        const storedValue = keyframeSpec.kind === 'absolute' ? actual3DPropertyValue : keyframeSpec.kind === 'multiply'
            ? (Math.abs(keyframeSpec.base) < 1e-6 ? actual3DPropertyValue : actual3DPropertyValue / keyframeSpec.base)
            : actual3DPropertyValue - keyframeSpec.base;
        const animations = (object3d.animations || []).filter(animation => !(selected3DProperty === 'rotationY' && animation.id === 'scene3d-spin'));
        const trackIndex = animations.findIndex(animation => animation.id === propertyTrackId);
        const track = trackIndex >= 0 ? animations[trackIndex] : { id: propertyTrackId, startTime: 0, duration: Number(clip.duration) || 1, easing: keyframeEasing, keyframes: [] };
        const keyframes = [...(track.keyframes || [])];
        if (trackIndex < 0 && localPlayhead > 0.001) keyframes.push({ time: 0, easing: 'linear', properties: { [keyframeSpec.key]: keyframeSpec.kind === 'absolute' ? keyframeSpec.base : keyframeSpec.kind === 'multiply' ? 1 : 0 } });
        const trackTime = Math.max(0, localPlayhead - Math.max(0, Number(track.startTime) || 0));
        const existingIndex = keyframes.findIndex(keyframe => Math.abs(Number(keyframe.time) - trackTime) < 0.001);
        const keyframe = { ...(existingIndex >= 0 ? keyframes[existingIndex] : {}), time: trackTime, easing: keyframeEasing, properties: { ...(existingIndex >= 0 ? keyframes[existingIndex].properties : {}), [keyframeSpec.key]: storedValue } };
        if (existingIndex >= 0) keyframes[existingIndex] = keyframe;
        else keyframes.push(keyframe);
        keyframes.sort((a, b) => Number(a.time) - Number(b.time));
        const nextTrack = { ...track, duration: Number(clip.duration) || track.duration || 1, easing: keyframeEasing, keyframes };
        if (trackIndex >= 0) animations[trackIndex] = nextTrack;
        else animations.push(nextTrack);
        update3DObject({ animations, ...(keyframeSpec.axis ? { autoRotate: { ...(object3d.autoRotate || {}), [keyframeSpec.axis]: 0 } } : {}) });
    };
    const seek3DKeyframe = (direction) => {
        const times = (propertyTrack?.keyframes || []).map(keyframe => Number(keyframe.time)).filter(Number.isFinite).sort((a, b) => a - b);
        const trackTime = localPlayhead - propertyTrackStart;
        const target = direction < 0 ? [...times].reverse().find(time => time < trackTime - 0.001) : times.find(time => time > trackTime + 0.001);
        if (target !== undefined) useTimelineStore.getState().seek((Number(clip.start) || 0) + propertyTrackStart + target);
    };
    const timeRemap3D = object3d.timeRemap || {};
    const timeRemapKeyframes3D = Array.isArray(timeRemap3D.keyframes) ? timeRemap3D.keyframes : [];
    const hasTimeRemapCurve3D = timeRemapKeyframes3D.some(keyframe => Number.isFinite(Number(keyframe?.time)) && Number.isFinite(Number(keyframe?.value)));
    const timeRemapValue3D = remapSceneObjectTime(timeRemap3D, localPlayhead, Number(clip.duration) || 1);
    const currentTimeRemapKeyframe3D = timeRemapKeyframes3D.find(keyframe => Math.abs(Number(keyframe.time) - localPlayhead) < 0.001);
    const setTimeRemapKeyframe3D = (value = timeRemapValue3D) => {
        const duration = Math.max(0.2, Number(clip.duration) || 1);
        let keyframes = [...timeRemapKeyframes3D];
        if (!keyframes.length) {
            // Preserve the current speed/offset mapping when the first curve key
            // is added away from time zero.
            const baseRemap = { ...timeRemap3D, keyframes: [] };
            keyframes = [{ time: 0, value: remapSceneObjectTime(baseRemap, 0, duration), easing: 'linear' }];
            if (localPlayhead < duration - 0.001) keyframes.push({ time: duration, value: remapSceneObjectTime(baseRemap, duration, duration), easing: 'linear' });
        }
        const index = keyframes.findIndex(keyframe => Math.abs(Number(keyframe.time) - localPlayhead) < 0.001);
        const nextKeyframe = { ...(index >= 0 ? keyframes[index] : {}), time: localPlayhead, value: Number(value), easing: keyframeEasing };
        if (index >= 0) keyframes[index] = nextKeyframe;
        else keyframes.push(nextKeyframe);
        keyframes.sort((a, b) => Number(a.time) - Number(b.time));
        update3DObject({ timeRemap: { ...timeRemap3D, keyframes } });
    };
    const seek3DTimeRemapKeyframe = direction => {
        const times = timeRemapKeyframes3D.map(keyframe => Number(keyframe.time)).filter(Number.isFinite).sort((a, b) => a - b);
        const target = direction < 0
            ? [...times].reverse().find(time => time < localPlayhead - 0.001)
            : times.find(time => time > localPlayhead + 0.001);
        if (target !== undefined) useTimelineStore.getState().seek((Number(clip.start) || 0) + target);
    };
    const number3D = (label, value, onChange, { disabled = false, id = label } = {}) => (
        <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
            <input className={`${field}${disabled ? ' opacity-50 cursor-not-allowed' : ''}`} type="number" step="0.1" disabled={disabled} value={numberDrafts[id] ?? (Number(value) || 0)}
                onChange={e => setNumberDrafts(current => ({ ...current, [id]: e.target.value }))}
                onBlur={e => { if (e.target.value !== '') onChange(Number(e.target.value)); setNumberDrafts(current => { const next = { ...current }; delete next[id]; return next; }); }} />
        </label>
    );

    return (
        <div className="space-y-2 pt-3 mt-3 border-t border-border">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{t(`templates.kinds.${kind}`)}</div>
            {kind === 'counter' && (<>
                {text('label')}
                <div className="grid grid-cols-3 gap-2">{text('from', { number: true })}{text('value', { number: true })}{text('total', { number: true })}</div>
                {color('accent')}
            </>)}
            {kind === 'price-pop' && (<>{text('text')}{text('sub')}{color('color')}</>)}
            {kind === 'logo-card' && (<>
                {text('label')}{text('sub')}{color('accent')}
                <label className="block space-y-1">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('templates.fields.style')}</span>
                    <select className={field} value={draft.style || 'dark'} onChange={e => commit({ style: e.target.value })}>
                        <option value="dark">{t('templates.styles.darkCapsule')}</option>
                        <option value="light">{t('templates.styles.lightCapsule')}</option>
                    </select>
                </label>
                <LogoPicker value={draft.imageAssetId} onPick={(asset) => commit({ imageAssetId: asset?.id || null, imageUrl: asset ? (asset.url || asset.proxyUrl || null) : null })} />
            </>)}
            {kind === 'checklist' && (<>
                {text('items', { multiline: true, rows: 4 })}{color('accent')}{color('color')}
                <label className="block space-y-1">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('templates.fields.style')}</span>
                    <select className={field} value={draft.style || 'card'} onChange={e => commit({ style: e.target.value })}>
                        <option value="card">{t('templates.styles.standardCard')}</option>
                        <option value="clean">{t('templates.styles.cleanRows')}</option>
                    </select>
                </label>
            </>)}
            {kind === 'code-window' && (<>{text('title')}{text('code', { multiline: true, rows: 6 })}{text('cps', { number: true })}</>)}
            {kind === '3d-scene' && (<>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('templates.scene3d.objects')}</div>
                <div className="flex gap-2">
                    <select className={`${field} min-w-0`} value={selected3DObject} onChange={e => setSelected3DObject(Number(e.target.value))}>
                        {objects3d.map((object, index) => <option key={object.id || index} value={index}>{object.name || `${object.type || 'box'} ${index + 1}`}</option>)}
                    </select>
                    <button type="button" className="px-2 rounded border border-border text-xs" onClick={() => {
                        const next = [...objects3d, { id: `object-${Date.now()}`, type: 'sphere', position: { x: 1, y: 0, z: 0 }, radius: 0.55, color: '#38BDF8', autoRotate: { y: 24 } }];
                        update3DScene({ objects: next }); setSelected3DObject(next.length - 1);
                    }}>{t('templates.scene3d.add')}</button>
                    <button type="button" className="px-2 rounded border border-border text-xs disabled:opacity-40" disabled={objects3d.length < 2} onClick={() => {
                        const next = objects3d.filter((_, index) => index !== selected3DObject);
                        update3DScene({ objects: next }); setSelected3DObject(Math.max(0, Math.min(selected3DObject, next.length - 1)));
                    }}>{t('templates.scene3d.remove')}</button>
                    <button type="button" className="px-2 rounded border border-border text-xs disabled:opacity-40" disabled={selected3DObject <= 0} aria-label={t('templates.scene3d.moveBackward')} title={t('templates.scene3d.moveBackward')} onClick={() => {
                        const next = [...objects3d]; [next[selected3DObject - 1], next[selected3DObject]] = [next[selected3DObject], next[selected3DObject - 1]];
                        update3DScene({ objects: next }); setSelected3DObject(selected3DObject - 1);
                    }}>↑</button>
                    <button type="button" className="px-2 rounded border border-border text-xs disabled:opacity-40" disabled={selected3DObject >= objects3d.length - 1} aria-label={t('templates.scene3d.moveForward')} title={t('templates.scene3d.moveForward')} onClick={() => {
                        const next = [...objects3d]; [next[selected3DObject], next[selected3DObject + 1]] = [next[selected3DObject + 1], next[selected3DObject]];
                        update3DScene({ objects: next }); setSelected3DObject(selected3DObject + 1);
                    }}>↓</button>
                </div>
                <label className="block space-y-1"><span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('templates.scene3d.primitive')}</span>
                    <select className={field} value={object3d.type || 'box'} onChange={e => update3DObject({ type: e.target.value })}>
                        {['box', 'sphere', 'capsule', 'cylinder', 'cone', 'torus', 'plane', 'image', 'video', 'text', 'mesh'].map(type => <option key={type} value={type}>{type}</option>)}
                    </select>
                </label>
                {['image', 'mesh'].includes(object3d.type) && <LogoPicker labelKey="texture" value={object3d.imageAssetId} onPick={asset => update3DObject({ imageAssetId: asset?.id || null, imageUrl: asset ? (asset.url || asset.proxyUrl || null) : null })} />}
                {object3d.type === 'video' && <>
                    <LogoPicker labelKey="videoTexture" assetTypes={['video']} value={object3d.videoAssetId} onPick={asset => update3DObject({ videoAssetId: asset?.id || null, videoUrl: asset ? (asset.url || asset.proxyUrl || null) : null })} />
                    <div className="grid grid-cols-2 gap-2">
                        {number3D(t('templates.scene3d.videoStart'), object3d.videoStart ?? 0, value => update3DObject({ videoStart: Math.max(0, value) }))}
                        {number3D(t('templates.scene3d.videoSpeed'), object3d.videoSpeed ?? 1, value => update3DObject({ videoSpeed: Math.max(0.05, value) }))}
                    </div>
                    <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={object3d.videoLoop !== false} onChange={e => update3DObject({ videoLoop: e.target.checked })} />{t('templates.scene3d.videoLoop')}</label>
                </>}
                {object3d.type === 'mesh' && <label className="block space-y-1">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('templates.scene3d.meshGeometry')}</span>
                    <textarea rows={8} className={`${field} font-mono`} value={meshGeometryDraft3D}
                        onChange={event => setMeshGeometryDraft3D(event.target.value)}
                        onBlur={() => {
                            try {
                                const geometry = JSON.parse(meshGeometryDraft3D);
                                const vertices = geometry?.vertices;
                                const faces = geometry?.faces;
                                const validVertices = Array.isArray(vertices) && vertices.length >= 3 && vertices.length <= 5000
                                    && vertices.every(vertex => vertex && ['x', 'y', 'z'].every(axis => Number.isFinite(Number(vertex[axis]))));
                                const validFaces = Array.isArray(faces) && faces.length > 0 && faces.length <= 5000
                                    && faces.every(face => Array.isArray(face) && face.length >= 3 && face.length <= 64
                                        && face.every(index => Number.isInteger(index) && index >= 0 && index < vertices?.length));
                                const validUvs = geometry.uvs === undefined || (Array.isArray(geometry.uvs) && geometry.uvs.length === vertices?.length
                                    && geometry.uvs.every(uv => Array.isArray(uv) && uv.length >= 2 && uv.slice(0, 2).every(value => Number.isFinite(Number(value)))));
                                if (!validVertices || !validFaces || !validUvs) throw new Error('invalid');
                                update3DObject({ vertices, faces, ...(geometry.uvs ? { uvs: geometry.uvs } : { uvs: undefined }) });
                                setMeshGeometryError3D('');
                            } catch {
                                setMeshGeometryError3D(t('templates.scene3d.meshGeometryInvalid'));
                            }
                        }} />
                    <span className="block text-[10px] text-muted-foreground">{meshGeometryError3D || t('templates.scene3d.meshGeometryHelp')}</span>
                </label>}
                <div className="rounded border border-border p-2 space-y-2">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('templates.scene3d.audioReactive')}</div>
                    <label className="block space-y-1"><span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('templates.scene3d.audioSource')}</span>
                        <select className={field} value={object3d.audioReactive?.assetId || ''} onChange={e => update3DObject({ audioReactive: { ...(object3d.audioReactive || {}), assetId: e.target.value || null } })}>
                            <option value="">{t('templates.scene3d.audioDisabled')}</option>
                            {audioReactiveAssets.map(asset => <option key={asset.id} value={asset.id}>{asset.name || asset.id}</option>)}
                        </select>
                    </label>
                    {object3d.audioReactive?.assetId && <div className="grid grid-cols-2 gap-2">
                        <label className="block space-y-1"><span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('templates.scene3d.audioTarget')}</span>
                            <select className={field} value={object3d.audioReactive?.target || 'scale'} onChange={e => update3DObject({ audioReactive: { ...object3d.audioReactive, target: e.target.value } })}>
                                {['scale', 'rotationX', 'rotationY', 'rotationZ', 'opacity', 'positionX', 'positionY', 'positionZ', 'radius', 'height', 'tube', 'sizeX', 'sizeY', 'sizeZ'].map(target => <option key={target} value={target}>{t(`templates.scene3d.audioTargets.${target}`)}</option>)}
                            </select>
                        </label>
                        {number3D(t('templates.scene3d.audioAmount'), object3d.audioReactive?.amount ?? 0.35, value => update3DObject({ audioReactive: { ...object3d.audioReactive, amount: Math.max(-10, Math.min(10, value)) } }))}
                    </div>}
                </div>
                <label className="block space-y-1"><span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('templates.scene3d.parent')}</span>
                    <select className={field} value={object3d.parentId || ''} onChange={e => update3DObject({ parentId: e.target.value || null })}>
                        <option value="">{t('templates.scene3d.root')}</option>
                        {objects3d.map((object, index) => object.id && index !== selected3DObject && !descendantIds3d.has(object.id) ? <option key={object.id} value={object.id}>{object.name || `${object.type || 'object'} ${index + 1}`}</option> : null)}
                    </select>
                </label>
                {object3d.type === 'plane' && <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input type="checkbox" checked={object3d.receivesShadow === true} onChange={e => update3DShadowReceiver(e.target.checked)} />
                    {t('templates.scene3d.receiveShadows')}
                </label>}
                {object3d.type !== 'plane' && <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input type="checkbox" checked={object3d.castsShadow !== false} onChange={e => update3DObject({ castsShadow: e.target.checked })} />
                    {t('templates.scene3d.castShadows')}
                </label>}
                {['box', 'image', 'video', 'plane'].includes(object3d.type) && <div className="grid grid-cols-3 gap-2">
                    {['x', 'y', 'z'].map(axis => number3D(t('templates.scene3d.size', { axis: axis.toUpperCase() }), object3d.size?.[axis] ?? 1, value => update3DObject({ size: { ...(object3d.size || {}), [axis]: Math.max(0.02, value) } })))}
                </div>}
                    {['sphere', 'capsule', 'cylinder', 'cone', 'torus'].includes(object3d.type) && <div className="grid grid-cols-2 gap-2">
                    {number3D(t('templates.scene3d.radius'), object3d.radius ?? (object3d.type === 'torus' ? 0.8 : 0.65), value => update3DObject({ radius: Math.max(0.02, value) }))}
                    {['capsule', 'cylinder', 'cone'].includes(object3d.type) && number3D(t('templates.scene3d.height'), object3d.height ?? 1.5, value => update3DObject({ height: Math.max(0.02, value) }))}
                    {object3d.type === 'torus' && number3D(t('templates.scene3d.tube'), object3d.tube ?? 0.2, value => update3DObject({ tube: Math.max(0.01, value) }))}
                </div>}
                <div className="grid grid-cols-3 gap-2">
                    {['x', 'y', 'z'].map(axis => number3D(t('templates.scene3d.position', { axis: axis.toUpperCase() }), object3d.position?.[axis], value => update3DObject({ position: { ...(object3d.position || {}), [axis]: value } })))}
                </div>
                <div className="grid grid-cols-3 gap-2">
                    {['x', 'y', 'z'].map(axis => number3D(t('templates.scene3d.rotation', { axis: axis.toUpperCase() }), object3d.rotation?.[axis], value => update3DObject({ rotation: { ...(object3d.rotation || {}), [axis]: value } })))}
                </div>
                <div className="grid grid-cols-3 gap-2">
                    {['x', 'y', 'z'].map(axis => number3D(t('templates.scene3d.scale', { axis: axis.toUpperCase() }), object3d.scale?.[axis] ?? 1, value => update3DObject({ scale: { ...(object3d.scale || { x: 1, y: 1, z: 1 }), [axis]: value } } )))}
                </div>
                <label className="flex items-center justify-between gap-2"><span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('templates.scene3d.color')}</span>
                    <input type="color" value={object3d.color || '#7C3AED'} onChange={e => update3DObject({ color: e.target.value })} className="w-7 h-7 rounded border border-border bg-transparent p-0.5 cursor-pointer" />
                </label>
                <label className="block space-y-1"><span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('templates.scene3d.blendMode')}</span>
                    <select className={field} value={object3d.blendMode || 'source-over'} onChange={e => update3DObject({ blendMode: e.target.value })}>
                        {SCENE3D_BLEND_MODES.map(mode => <option key={mode} value={mode}>{t(`templates.scene3d.blendModes.${mode}`)}</option>)}
                    </select>
                </label>
                {['plane', 'image', 'video'].includes(object3d.type) && <label className="block space-y-1"><span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('templates.scene3d.mask')}</span>
                    <select className={field} value={object3d.maskShape || 'none'} onChange={e => update3DObject({ maskShape: e.target.value })}>
                        {SCENE3D_TEXTURE_MASK_SHAPES.map(shape => <option key={shape} value={shape}>{t(`templates.scene3d.masks.${shape}`)}</option>)}
                    </select>
                </label>}
                {['plane', 'image', 'video'].includes(object3d.type) && object3d.maskShape && object3d.maskShape !== 'none' &&
                    <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={!!object3d.maskInvert} onChange={e => update3DObject({ maskInvert: e.target.checked })} />{t('templates.scene3d.maskInvert')}</label>}
                {object3d.type === 'text' && <>
                    <label className="block space-y-1"><span className="text-[10px] uppercase tracking-wider text-muted-foreground">3D text</span>
                        <input className={field} value={text3DDraft} onChange={e => setText3DDraft(e.target.value)} onBlur={() => update3DObject({ content: text3DDraft })} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                        {number3D(t('templates.scene3d.fontSize'), object3d.fontSize ?? 0.72, value => update3DObject({ fontSize: Math.max(0.05, Math.min(3, value)) }))}
                        {number3D(t('templates.scene3d.extrusionDepth'), object3d.depth ?? 8, value => update3DObject({ depth: Math.max(0, Math.min(32, Math.round(value))) }))}
                        {number3D(t('templates.scene3d.fontWeight'), object3d.fontWeight ?? 800, value => update3DObject({ fontWeight: Math.max(100, Math.min(900, Math.round(value / 100) * 100)) }))}
                    </div>
                    <label className="block space-y-1"><span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('templates.scene3d.fontFamily')}</span>
                        <select className={field} value={object3d.fontFamily || 'Arial'} onChange={e => update3DObject({ fontFamily: e.target.value })}>
                            {['Arial', 'Inter', 'Georgia', 'Helvetica', 'Times New Roman', 'Verdana', 'Trebuchet MS', 'monospace'].map(font => <option key={font} value={font}>{font}</option>)}
                        </select>
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                        <label className="block space-y-1"><span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('templates.scene3d.textAlign')}</span>
                            <select className={field} value={object3d.textAlign || 'center'} onChange={e => update3DObject({ textAlign: e.target.value })}>
                                {['left', 'center', 'right'].map(align => <option key={align} value={align}>{t(`templates.scene3d.alignments.${align}`)}</option>)}
                            </select>
                        </label>
                        <label className="flex items-center justify-between gap-2"><span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('templates.scene3d.extrusionColor')}</span>
                            <input type="color" value={object3d.sideColor || '#3730A3'} onChange={e => update3DObject({ sideColor: e.target.value })} className="w-7 h-7 rounded border border-border bg-transparent p-0.5 cursor-pointer" />
                        </label>
                    </div>
                </>}
                {object3d.type !== 'text' && <div className="grid grid-cols-2 gap-2">
                    {number3D(t('templates.scene3d.roughness'), object3d.material?.roughness ?? 0.62, value => update3DObject({ material: { ...(object3d.material || {}), roughness: Math.max(0.04, Math.min(1, value)) } }))}
                    {number3D(t('templates.scene3d.metalness'), object3d.material?.metalness ?? 0.08, value => update3DObject({ material: { ...(object3d.material || {}), metalness: Math.max(0, Math.min(1, value)) } }))}
                    {number3D(t('templates.scene3d.materialOpacity'), object3d.material?.opacity ?? 1, value => update3DObject({ material: { ...(object3d.material || {}), opacity: Math.max(0, Math.min(1, value)) } }))}
                    {number3D(t('templates.scene3d.emissiveIntensity'), object3d.material?.emissiveIntensity ?? 0, value => update3DObject({ material: { ...(object3d.material || {}), emissiveIntensity: Math.max(0, Math.min(10, value)) } }))}
                    <label className="flex items-center justify-between gap-2"><span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('templates.scene3d.emissiveColor')}</span>
                        <input type="color" value={object3d.material?.emissiveColor || '#FFFFFF'} onChange={e => update3DObject({ material: { ...(object3d.material || {}), emissiveColor: e.target.value } })} className="w-7 h-7 rounded border border-border bg-transparent p-0.5 cursor-pointer" />
                    </label>
                </div>}
                <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={!!object3d.wireframe} onChange={e => update3DObject({ wireframe: e.target.checked })} />{t('templates.scene3d.wireframe')}</label>
                {object3d.wireframe && <div className="grid grid-cols-2 gap-2">
                    {number3D(t('templates.scene3d.wireframeWidth'), object3d.wireframeWidth ?? 1.5, value => update3DObject({ wireframeWidth: Math.max(0.5, Math.min(8, value)) }))}
                    <label className="flex items-center justify-between gap-2"><span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('templates.scene3d.wireframeColor')}</span><input type="color" value={object3d.wireColor || '#FFFFFF'} onChange={e => update3DObject({ wireColor: e.target.value })} className="w-7 h-7 rounded border border-border bg-transparent p-0.5 cursor-pointer" /></label>
                </div>}
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('templates.scene3d.camera')}</div>
                <label className="block space-y-1"><span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('templates.scene3d.projection')}</span>
                    <select className={field} value={scene3d.camera?.projection || 'perspective'} onChange={e => update3DScene({ camera: { ...(scene3d.camera || {}), projection: e.target.value } })}>
                        <option value="perspective">{t('templates.scene3d.perspective')}</option>
                        <option value="orthographic">{t('templates.scene3d.orthographic')}</option>
                    </select>
                </label>
                <div className="grid grid-cols-2 gap-2">
                    {number3D(t('templates.scene3d.cameraX'), scene3d.camera?.x, value => update3DScene({ camera: { ...(scene3d.camera || {}), x: value } }))}
                    {number3D(t('templates.scene3d.cameraY'), scene3d.camera?.y, value => update3DScene({ camera: { ...(scene3d.camera || {}), y: value } }))}
                    {number3D(t('templates.scene3d.yaw'), scene3d.camera?.yaw, value => update3DScene({ camera: { ...(scene3d.camera || {}), yaw: value } }))}
                    {number3D(t('templates.scene3d.pitch'), scene3d.camera?.pitch, value => update3DScene({ camera: { ...(scene3d.camera || {}), pitch: value } }))}
                    {number3D(t('templates.scene3d.roll'), scene3d.camera?.roll, value => update3DScene({ camera: { ...(scene3d.camera || {}), roll: value } }))}
                    {number3D(t('templates.scene3d.distance'), scene3d.camera?.z ?? 7, value => update3DScene({ camera: { ...(scene3d.camera || {}), z: value } }))}
                    {scene3d.camera?.projection === 'orthographic'
                        ? number3D(t('templates.scene3d.orthoScale'), scene3d.camera?.orthoScale ?? 180, value => update3DScene({ camera: { ...(scene3d.camera || {}), orthoScale: value } }))
                        : number3D(t('templates.scene3d.focalLength'), scene3d.camera?.fov ?? 780, value => update3DScene({ camera: { ...(scene3d.camera || {}), fov: value } }))}
                    {number3D(t('templates.scene3d.nearPlane'), scene3d.camera?.near ?? 0.05, value => update3DScene({ camera: { ...(scene3d.camera || {}), near: Math.max(0.01, Math.min(100, value)) } }))}
                    {number3D(t('templates.scene3d.farPlane'), scene3d.camera?.far ?? 1000, value => update3DScene({ camera: { ...(scene3d.camera || {}), far: Math.max(0.02, Math.min(100000, value)) } }))}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('templates.scene3d.cameraAnimation')}</div>
                <select className={field} value={selected3DCameraProperty} onChange={e => { setSelected3DCameraProperty(e.target.value); setExpressionError3D(''); }} aria-label={t('templates.scene3d.cameraProperty')}>
                    {['x', 'y', 'z', 'yaw', 'pitch', 'roll', 'fov', 'orthoScale', 'near', 'far', 'dofFocusDistance', 'dofFocusRange', 'dofStrength', 'dofMaxBlur'].map(property => <option key={property} value={property}>{t(`templates.scene3d.cameraProperties.${property}`)}</option>)}
                </select>
                {number3D(t(`templates.scene3d.cameraProperties.${selected3DCameraProperty}`), cameraValue3D, add3DCameraKeyframe)}
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>{t('templates.scene3d.playheadValue', { value: Number(cameraValue3D.toFixed(3)) })}</span>
                    <span>{t('templates.scene3d.cameraKeyframeCount', { count: cameraTrack3D?.keyframes?.length || 0 })}</span>
                </div>
                <button type="button" className="px-2 py-1 rounded border border-border text-xs" onClick={add3DCameraKeyframe}>{t('templates.scene3d.addCameraKeyframe')}</button>
                <div className="rounded border border-border p-2 space-y-2">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Camera expression</div>
                    <input key={`${selected3DCameraProperty}:${paramsKey}`} className={`${field} font-mono ${expressionError3D ? 'border-destructive' : ''}`} aria-invalid={!!expressionError3D} aria-describedby={expressionError3D ? 'scene3d-expression-error' : undefined} defaultValue={camera3d.expressions?.[selected3DCameraProperty] || ''} placeholder="0.5 * sin(2 * pi * t)" onChange={() => setExpressionError3D('')} onBlur={e => {
                        const expression = e.currentTarget.value;
                        const expressions = { ...(camera3d.expressions || {}) };
                        if (expression.trim()) {
                            const validation = validateMotionExpression(expression);
                            if (!validation.valid) { setExpressionValidationError(validation); return; }
                            expressions[selected3DCameraProperty] = expression.trim();
                        } else delete expressions[selected3DCameraProperty];
                        setExpressionError3D('');
                        update3DScene({ camera: { ...camera3d, expressions } });
                    }} />
                    <div className="text-[10px] text-muted-foreground">Applied to the selected camera property using composition time in seconds.</div>
                    {expressionError3D && <div id="scene3d-expression-error" role="alert" className="text-xs text-destructive">{t('templates.scene3d.expressionInvalid', { reason: expressionError3D })}</div>}
                </div>
                {(() => {
                    const camera = scene3d.camera || {};
                    const depthOfField = camera.depthOfField || scene3d.depthOfField || {};
                    const updateDepthOfField = patch => update3DScene({
                        depthOfField: undefined,
                        camera: { ...camera, depthOfField: { ...depthOfField, ...patch } },
                    });
                    return <div className="rounded border border-border p-2 space-y-2">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('templates.scene3d.depthOfField')}</div>
                        <label className="flex items-center gap-2 text-xs text-muted-foreground">
                            <input type="checkbox" checked={!!depthOfField.enabled} onChange={e => updateDepthOfField({ enabled: e.target.checked })} />
                            {t('templates.scene3d.enableDepthOfField')}
                        </label>
                        {depthOfField.enabled && <div className="grid grid-cols-2 gap-2">
                            {number3D(t('templates.scene3d.focusDistance'), depthOfField.focusDistance ?? scene3d.camera?.z ?? 7, value => updateDepthOfField({ focusDistance: Math.max(0.1, Math.min(100000, value)) }))}
                            {number3D(t('templates.scene3d.focusRange'), depthOfField.focusRange ?? 0.35, value => updateDepthOfField({ focusRange: Math.max(0, Math.min(100, value)) }))}
                            {number3D(t('templates.scene3d.dofStrength'), depthOfField.strength ?? 1, value => updateDepthOfField({ strength: Math.max(0, Math.min(2, value)) }))}
                            {number3D(t('templates.scene3d.maxBlur'), depthOfField.maxBlur ?? 6, value => updateDepthOfField({ maxBlur: Math.max(0, Math.min(12, value)) }))}
                        </div>}
                    </div>;
                })()}
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('templates.scene3d.lighting')}</div>
                {number3D(t('templates.scene3d.ambient'), scene3d.ambient ?? 0.24, value => update3DScene({ ambient: value }))}
                {(() => {
                    const lights = lights3d;
                    const lightIndex = Math.min(selected3DLight, lights.length - 1);
                    const light = lights[lightIndex] || lights[0];
                    const updateLight = (patch) => update3DScene({ lights: lights.map((item, index) => index === lightIndex ? { ...item, ...patch } : item) });
                    return <>
                        <div className="flex gap-2">
                            <select className={`${field} min-w-0`} value={lightIndex} onChange={e => setSelected3DLight(Number(e.target.value))} aria-label={t('templates.scene3d.selectLight')}>
                                {lights.map((item, index) => <option key={item.id || index} value={index}>{item.name || `${t('templates.scene3d.light')} ${index + 1}`}</option>)}
                            </select>
                            <button type="button" className="px-2 rounded border border-border text-xs disabled:opacity-40" disabled={lights.length >= 8} onClick={() => {
                                const next = [...lights, { id: `light-${Date.now()}`, name: `${t('templates.scene3d.light')} ${lights.length + 1}`, type: 'point', position: { x: -3, y: 5, z: 6 }, intensity: 0.9, color: '#FFFFFF' }];
                                update3DScene({ lights: next }); setSelected3DLight(next.length - 1);
                            }}>{t('templates.scene3d.addLight')}</button>
                            <button type="button" className="px-2 rounded border border-border text-xs disabled:opacity-40" disabled={lights.length < 2} onClick={() => {
                                const next = lights.filter((_, index) => index !== lightIndex);
                                update3DScene({ lights: next }); setSelected3DLight(Math.max(0, lightIndex - 1));
                            }}>{t('templates.scene3d.removeLight')}</button>
                        </div>
                        <label className="block space-y-1"><span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('templates.scene3d.lightType')}</span>
                            <select className={field} value={light.type || 'point'} onChange={e => updateLight({ type: e.target.value, ...(e.target.value === 'directional' ? { direction: light.direction || { x: 0, y: 0, z: -1 } } : {}), ...(['spot', 'area'].includes(e.target.value) ? { target: light.target || { x: 0, y: 0, z: 0 } } : {}) })}>
                                {['point', 'directional', 'spot', 'area'].map(type => <option key={type} value={type}>{t(`templates.scene3d.lightTypes.${type}`)}</option>)}
                            </select>
                        </label>
                        <div className="grid grid-cols-3 gap-2">
                            {(light.type === 'directional' ? ['x', 'y', 'z'] : ['x', 'y', 'z']).map(axis => number3D(t(light.type === 'directional' ? 'templates.scene3d.lightDirection' : 'templates.scene3d.lightPosition', { axis: axis.toUpperCase() }), (light.type === 'directional' ? light.direction : light.position)?.[axis], value => updateLight(light.type === 'directional' ? { direction: { ...(light.direction || {}), [axis]: value } } : { position: { ...(light.position || {}), [axis]: value } })))}
                        </div>
                        {number3D(t('templates.scene3d.lightIntensity'), light.intensity ?? 0.9, value => updateLight({ intensity: value }))}
                        <label className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                            <span>{t('templates.scene3d.lightCastsShadow')}</span>
                            <input type="checkbox" checked={light.castsShadow !== false} onChange={e => updateLight({ castsShadow: e.target.checked })} />
                        </label>
                        {light.type !== 'directional' && <div className="grid grid-cols-2 gap-2">
                            {number3D(t('templates.scene3d.lightRange'), light.range ?? 24, value => updateLight({ range: Math.max(0.1, value) }))}
                            {number3D(t('templates.scene3d.lightDecay'), light.decay ?? 0.3, value => updateLight({ decay: Math.max(0, value) }))}
                        </div>}
                        {light.type === 'spot' && <>
                            <div className="grid grid-cols-3 gap-2">{['x', 'y', 'z'].map(axis => number3D(t('templates.scene3d.lightTarget', { axis: axis.toUpperCase() }), light.target?.[axis], value => updateLight({ target: { ...(light.target || {}), [axis]: value } })))}</div>
                            {number3D(t('templates.scene3d.spotAngle'), light.angle ?? 60, value => updateLight({ angle: Math.max(1, Math.min(179, value)) }))}
                        </>}
                        {light.type === 'area' && <>
                            {['x', 'y', 'z'].map(axis => number3D(t('templates.scene3d.lightTarget', { axis: axis.toUpperCase() }), light.target?.[axis], value => updateLight({ target: { ...(light.target || {}), [axis]: value } })))}
                            {number3D(t('templates.scene3d.lightWidth'), light.width ?? 4, value => updateLight({ width: Math.max(0.1, value) }), 0.1)}
                            {number3D(t('templates.scene3d.lightHeight'), light.height ?? 4, value => updateLight({ height: Math.max(0.1, value) }), 0.1)}
                        </>}
                        <label className="flex items-center justify-between gap-2"><span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('templates.scene3d.lightColor')}</span><input type="color" value={light.color || '#FFFFFF'} onChange={e => updateLight({ color: e.target.value })} className="w-7 h-7 rounded border border-border bg-transparent p-0.5 cursor-pointer" /></label>
                        <div className="border-t border-border/50 pt-2 space-y-2">
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('templates.scene3d.lightAnimation')}</div>
                            <select className={field} value={selected3DLightProperty} onChange={e => { setSelected3DLightProperty(e.target.value); setExpressionError3D(''); }} aria-label={t('templates.scene3d.lightAnimationProperty')}>
                                {['intensity', 'range', 'decay', 'angle', 'width', 'height', 'positionX', 'positionY', 'positionZ', 'directionX', 'directionY', 'directionZ', 'targetX', 'targetY', 'targetZ', 'colorR', 'colorG', 'colorB'].map(property => <option key={property} value={property}>{t(`templates.scene3d.lightProperties.${property}`)}</option>)}
                            </select>
                            {number3D(t(`templates.scene3d.lightProperties.${selected3DLightProperty}`), lightValue3D,
                                value => add3DLightKeyframe(['colorR', 'colorG', 'colorB'].includes(selected3DLightProperty) ? Math.max(0, Math.min(255, Math.round(value))) : value))}
                            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                                <span>{t('templates.scene3d.playheadValue', { value: Number(lightValue3D.toFixed(3)) })}</span>
                                <span>{t('templates.scene3d.cameraKeyframeCount', { count: lightTrack3D?.keyframes?.length || 0 })}</span>
                            </div>
                            <button type="button" className="px-2 py-1 rounded border border-border text-xs" onClick={add3DLightKeyframe}>{t('templates.scene3d.addLightKeyframe')}</button>
                            <label className="block space-y-1">
                                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('templates.scene3d.lightExpression')}</span>
                                <input key={`${selected3DLight}:${selected3DLightProperty}:${paramsKey}`} className={`${field} font-mono ${expressionError3D ? 'border-destructive' : ''}`} aria-invalid={!!expressionError3D} aria-describedby={expressionError3D ? 'scene3d-expression-error' : undefined}
                                    defaultValue={light.expressions?.[selected3DLightProperty] || ''}
                                    placeholder="0.6 + 0.3 * sin(2 * pi * t)"
                                    onChange={() => setExpressionError3D('')}
                                    onBlur={e => {
                                        const expressions = { ...(light.expressions || {}) };
                                        if (e.currentTarget.value.trim()) {
                                            const validation = validateMotionExpression(e.currentTarget.value);
                                            if (!validation.valid) { setExpressionValidationError(validation); return; }
                                            expressions[selected3DLightProperty] = e.currentTarget.value.trim();
                                        } else delete expressions[selected3DLightProperty];
                                        setExpressionError3D('');
                                        updateLight({ expressions });
                                    }} />
                                <span className="block text-[10px] text-muted-foreground">{t('templates.scene3d.lightExpressionHelp')}</span>
                                {expressionError3D && <span id="scene3d-expression-error" role="alert" className="block text-xs text-destructive">{t('templates.scene3d.expressionInvalid', { reason: expressionError3D })}</span>}
                            </label>
                        </div>
                    </>;
                })()}
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('templates.scene3d.motionBlur')}</div>
                <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={!!scene3d.motionBlur?.enabled} onChange={e => update3DScene({ motionBlur: { ...(scene3d.motionBlur || {}), enabled: e.target.checked } })} />{t('templates.scene3d.enableMotionBlur')}</label>
                {scene3d.motionBlur?.enabled && <div className="grid grid-cols-2 gap-2">
                    {number3D(t('templates.scene3d.shutterAngle'), scene3d.motionBlur?.shutterAngle ?? 180, value => update3DScene({ motionBlur: { ...(scene3d.motionBlur || {}), shutterAngle: Math.max(0, Math.min(360, value)) } }))}
                    {number3D(t('templates.scene3d.blurSamples'), scene3d.motionBlur?.samples ?? 3, value => update3DScene({ motionBlur: { ...(scene3d.motionBlur || {}), samples: Math.max(2, Math.min(5, Math.round(value))) } }))}
                </div>}
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('templates.scene3d.shadows')}</div>
                <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={scene3d.shadows?.enabled !== false} onChange={e => update3DScene({ shadows: { ...(scene3d.shadows || {}), enabled: e.target.checked } })} />{t('templates.scene3d.enableShadows')}</label>
                <div className="grid grid-cols-3 gap-2">
                    {number3D(t('templates.scene3d.groundY'), scene3d.shadows?.groundY ?? -1.8, value => update3DScene({ shadows: { ...(scene3d.shadows || {}), groundY: value } }))}
                    {number3D(t('templates.scene3d.shadowOpacity'), scene3d.shadows?.opacity ?? 0.24, value => update3DScene({ shadows: { ...(scene3d.shadows || {}), opacity: Math.max(0, Math.min(0.75, value)) } }))}
                    {number3D(t('templates.scene3d.shadowBlur'), scene3d.shadows?.blur ?? 12, value => update3DScene({ shadows: { ...(scene3d.shadows || {}), blur: Math.max(0, Math.min(80, value)) } }))}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('templates.scene3d.particles')}</div>
                <div className="grid grid-cols-3 gap-2">
                    {number3D(t('templates.scene3d.particleCount'), scene3d.particles?.count ?? 0, value => update3DScene({ particles: { ...(scene3d.particles || {}), count: Math.max(0, Math.min(2_000, Math.round(value))) } }))}
                    {number3D(t('templates.scene3d.particleSize'), scene3d.particles?.size ?? 5, value => update3DScene({ particles: { ...(scene3d.particles || {}), size: value } }))}
                    {number3D(t('templates.scene3d.particleSpeed'), scene3d.particles?.speed ?? 0.18, value => update3DScene({ particles: { ...(scene3d.particles || {}), speed: value } }))}
                </div>
                <label className="block space-y-1"><span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('templates.scene3d.particleShape')}</span>
                    <select className={field} value={scene3d.particles?.shape || 'circle'} onChange={e => update3DScene({ particles: { ...(scene3d.particles || {}), shape: e.target.value } })}>
                        {['circle', 'square', 'diamond', 'star'].map(shape => <option key={shape} value={shape}>{t(`templates.scene3d.particleShapes.${shape}`)}</option>)}
                    </select>
                </label>
                <label className="flex items-center justify-between gap-2"><span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('templates.scene3d.particleColor')}</span>
                    <input type="color" value={scene3d.particles?.color || '#A78BFA'} onChange={e => update3DScene({ particles: { ...(scene3d.particles || {}), color: e.target.value } })} className="w-7 h-7 rounded border border-border bg-transparent p-0.5 cursor-pointer" />
                </label>
                <details className="rounded border border-border/70 p-2 space-y-2">
                    <summary className="cursor-pointer text-[10px] uppercase tracking-wider text-muted-foreground">{t('templates.scene3d.particleSimulation')}</summary>
                    <div className="space-y-2 pt-2">
                        <div className="grid grid-cols-2 gap-2">
                            <label className="block space-y-1"><span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('templates.scene3d.emitterShape')}</span>
                                <select className={field} value={emitter3d.shape || 'box'} onChange={e => update3DEmitter({ shape: e.target.value })}>
                                    {['point', 'box', 'sphere', 'ring'].map(shape => <option key={shape} value={shape}>{t(`templates.scene3d.emitterShapes.${shape}`)}</option>)}
                                </select>
                            </label>
                            <label className="block space-y-1"><span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('templates.scene3d.emissionMode')}</span>
                                <select className={field} value={emitter3d.mode || 'continuous'} onChange={e => update3DEmitter({ mode: e.target.value })}>
                                    {['continuous', 'burst'].map(mode => <option key={mode} value={mode}>{t(`templates.scene3d.emissionModes.${mode}`)}</option>)}
                                </select>
                            </label>
                        </div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('templates.scene3d.emitterPosition')}</div>
                        <div className="grid grid-cols-3 gap-2">{['x', 'y', 'z'].map(axis => number3D(t('templates.scene3d.axis', { axis: axis.toUpperCase() }), emitter3d.position?.[axis] ?? 0, value => update3DEmitter({ position: { ...(emitter3d.position || {}), [axis]: value } }), { id: `particles-emitter-position-${axis}` }))}</div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{t(emitter3d.shape === 'sphere' || emitter3d.shape === 'ring' ? 'templates.scene3d.emitterRadii' : 'templates.scene3d.emitterSize')}</div>
                        <div className="grid grid-cols-3 gap-2">{['x', 'y', 'z'].map(axis => number3D(t('templates.scene3d.axis', { axis: axis.toUpperCase() }), emitter3d.size?.[axis] ?? (axis === 'y' ? 1 : Number(particles3d.spread) || 3.8), value => update3DEmitter({ size: { ...(emitter3d.size || {}), [axis]: Math.max(0, Math.min(50, value)) } }), { id: `particles-emitter-size-${axis}` }))}</div>
                        {emitter3d.shape === 'ring' && number3D(t('templates.scene3d.ringInnerRadius'), emitter3d.innerRatio ?? 0.65, value => update3DEmitter({ innerRatio: Math.max(0, Math.min(0.99, value)) }))}
                        <div className="grid grid-cols-2 gap-2">
                            {number3D(t('templates.scene3d.particleLifetime'), particles3d.lifetime ?? 4, value => update3DParticles({ lifetime: Math.max(0.05, Math.min(120, value)) }))}
                            {number3D(t('templates.scene3d.particleTurbulence'), particles3d.turbulence ?? 0, value => update3DParticles({ turbulence: Math.max(0, Math.min(20, value)) }))}
                            {number3D(t('templates.scene3d.turbulenceFrequency'), particles3d.turbulenceFrequency ?? 1.5, value => update3DParticles({ turbulenceFrequency: Math.max(0.1, Math.min(30, value)) }))}
                            {number3D(t('templates.scene3d.particleFadeIn'), particles3d.fadeIn ?? 0.15, value => update3DParticles({ fadeIn: Math.max(0, Math.min(Number(particles3d.lifetime) || 4, value)) }))}
                            {number3D(t('templates.scene3d.particleFadeOut'), particles3d.fadeOut ?? 0.35, value => update3DParticles({ fadeOut: Math.max(0, Math.min(Number(particles3d.lifetime) || 4, value)) }))}
                        </div>
                        <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={particles3d.loop !== false} onChange={e => update3DParticles({ loop: e.target.checked })} />{t('templates.scene3d.loopParticles')}</label>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('templates.scene3d.particleVelocity')}</div>
                        <div className="grid grid-cols-3 gap-2">{['x', 'y', 'z'].map(axis => number3D(t('templates.scene3d.axis', { axis: axis.toUpperCase() }), particles3d.velocity?.[axis] ?? 0, value => update3DParticles({ velocity: { ...(particles3d.velocity || {}), [axis]: Math.max(-20, Math.min(20, value)) } }), { id: `particles-velocity-${axis}` }))}</div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('templates.scene3d.particleGravity')}</div>
                        <div className="grid grid-cols-3 gap-2">{['x', 'y', 'z'].map(axis => number3D(t('templates.scene3d.axis', { axis: axis.toUpperCase() }), particles3d.gravity?.[axis] ?? 0, value => update3DParticles({ gravity: { ...(particles3d.gravity || {}), [axis]: Math.max(-20, Math.min(20, value)) } }), { id: `particles-gravity-${axis}` }))}</div>
                    </div>
                </details>
            <label className="block space-y-1"><span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('templates.scene3d.audioSource')}</span>
                <select className={field} value={scene3d.particles?.audioReactive?.assetId || ''} onChange={e => update3DScene({ particles: { ...(scene3d.particles || {}), audioReactive: { ...(scene3d.particles?.audioReactive || {}), assetId: e.target.value || null } } })}>
                    <option value="">{t('templates.scene3d.audioDisabled')}</option>
                    {audioReactiveAssets.map(asset => <option key={asset.id} value={asset.id}>{asset.name || asset.id}</option>)}
                </select>
            </label>
            {scene3d.particles?.audioReactive?.assetId && <div className="grid grid-cols-2 gap-2">
                <label className="block space-y-1"><span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('templates.scene3d.particleAudioTarget')}</span>
                    <select className={field} value={scene3d.particles.audioReactive.target || 'size'} onChange={e => update3DScene({ particles: { ...scene3d.particles, audioReactive: { ...scene3d.particles.audioReactive, target: e.target.value } } })}>
                        {['size', 'spread', 'speed', 'opacity'].map(target => <option key={target} value={target}>{t(`templates.scene3d.particleAudioTargets.${target}`)}</option>)}
                    </select>
                </label>
                {number3D(t('templates.scene3d.audioAmount'), scene3d.particles.audioReactive.amount ?? 0.5, value => update3DScene({ particles: { ...scene3d.particles, audioReactive: { ...scene3d.particles.audioReactive, amount: Math.max(-1, Math.min(3, value)) } } }))}
            </div>}
                {number3D(t('templates.scene3d.autoRotate'), object3d.autoRotate?.y, value => update3DObject({ autoRotate: { ...(object3d.autoRotate || {}), y: value } }))}
                {number3D(t('templates.scene3d.opacity'), object3d.opacity ?? 1, value => update3DObject({ opacity: Math.max(0, Math.min(1, value)) }))}
                <div className="rounded border border-border p-2 space-y-2">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('templates.scene3d.proceduralMotion')}</div>
                    <select className={field} value={expressionProperty3D} onChange={e => setExpressionProperty3D(e.target.value)}>
                        {['scale', 'rotationX', 'rotationY', 'rotationZ', 'opacity', 'x', 'y', 'z', 'radius', 'height', 'tube', 'sizeX', 'sizeY', 'sizeZ', 'colorR', 'colorG', 'colorB', ...(object3d.type === 'text' ? [] : ['roughness', 'metalness', 'emissiveIntensity', 'emissiveR', 'emissiveG', 'emissiveB'])].map(property => <option key={property} value={property}>{property}</option>)}
                    </select>
                    <input className={`${field} font-mono ${expressionError3D ? 'border-destructive' : ''}`} value={expressionDraft3D} aria-invalid={!!expressionError3D} aria-describedby={expressionError3D ? 'scene3d-expression-error' : undefined} placeholder="1 + 0.12 * sin(2 * pi * t)" onChange={e => { setExpressionDraft3D(e.target.value); setExpressionError3D(''); }} onBlur={() => {
                        const expressions = { ...(object3d.expressions || {}) };
                        if (expressionDraft3D.trim()) {
                            const validation = validateMotionExpression(expressionDraft3D);
                            if (!validation.valid) { setExpressionValidationError(validation); return; }
                            expressions[expressionProperty3D] = expressionDraft3D.trim();
                        } else delete expressions[expressionProperty3D];
                        setExpressionError3D('');
                        update3DObject({ expressions });
                    }} />
                    <div className="text-[10px] text-muted-foreground">{t('templates.scene3d.expressionHelp')}</div>
                    {expressionError3D && <div id="scene3d-expression-error" role="alert" className="text-xs text-destructive">{t('templates.scene3d.expressionInvalid', { reason: expressionError3D })}</div>}
                </div>
                <div className="rounded border border-border p-2 space-y-2">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('templates.scene3d.keyframes')}</div>
                    <label className="block space-y-1"><span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('templates.scene3d.property')}</span>
                        <select className={field} value={selected3DProperty} onChange={e => setSelected3DProperty(e.target.value)}>
                            {Object.keys(keyframeProperties3D).filter(property => object3d.type !== 'text' || !['roughness', 'metalness', 'emissiveIntensity', 'emissiveR', 'emissiveG', 'emissiveB'].includes(property)).map(property => <option key={property} value={property}>{t(`templates.scene3d.properties.${property}`)}</option>)}
                        </select>
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                        <div className="text-xs text-muted-foreground self-center">{t('templates.scene3d.playheadValue', { value: Number(actual3DPropertyValue.toFixed(3)) })}</div>
                        {keyframeSpec.kind === 'absolute' && <input aria-label={t(`templates.scene3d.properties.${selected3DProperty}`)} className={field} type="number" min="0" max="255" step="1" value={Math.round(actual3DPropertyValue)} onChange={event => {
                            const nextValue = Math.max(0, Math.min(255, Number(event.target.value) || 0));
                            const animations = [...(object3d.animations || [])];
                            const trackIndex = animations.findIndex(animation => animation.id === propertyTrackId);
                            const track = trackIndex >= 0 ? animations[trackIndex] : { id: propertyTrackId, startTime: 0, duration: Number(clip.duration) || 1, easing: keyframeEasing, keyframes: [] };
                            const keyframes = [...(track.keyframes || [])];
                            const trackTime = Math.max(0, localPlayhead - Math.max(0, Number(track.startTime) || 0));
                            if (trackIndex < 0 && localPlayhead > 0.001) keyframes.push({ time: 0, easing: 'linear', properties: { [keyframeSpec.key]: keyframeSpec.base } });
                            const existingIndex = keyframes.findIndex(keyframe => Math.abs(Number(keyframe.time) - trackTime) < 0.001);
                            const frame = { ...(existingIndex >= 0 ? keyframes[existingIndex] : {}), time: trackTime, easing: keyframeEasing, properties: { ...(existingIndex >= 0 ? keyframes[existingIndex].properties : {}), [keyframeSpec.key]: nextValue } };
                            if (existingIndex >= 0) keyframes[existingIndex] = frame; else keyframes.push(frame);
                            keyframes.sort((a, b) => Number(a.time) - Number(b.time));
                            const nextTrack = { ...track, duration: Number(clip.duration) || track.duration || 1, keyframes };
                            if (trackIndex >= 0) animations[trackIndex] = nextTrack; else animations.push(nextTrack);
                            update3DObject({ animations });
                        }} />}
                        <select className={field} value={keyframeEasing} onChange={e => setKeyframeEasing(e.target.value)} aria-label={t('templates.scene3d.easing')}>
                            {['linear', 'easeInCubic', 'easeOutCubic', 'easeInOutCubic', 'backOut'].map(easing => <option key={easing} value={easing}>{easing}</option>)}
                        </select>
                    </div>
                    <div className="flex items-center gap-1">
                        <button type="button" className="px-2 py-1 rounded border border-border text-xs" onClick={() => seek3DKeyframe(-1)}>{t('templates.scene3d.previousKeyframe')}</button>
                        <button type="button" className="px-2 py-1 rounded border border-border text-xs" onClick={add3DKeyframe}>{current3DKeyframe ? t('templates.scene3d.updateKeyframe') : t('templates.scene3d.addKeyframe')}</button>
                        <button type="button" className="px-2 py-1 rounded border border-border text-xs" onClick={() => seek3DKeyframe(1)}>{t('templates.scene3d.nextKeyframe')}</button>
                    </div>
                    <div className="text-[10px] text-muted-foreground">{t('templates.scene3d.keyframeCount', { count: propertyTrack?.keyframes?.length || 0 })}</div>
                </div>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input type="checkbox" checked={(object3d.animations || []).some(animation => animation.id === 'scene3d-spin')} onChange={e => {
                        const rest = (object3d.animations || []).filter(animation => animation.id !== 'scene3d-spin');
                        const animations = e.target.checked ? [...rest, { id: 'scene3d-spin', startTime: 0, duration: Math.max(0.5, Number(clip.duration) || 3), easing: 'easeInOutCubic', keyframes: [
                            { time: 0, properties: { rotationY: 0 } },
                            { time: Math.max(0.5, Number(clip.duration) || 3), properties: { rotationY: 360 } },
                        ] }] : rest;
                        // The keyframed spin replaces procedural rotation on Y;
                        // running both at once makes the object spin twice as fast.
                        update3DObject({ animations, ...(e.target.checked ? { autoRotate: { ...(object3d.autoRotate || {}), y: 0 } } : {}) });
                    }} />{t('templates.scene3d.keyframedRotation')}
                </label>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('templates.scene3d.timeRemapping')}</div>
                <div className="grid grid-cols-2 gap-2">
                    {number3D(t('templates.scene3d.timeSpeed'), timeRemap3D.speed ?? 1, value => update3DObject({ timeRemap: { ...timeRemap3D, speed: Math.max(-8, Math.min(8, value)) } }), { disabled: hasTimeRemapCurve3D })}
                    {number3D(t('templates.scene3d.timeOffset'), timeRemap3D.offset ?? 0, value => update3DObject({ timeRemap: { ...timeRemap3D, offset: value } }), { disabled: hasTimeRemapCurve3D })}
                    {number3D(t('templates.scene3d.sourceSpan'), timeRemap3D.duration ?? clip.duration ?? 1, value => update3DObject({ timeRemap: { ...timeRemap3D, duration: Math.max(0.001, value) } }))}
                    <label className="block text-[10px] text-muted-foreground">
                        <span>{t('templates.scene3d.timeMode')}</span>
                        <select className={`${field} mt-1`} value={object3d.timeRemap?.mode || 'clamp'} onChange={e => update3DObject({ timeRemap: { ...(object3d.timeRemap || {}), mode: e.target.value } })}>
                            {['clamp', 'loop', 'ping-pong'].map(mode => <option key={mode} value={mode}>{t(`templates.scene3d.timeModes.${mode}`)}</option>)}
                        </select>
                    </label>
                </div>
                <div className="rounded border border-border p-2 space-y-2">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('templates.scene3d.timeRemapCurve')}</div>
                    {hasTimeRemapCurve3D && <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] text-muted-foreground">{t('templates.scene3d.curveOverridesSpeedOffset')}</span>
                        <button type="button" className="px-2 py-1 rounded border border-border text-xs shrink-0" onClick={() => update3DObject({ timeRemap: { ...timeRemap3D, keyframes: [] } })}>{t('templates.scene3d.clearCurve')}</button>
                    </div>}
                    {number3D(t('templates.scene3d.sourceTime'), timeRemapValue3D, setTimeRemapKeyframe3D)}
                    <div className="flex items-center gap-1">
                        <button type="button" className="px-2 py-1 rounded border border-border text-xs" onClick={() => seek3DTimeRemapKeyframe(-1)}>{t('templates.scene3d.previousKeyframe')}</button>
                        <button type="button" className="px-2 py-1 rounded border border-border text-xs" onClick={() => setTimeRemapKeyframe3D()}>{currentTimeRemapKeyframe3D ? t('templates.scene3d.updateKeyframe') : t('templates.scene3d.addKeyframe')}</button>
                        <button type="button" className="px-2 py-1 rounded border border-border text-xs" onClick={() => seek3DTimeRemapKeyframe(1)}>{t('templates.scene3d.nextKeyframe')}</button>
                    </div>
                    <div className="text-[10px] text-muted-foreground">{t('templates.scene3d.keyframeCount', { count: timeRemapKeyframes3D.length })}</div>
                </div>
            </>)}
            {/* R92: vector shapes */}
            {['highlight-box', 'underline', 'circle-callout', 'burst'].includes(kind) && (<>
                {color('color')}
                <div className="grid grid-cols-2 gap-2">{text('thickness', { number: true })}{kind === 'burst' ? text('rays', { number: true }) : null}</div>
            </>)}
            {kind === 'arrow' && (<>
                {color('color')}
                <label className="block">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('templates.fields.direction')}</span>
                    <select value={draft.direction || 'right'} onChange={e => commit({ direction: e.target.value })}
                        className="mt-1 w-full bg-background border border-border rounded px-2 py-1 text-xs">
                        {['right', 'left', 'up', 'down'].map(d => <option key={d} value={d}>{t(`templates.directions.${d}`)}</option>)}
                    </select>
                </label>
                {text('thickness', { number: true })}
            </>)}
            {kind === 'progress-bar' && (<>{text('label')}{text('value', { number: true })}{color('color')}</>)}
            {kind === 'bar-chart' && (<>{text('values')}{text('labels')}{color('color')}{color('accent')}</>)}
            {kind === 'editing-timeline' && (<>
                {text('clipCuts')}
                <div className="grid grid-cols-3 gap-2">{text('videoLabel')}{text('voiceLabel')}{text('sfxLabel')}</div>
                {text('sfxMarks')}
                {color('accent')}
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input type="checkbox" checked={Number(draft.muted) === 1} onChange={e => commit({ muted: e.target.checked ? 1 : 0 })} />
                    {t('templates.fields.muted')}
                </label>
            </>)}
            {kind === 'glass-notification' && (<>
                {text('name')}{text('message')}{text('time')}
                <LogoPicker labelKey="avatar" value={draft.imageAssetId} onPick={(asset) => commit({ imageAssetId: asset?.id || null, imageUrl: asset ? (asset.url || asset.proxyUrl || null) : null })} />
                {color('accent')}
            </>)}
            {kind === 'framed-headline' && (<>
                {text('headline', { multiline: true, rows: 3 })}
                {text('highlight')}{text('support')}
                <div className="grid grid-cols-2 gap-2">{color('accent')}{color('color')}</div>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input type="checkbox" checked={Number(draft.sparkles) !== 0} onChange={e => commit({ sparkles: e.target.checked ? 1 : 0 })} />
                    {t('templates.fields.sparkles')}
                </label>
            </>)}
            {kind === 'phrase-chips' && (<>
                {text('phrases')}{text('phraseSupport')}
                <div className="grid grid-cols-2 gap-2">{color('accent')}{color('color')}</div>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input type="checkbox" checked={Number(draft.cycle) !== 0} onChange={e => commit({ cycle: e.target.checked ? 1 : 0 })} />
                    {t('templates.fields.cycleHighlight')}
                </label>
            </>)}
            {kind === 'editorial-title' && (<>
                {text('kicker')}{text('headline', { multiline: true, rows: 3 })}
                {text('emphasis')}{text('phraseSupport')}
                <div className="grid grid-cols-2 gap-2">{color('accent')}{color('color')}</div>
                <label className="block space-y-1">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('templates.fields.mark')}</span>
                    <select className={field} value={draft.mark || 'underline'} onChange={e => commit({ mark: e.target.value })}>
                        <option value="underline">{t('templates.styles.underline')}</option>
                        <option value="strike">{t('templates.styles.strike')}</option>
                        <option value="none">{t('templates.styles.noMark')}</option>
                    </select>
                </label>
            </>)}
            {kind === 'halftone-title' && (<>
                {text('headline', { multiline: true, rows: 2 })}
                <div className="grid grid-cols-2 gap-2">{color('color')}{color('patternColor')}</div>
                {color('accent')}
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input type="checkbox" checked={Number(draft.frame) !== 0} onChange={e => commit({ frame: e.target.checked ? 1 : 0 })} />
                    {t('templates.fields.frame')}
                </label>
            </>)}
            {kind === 'kinetic-word-cards' && (<>
                {text('words', { multiline: true, rows: 3 })}
                <div className="grid grid-cols-2 gap-2">{color('accent')}{color('color')}</div>
            </>)}
            {kind === 'word-cycle' && (<>
                {text('prefix')}{text('words')}{text('suffix')}
                {text('fontSize', { number: true })}
                <div className="grid grid-cols-2 gap-2">{color('accent')}{color('color2')}</div>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input type="checkbox" checked={Number(draft.gradient) !== 0} onChange={e => commit({ gradient: e.target.checked ? 1 : 0 })} />
                    {t('templates.fields.gradientText')}
                </label>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input type="checkbox" checked={Number(draft.glow) !== 0} onChange={e => commit({ glow: e.target.checked ? 1 : 0 })} />
                    {t('templates.fields.glow')}
                </label>
                {Number(draft.glow) !== 0 && text('glowStrength', { number: true })}
            </>)}
            {kind === 'search-bar' && (<>
                {text('query')}{text('placeholder')}
                <div className="grid grid-cols-2 gap-2">{color('color')}{color('color2')}</div>
                <label className="block space-y-1">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('templates.fields.style')}</span>
                    <select className={field} value={draft.style || 'dark'} onChange={e => commit({ style: e.target.value })}>
                        <option value="dark">{t('templates.styles.darkCapsule')}</option>
                        <option value="light">{t('templates.styles.lightCapsule')}</option>
                    </select>
                </label>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input type="checkbox" checked={Number(draft.glow) !== 0} onChange={e => commit({ glow: e.target.checked ? 1 : 0 })} />
                    {t('templates.fields.glow')}
                </label>
            </>)}
            {kind === 'icon' && (<>
                <label className="block space-y-1">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Illustration</span>
                    <select className={field} value={draft.icon || 'sparkle'} onChange={e => commit({ icon: e.target.value })}>
                        {ICON_NAMES.map(name => <option key={name} value={name}>{name.replaceAll('-', ' ')}</option>)}
                    </select>
                </label>
                <label className="block space-y-1">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Treatment</span>
                    <select className={field} value={draft.treatment || 'solo'} onChange={e => commit({ treatment: e.target.value })}>
                        {[['solo', 'Minimal'], ['badge', 'Badge'], ['frame', 'Framed'], ['burst', 'Burst']].map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                    </select>
                </label>
                <label className="block space-y-1">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Background</span>
                    <select className={field} value={draft.background || 'soft-glow'} onChange={e => commit({ background: e.target.value })}>
                        {VECTOR_ILLUSTRATION_BACKGROUNDS.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
                    </select>
                </label>
                {color('accent')}
            </>)}
        </div>
    );
};

const LogoPicker = ({ value, onPick, labelKey = 'logo', assetTypes = ['image'] }) => {
    const { t } = useTranslation('editor');
    const images = useTimelineStore(useShallow(s => (s.assets || []).filter(a => assetTypes.includes(a.type))));
    return (
        <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t(`templates.fields.${labelKey}`)}</span>
            <select className={field} value={value || ''} onChange={e => onPick(images.find(a => a.id === e.target.value) || null)}>
                <option value="">{t('templates.noLogo')}</option>
                {images.map(a => <option key={a.id} value={a.id}>{a.name || a.id}</option>)}
            </select>
        </label>
    );
};

const TemplatePanel = ({ selectedClip, selectedTrackId }) => {
    const { t } = useTranslation('editor');
    const editingStyle = useTimelineStore(state => state.editingStyle);
    const [illustrationQuery, setIllustrationQuery] = useState('');
    const illustrations = VECTOR_ILLUSTRATIONS.filter(item => item.name.toLowerCase().includes(illustrationQuery.trim().toLowerCase())
        || item.category.toLowerCase().includes(illustrationQuery.trim().toLowerCase()));
    const add = (kind, params = {}) => {
        try {
            const adapted = evaluateMotionCompatibility(editingStyle, 'template', kind, params).adaptedParams || params;
            const r = useTimelineStore.getState().addTemplateClip(kind, adapted);
            if (!r?.success) console.warn('[TemplatePanel]', r?.error);
        } catch (err) {
            console.error('[TemplatePanel] add failed:', err);
        }
    };
    return (
        <div className="mb-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Vector illustrations ({VECTOR_ILLUSTRATIONS.length})</div>
            <input
                className={`${field} mb-2`}
                type="search"
                value={illustrationQuery}
                onChange={e => setIllustrationQuery(e.target.value)}
                placeholder="Search illustrations"
                aria-label="Search vector illustrations"
            />
            <div className="grid grid-cols-2 gap-1.5 max-h-56 overflow-y-auto mb-3 pr-1">
                {illustrations.map(item => (
                    <button key={item.id} type="button" title={`${item.category} · ${item.name}`} onClick={() => add('icon', { icon: item.icon, treatment: item.treatment, background: item.background })}
                        className="px-2 py-1.5 rounded text-[10px] text-left transition-colors border border-border hover:bg-white/5 text-muted-foreground flex items-center gap-1.5">
                        <IllustrationSwatch illustration={item} />
                        <span className="min-w-0"><span className="block text-foreground leading-tight">{item.name}</span>
                            <span className="block opacity-60 mt-0.5">{item.category}</span></span>
                    </button>
                ))}
                {!illustrations.length && <div className="col-span-2 text-xs text-muted-foreground py-3">No illustrations found.</div>}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">{t('templates.title')}</div>
            <div className="grid grid-cols-2 gap-1.5">
                {TEMPLATE_KINDS.map(kind => (
                    <button key={kind} type="button" onClick={() => add(kind)}
                        className="px-2 py-1.5 rounded text-[11px] text-left transition-colors border border-border hover:bg-white/5 text-muted-foreground">
                        {t(`templates.kinds.${kind}`)}
                    </button>
                ))}
            </div>
            {selectedClip?.type === 'template' && selectedClip.template && (
                <TemplateEditor key={selectedClip.id} trackId={selectedTrackId} clip={selectedClip} />
            )}
            {selectedClip?.type === 'vector' && selectedClip.vector && (
                <VectorEditor key={selectedClip.id} trackId={selectedTrackId} clip={selectedClip} />
            )}
        </div>
    );
};

export default TemplatePanel;
