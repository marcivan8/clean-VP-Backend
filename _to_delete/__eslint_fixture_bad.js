export async function bad() {
    const res = await fetch('/api/ai/generate-plan', { method: 'POST' });
    return res.json();
}
export async function bad2() {
    const res = await window.fetch('/api/ai/generate-plan', { method: 'POST' });
    return res.json();
}
