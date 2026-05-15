import nlp from 'compromise';

export function extractEditIntent(prompt) {
    const doc = nlp(prompt);
    
    // Extract verbs to understand the action
    const verbs = doc.verbs().out('array');
    // Extract numbers/durations
    const numbers = doc.numbers().out('array');
    // Extract known video terms
    const hasSpeed = doc.has('(faster|slower|speed|slow|fast)');
    const hasTrim = doc.has('(trim|cut|shorten|crop)');
    const hasSplit = doc.has('(split|divide|half|halve)');
    
    return { verbs, numbers, hasSpeed, hasTrim, hasSplit };
}
