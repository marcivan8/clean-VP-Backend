/**
 * Jest environment setup — runs after the test framework is installed.
 * ioredis / bullmq / openai / ffmpeg-static are handled via moduleNameMapper
 * in package.json (more reliable than jest.mock() for deeply nested requires).
 */

// Fake key so OpenAI client instantiates inside controllers
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test-fake-key-for-jest';

// ── Supabase mock ──────────────────────────────────────────────────────────────
// Must live here (not moduleNameMapper) because tests need to control per-call
// return values via mockResolvedValueOnce().
jest.mock('../config/database', () => {
    const mockSingle  = jest.fn().mockResolvedValue({ data: null, error: null });
    const mockFrom    = jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        insert: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
        delete: jest.fn().mockReturnThis(),
        eq:     jest.fn().mockReturnThis(),
        order:  jest.fn().mockReturnThis(),
        range:  jest.fn().mockResolvedValue({ data: [], error: null }),
        single: mockSingle,
    }));
    const mockGetUser = jest.fn().mockResolvedValue({
        data:  { user: null },
        error: { code: 'invalid_token', message: 'Invalid token', status: 401 },
    });
    const client = {
        from: mockFrom,
        auth: {
            getUser: mockGetUser,
            admin:   { deleteUser: jest.fn().mockResolvedValue({ error: null }) },
        },
        // Expose internal mocks so test files can reach them via require()._mockXxx
        _mockSingle:  mockSingle,
        _mockFrom:    mockFrom,
        _mockGetUser: mockGetUser,
    };
    return { supabaseAdmin: client, supabaseClient: client };
});

// ── GCS / Storage mock ────────────────────────────────────────────────────────
jest.mock('../config/storage', () => ({
    useLocalStorage: true,
    bucket:          null,
    storage:         null,
}));

// ── child_process (ffmpeg version check) ──────────────────────────────────────
jest.mock('child_process', () => ({
    ...jest.requireActual('child_process'),
    execSync: jest.fn().mockReturnValue(Buffer.from('ffmpeg version 6.0')),
}));

// ── cleanup script ────────────────────────────────────────────────────────────
jest.mock('../scripts/cleanup', () => jest.fn());
