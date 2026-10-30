import { hasIcon } from './IconLibrary.js';

// These are editable, resolution-independent illustrations. Each subject is
// available in four distinct compositions so the same visual can fit a clean,
// badge, framed-card, or energetic callout treatment.
const SUBJECTS = [
    ['sparkle', 'Sparkle', 'Decorative'], ['rocket', 'Rocket', 'Creator'], ['camera', 'Camera', 'Creator'],
    ['video', 'Video', 'Creator'], ['mic', 'Microphone', 'Creator'], ['headphones', 'Headphones', 'Creator'],
    ['scissors', 'Edit', 'Creator'], ['palette', 'Palette', 'Creator'], ['timeline', 'Timeline', 'Creator'],
    ['bulb', 'Idea', 'Education'], ['book', 'Book', 'Education'], ['cap', 'Graduation', 'Education'],
    ['chart-up', 'Growth', 'Business'], ['chart-bar', 'Analytics', 'Business'], ['target', 'Target', 'Business'],
    ['team', 'Team', 'Business'], ['building', 'Company', 'Business'], ['briefcase', 'Work', 'Business'],
    ['globe', 'World', 'Business'], ['shield', 'Protection', 'Business'], ['lock', 'Privacy', 'Business'],
    ['chat', 'Conversation', 'Communication'], ['mail', 'Message', 'Communication'], ['phone', 'Phone', 'Communication'],
    ['bell', 'Notification', 'Communication'], ['heart', 'Love', 'Reactions'], ['fire', 'Trending', 'Reactions'],
    ['star', 'Featured', 'Reactions'], ['trophy', 'Achievement', 'Reactions'], ['check', 'Success', 'Reactions'],
];

const TREATMENTS = [
    ['solo', 'Minimal'],
    ['badge', 'Badge'],
    ['frame', 'Framed'],
    ['burst', 'Burst'],
];

export const VECTOR_ILLUSTRATIONS = Object.freeze(SUBJECTS.flatMap(([icon, subject, category]) =>
    TREATMENTS.map(([treatment, style]) => Object.freeze({
        id: `${icon}-${treatment}`,
        name: `${subject} · ${style}`,
        category,
        icon,
        treatment,
        accent: '#00E5FF',
    })),
));

export function getVectorIllustration(id) {
    return VECTOR_ILLUSTRATIONS.find(item => item.id === id) || null;
}

export function isValidVectorIllustration(item) {
    return !!item && hasIcon(item.icon) && TREATMENTS.some(([treatment]) => treatment === item.treatment);
}

export const VECTOR_ILLUSTRATION_TREATMENTS = Object.freeze(TREATMENTS.map(([id, label]) => ({ id, label })));
