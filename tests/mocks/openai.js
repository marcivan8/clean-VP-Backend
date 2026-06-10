class OpenAI {
    constructor() {
        this.chat = {
            completions: {
                create: jest.fn().mockResolvedValue({
                    choices: [{ message: { content: JSON.stringify({ message: 'mock', actions: [], clipsToRemove: [], newOrder: ['clip-1', 'clip-2', 'clip-3'] }) } }],
                }),
            },
        };
        this.audio = {
            transcriptions: {
                create: jest.fn().mockResolvedValue({ words: [{ word: 'hello', start: 0, end: 0.5 }], text: 'hello' }),
            },
        };
    }
}

module.exports = OpenAI;
