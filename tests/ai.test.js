/**
 * AI routes — /api/ai/*
 * Tests all GPT-4o-backed endpoints: chat, plan, parse-intent,
 * smart-cleanup, and reorder-clips. No real OpenAI calls are made
 * (openai is mocked in setup.js).
 */
const request = require('supertest');

// Mock auth and usage gates so AI endpoints can be reached
jest.mock('../middleware/auth', () => ({
    authenticateUser: (req, res, next) => { req.user = { id: 'test-user', plan: 'pro' }; next(); },
    optionalAuth: (req, res, next) => { req.user = { id: 'test-user', plan: 'pro' }; next(); }
}));
jest.mock('../middleware/usageGate', () => ({
    aiGate: (req, res, next) => next(),
    nleGate: (req, res, next) => next(),
    stockGate: (req, res, next) => next(),
}));

const app = require('../index');

describe('POST /api/ai/chat', () => {
    it('200 with actions array when command is provided', async () => {
        const res = await request(app)
            .post('/api/ai/chat')
            .send({ command: 'remove silences', context: {} });
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('success', true);
        expect(Array.isArray(res.body.actions)).toBe(true);
    });

    it('200 with mock fallback when OPENAI_API_KEY is absent', async () => {
        // The mock returns a parseable response regardless
        const res = await request(app)
            .post('/api/ai/chat')
            .send({ command: 'cut clip at 5 seconds' });
        expect(res.status).toBe(200);
    });

    it('200 when command is empty string (AI handles gracefully)', async () => {
        const res = await request(app)
            .post('/api/ai/chat')
            .send({ command: '' });
        expect(res.status).toBe(200);
    });
});

const { getAIClient } = require('../services/AIProvider');

describe('POST /api/ai/parse-intent', () => {
    it('200 with intent object', async () => {
        const res = await request(app)
            .post('/api/ai/parse-intent')
            .send({ command: 'remove filler words', context: {} });
        expect(res.status).toBe(200);
    });

    it('400 or 200 when body is empty', async () => {
        const res = await request(app).post('/api/ai/parse-intent').send({});
        expect([200, 400]).toContain(res.status);
    });

    it('handles direct text response as clarification when model does not call tool', async () => {
        const openai = getAIClient();
        openai.chat.completions.create.mockResolvedValueOnce({
            choices: [{ message: { content: 'Please clarify your duration preference.' } }],
        });

        const res = await request(app)
            .post('/api/ai/parse-intent')
            .send({ prompt: 'make it fit', context: {} });

        expect(res.status).toBe(200);
        expect(res.body.intent).toBe('clarification_required');
        expect(res.body.message).toBe('Please clarify your duration preference.');
    });

    it('recovers failed_generation from Groq tool_use_failed error as clarification', async () => {
        const openai = getAIClient();
        const groqError = new Error('Tool choice is required, but model did not call a tool');
        groqError.status = 400;
        groqError.error = {
            code: 'tool_use_failed',
            failed_generation: 'There appears to be a duration mismatch between the source media and the timeline. I need clarification before proceeding.',
        };
        openai.chat.completions.create.mockRejectedValueOnce(groqError);

        const res = await request(app)
            .post('/api/ai/parse-intent')
            .send({ prompt: 'u do ur own way', context: {} });

        expect(res.status).toBe(200);
        expect(res.body.intent).toBe('clarification_required');
        expect(res.body.message).toBe('There appears to be a duration mismatch between the source media and the timeline. I need clarification before proceeding.');
    });
});

describe('POST /api/ai/generate-plan', () => {
    it('200 with plan', async () => {
        const res = await request(app)
            .post('/api/ai/generate-plan')
            .send({ intent: { type: 'edit', operation: 'silence_removal' }, context: {} });
        expect(res.status).toBe(200);
    });
});

describe('POST /api/ai/smart-cleanup', () => {
    it('200 when clips array provided', async () => {
        const res = await request(app)
            .post('/api/ai/smart-cleanup')
            .send({
                clips: [
                    { id: 'clip-1', text: 'Hello world this is a test clip', duration: 5 },
                    { id: 'clip-2', text: 'Hello world this is a test clip again', duration: 5 },
                ],
                prompt: 'remove repetitive content',
            });
        expect(res.status).toBe(200);
    });

    it('400 or 200 when clips array is missing', async () => {
        const res = await request(app)
            .post('/api/ai/smart-cleanup')
            .send({ prompt: 'cleanup' });
        expect([200, 400]).toContain(res.status);
    });
});

describe('POST /api/ai/reorder-clips', () => {
    it('200 when clips with text are provided', async () => {
        const res = await request(app)
            .post('/api/ai/reorder-clips')
            .send({
                clips: [
                    { id: 'clip-1', text: 'Introduction to the topic', duration: 10 },
                    { id: 'clip-2', text: 'Main point here', duration: 8 },
                    { id: 'clip-3', text: 'The hook moment', duration: 4 },
                ],
                prompt: 'put the hook first',
            });
        expect(res.status).toBe(200);
    });

    it('400 or 200 when clips array is empty', async () => {
        const res = await request(app)
            .post('/api/ai/reorder-clips')
            .send({ clips: [], prompt: 'reorder' });
        expect([200, 400]).toContain(res.status);
    });
});

describe('POST /api/ai/agent-plan', () => {
    it('200 with plan response', async () => {
        const res = await request(app)
            .post('/api/ai/agent-plan')
            .send({ command: 'remove silences and filler words', context: { duration: 120 } });
        expect(res.status).toBe(200);
    });
});
