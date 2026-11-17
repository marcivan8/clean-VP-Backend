/**
 * client/src/store/useMarketplaceStore.js
 *
 * Central interactive store for VIBED Market:
 * - Bookings Dashboard (Board 08)
 * - Call Sheet (Board 07)
 * - Negotiation Thread with Structured Cards (Board 09)
 * - Asset Room & Ingest Pipeline (Board 22)
 * - Financial Ledger & Escrow (Board 15)
 *
 * All state mutations are interconnected: accepting quotes or scope changes
 * immediately updates escrow totals, call sheets, and asset room permissions.
 *
 * Strictly zero emojis.
 */

import { create } from 'zustand';
import useTimelineStore from './useTimelineStore.js';

export const useMarketplaceStore = create((set, get) => ({
    // Navigation inside /marketplace
    activeTab: 'discover', // 'discover' | 'bookings' | 'callsheet' | 'messages' | 'assetroom' | 'ledger'
    setActiveTab: (tab) => set({ activeTab: tab }),

    selectedBookingId: 'noma-founder-interview',
    setSelectedBookingId: (id) => set({ selectedBookingId: id }),

    // Metrics summary (Board 08)
    metrics: {
        needsYou: 2,
        heldInEscrow: 1386,
        nextShootDate: '19 Nov',
        nextShootLocation: 'Ivry-sur-Seine',
        rushesWaiting: 1,
        thisMonthSpent: 2340,
        thisMonthBookings: 5,
    },

    // Bookings collection (Board 08)
    bookings: [
        {
            id: 'noma-founder-interview',
            title: 'Noma — founder interview',
            talentName: 'Nour Benali · Atelier Rive Sud',
            talentId: 'nour-benali',
            date: '19 Nov',
            time: '09:30',
            status: 'Confirmed', // 'Confirmed' | 'Quote sent' | 'Your review' | 'Released' | 'Partial refund'
            statusType: 'confirmed',
            amount: 995.40,
            amountLabel: '€995',
            moneyState: 'held',
            nextAction: 'callsheet',
            nextActionLabel: 'Call sheet',
            rushesReady: true,
            rushesCount: 142,
        },
        {
            id: 'product-demo-3-verticals',
            title: 'Product demo · 3 verticals',
            talentName: 'Léo Marchand · your office',
            talentId: 'leo-marchand',
            date: '24 Nov',
            time: '14:00',
            status: 'Quote sent',
            statusType: 'quote',
            amount: 420.00,
            amountLabel: '€420',
            moneyState: 'not charged',
            nextAction: 'review_quote',
            nextActionLabel: 'Review quote',
            rushesReady: false,
        },
        {
            id: 'podcast-set-ep4',
            title: 'Podcast set · episode 4',
            talentName: 'Studio Kemet · 3 speakers',
            talentId: 'studio-kemet',
            date: '02 Dec',
            time: '10:00',
            status: 'Confirmed',
            statusType: 'confirmed',
            amount: 265.00,
            amountLabel: '€265',
            moneyState: 'deposit held',
            nextAction: 'callsheet',
            nextActionLabel: 'Call sheet',
            rushesReady: false,
        },
        {
            id: 'testimonial-cut-rev2',
            title: 'Testimonial cut · revision 2',
            talentName: 'Inès Ferreira · Commercial seat 3',
            talentId: 'ines-ferreira',
            date: 'Today',
            time: 'delivered',
            status: 'Your review',
            statusType: 'review',
            amount: 126.00,
            amountLabel: '€126',
            moneyState: 'held',
            nextAction: 'open_room',
            nextActionLabel: 'Open room',
            rushesReady: true,
        },
        {
            id: 'brand-photos-autumn',
            title: 'Brand photos · autumn set',
            talentName: 'Sana Diop · Atelier Rive Sud',
            talentId: 'sana-diop',
            date: '28 Oct',
            time: 'completed',
            status: 'Released',
            statusType: 'released',
            amount: 310.00,
            amountLabel: '€310',
            moneyState: 'paid out',
            nextAction: 'review',
            nextActionLabel: 'Leave review',
            rushesReady: true,
        },
        {
            id: 'event-recap-launch',
            title: 'Event recap · launch night',
            talentName: 'Léo Marchand · Montreuil',
            talentId: 'leo-marchand',
            date: '11 Oct',
            time: 'closed',
            status: 'Partial refund',
            statusType: 'refund',
            amount: 180.00,
            amountLabel: '€180 of €340',
            moneyState: 'refunded',
            nextAction: 'outcome',
            nextActionLabel: 'See outcome',
            rushesReady: false,
        },
    ],

    // Action queue for "Do these first" (Board 08)
    actionQueue: [
        {
            id: 'aq-1',
            bookingId: 'product-demo-3-verticals',
            title: 'Léo re-quoted at €420',
            subtitle: 'Up €68 for a third setup you asked about. Expires in 19 h.',
            actions: ['accept', 'counter'],
        },
        {
            id: 'aq-2',
            bookingId: 'testimonial-cut-rev2',
            title: 'Inès delivered revision 2',
            subtitle: 'Auto-accepts on 16 Nov and pays out unless you open the room.',
            actions: ['review'],
        },
    ],

    // Call Sheet for active booking (Board 07)
    callSheet: {
        id: 'cs-noma',
        bookingId: 'noma-founder-interview',
        title: 'Noma — founder interview',
        dateStr: 'Thursday 19 November',
        callStr: '09:30 call · Atelier Rive Sud, Ivry-sur-Seine',
        status: 'Confirmed',
        heldAmount: '€995.40 held',
        releaseSigned: true,
        schedule: [
            { time: '09:00', title: 'Load in · door code arrives at 07:30', subtitle: 'Loading bay on rue Monge, lift to 3rd' },
            { time: '09:30', title: 'Call · light and sound set', subtitle: 'Blackouts up, key from camera left, two lavs', active: true },
            { time: '10:15', title: 'Warm-up pass · not recorded for the cut', subtitle: 'Subject is camera-shy; ten minutes of nothing-at-stake talk' },
            { time: '10:30', title: 'Interview · 8 questions, two cameras', subtitle: 'Questions synced with project script cues' },
            { time: '12:00', title: 'B-roll · hands, screen, room', subtitle: 'Shot list pulled from the project b-roll gaps' },
            { time: '13:00', title: 'Wrap · rushes uploading from the card', subtitle: 'Ingest starts on site; the project is editable before you get home' },
        ],
        shotList: [
            { id: 'shot-1', text: 'Why you started, in one breath', done: true },
            { id: 'shot-2', text: 'The moment it nearly stopped', done: false },
            { id: 'shot-3', text: 'What the product actually does', done: false },
            { id: 'shot-4', text: 'Who it is not for', done: false },
            { id: 'shot-5', text: 'Three vertical hooks, said straight to lens', done: false },
            { id: 'shot-6', text: 'Close-up on hands using mechanical interface', done: false },
        ],
        crew: [
            { name: 'Nour Benali', role: 'Camera + sound · arrives 09:00', initials: 'NB', bg: '#0B7C91', threadId: 'thread-nour' },
            { name: 'Clara Roux', role: 'Studio host · on site all morning', initials: 'CR', bg: '#B45309', threadId: 'thread-clara' },
            { name: 'You', role: 'Buyer · bring the product, two shirts', initials: 'ME', bg: '#475569' },
        ],
        responsibilities: {
            talent: {
                name: 'Nour brings',
                items: 'FX3, A7IV, 2 lav, boom, 3-point LED, prompter, 2 TB card set',
            },
            studio: {
                name: 'Studio provides',
                items: 'Cyc, blackouts, C-stands, power, Wi-Fi, make-up corner, parking',
            },
            buyer: {
                name: 'You bring',
                items: 'Product samples, two shirt options, the one sentence you want people to repeat',
            },
        },
        location: {
            address: '14 rue Monge, 94200 Ivry-sur-Seine',
            doorCode: 'DOOR 4821',
            floor: 'LIFT TO 3RD · STUDIO B',
            details: 'Code is live from 07:30 to 14:30 on the day only. Métro Mairie d\'Ivry, 6 min.',
            lat: 48.8156,
            lng: 2.3924,
        },
        documents: [
            { name: 'Booking contract', status: 'SIGNED' },
            { name: 'Appearance release', status: 'SIGNED' },
            { name: 'Studio insurance', status: 'ON FILE' },
            { name: 'Invoice', status: 'ON RELEASE' },
        ],
    },

    // Message Threads (Board 09)
    activeThreadId: 'thread-nour',
    setActiveThreadId: (id) => set({ activeThreadId: id }),

    threads: [
        {
            id: 'thread-nour',
            talentName: 'Nour Benali',
            talentSubtitle: 'Quote updated — third setup',
            bookingTitle: 'Noma — founder interview · 19 Nov',
            avatar: 'NB',
            avatarBg: '#0B7C91',
            time: '14:02',
            unread: 1,
            heldAmount: '€995 held',
            bookingDate: '19 Nov · 09:30',
            location: 'Atelier Rive Sud',
            deliverables: 'Rushes + first cut',
            files: [
                { name: 'appearance-release.pdf', type: 'PDF' },
                { name: 'shot-list-v3.md', type: 'MD' },
                { name: 'studio-floorplan.png', type: 'PNG' },
            ],
            messages: [
                {
                    id: 'm-1',
                    sender: 'Nour Benali',
                    time: '13:48',
                    text: 'Looked at the project — eight questions in four hours is comfortable, and we will have time for the b-roll. One thing: if he is camera-shy I would rather shoot the warm-up on a third setup by the window, so he is not staring down two lenses from minute one.',
                },
                {
                    id: 'm-card-1',
                    type: 'scope_card',
                    status: 'pending', // 'pending' | 'accepted' | 'declined' | 'countered'
                    amountDelta: 68,
                    totalAmount: 1063.40,
                    title: 'Third setup by the window',
                    description: 'Adds 45 min of setup and one more light. Shoot window moves to 09:30–14:00.',
                    expires: 'Expires in 19 h · nothing is charged until you accept',
                },
                {
                    id: 'm-2',
                    sender: 'You',
                    time: '14:00',
                    isUser: true,
                    text: 'Makes sense. Can we keep the end at 13:30? I have a call at two.',
                },
                {
                    id: 'm-3',
                    sender: 'Nour Benali',
                    time: '14:02',
                    text: 'Then we drop two b-roll shots and keep the window setup. Same price.',
                },
                {
                    id: 'm-card-2',
                    type: 'doc_card',
                    name: 'appearance-release-noma.pdf',
                    description: 'Signed by both · attached to the booking and to every export',
                    status: 'Signed',
                },
            ],
            suggestedReplies: [
                '13:30 works, let\'s drop the two shots',
                'Ask about parking',
                'Confirm the window lighting rig',
            ],
        },
        {
            id: 'thread-clara',
            talentName: 'Clara Roux · studio',
            talentSubtitle: 'Blackouts will be up, no problem',
            bookingTitle: 'Atelier Rive Sud · 19 Nov',
            avatar: 'CR',
            avatarBg: '#B45309',
            time: '11:40',
            unread: 0,
            heldAmount: '€412 held',
            bookingDate: '19 Nov · 09:00',
            location: 'Ivry-sur-Seine',
            deliverables: 'Studio 90 m² cyclorama',
            files: [
                { name: 'studio-rules.pdf', type: 'PDF' },
            ],
            messages: [
                {
                    id: 'mc-1',
                    sender: 'Clara Roux',
                    time: '11:40',
                    text: 'Hi! Blackouts will be installed before Nour arrives at 09:00. The loading bay door code is 4821.',
                },
            ],
            suggestedReplies: [
                'Thank you Clara, see you Thursday',
                'Is there a coffee machine on site?',
            ],
        },
        {
            id: 'thread-ines',
            talentName: 'Inès Ferreira',
            talentSubtitle: 'Revision 2 is in the room',
            bookingTitle: 'Testimonial cut · revision 2',
            avatar: 'IF',
            avatarBg: '#059669',
            time: 'Mon',
            unread: 0,
            heldAmount: '€126 held',
            bookingDate: 'Today',
            location: 'Remote',
            deliverables: '2 social cuts with captions',
            files: [
                { name: 'testimonial-rev2.mp4', type: 'MP4' },
            ],
            messages: [
                {
                    id: 'mi-1',
                    sender: 'Inès Ferreira',
                    time: 'Mon 16:20',
                    text: 'Just uploaded Revision 2 with the audio ducking you asked for. You can preview it in the Asset Room.',
                },
            ],
            suggestedReplies: [
                'Checking the asset room now',
                'Approved, thanks Inès!',
            ],
        },
    ],

    // Asset Room & Handover (Board 22)
    assetRoom: {
        bookingTitle: 'Asset room · Noma founder interview',
        subtitle: 'Nour Benali -> you · 61 rushes, 3 deliverables, 4 documents · 148 GB · stored in Paris',
        activeCategory: 'rushes', // 'rushes' | 'selects' | 'deliverables' | 'documents' | 'project'
        stepper: [
            { step: '01', title: 'Capture', subtitle: 'Phone or card upload from set', state: 'done' },
            { step: '02', title: 'Ingest', subtitle: 'Proxies made, audio synced, VIBED project opened', state: 'done' },
            { step: '03', title: 'Review', subtitle: 'Selects, versions, timestamped notes', state: 'now' },
            { step: '04', title: 'Handover', subtitle: 'On release: watermarks drop, originals unlock', state: 'pending' },
            { step: '05', title: 'Archive', subtitle: 'Rushes kept 30 days, deliverables 12 months', state: 'pending' },
        ],
        files: [
            {
                id: 'f-1',
                category: 'rushes',
                name: 'interview-master-v3.mp4',
                meta: '16:9 · 03:04 · H.264 · 4K Pro',
                size: '1.8 GB',
                from: 'Nour',
                state: 'Watermarked',
                stateType: 'watermarked',
                previewUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
            },
            {
                id: 'f-2',
                category: 'deliverables',
                name: 'vertical-hook-01.mp4',
                meta: '9:16 · 00:27 · captions FR',
                size: '184 MB',
                from: 'Nour',
                state: 'Watermarked',
                stateType: 'watermarked',
                previewUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
            },
            {
                id: 'f-3',
                category: 'deliverables',
                name: 'vertical-hook-02.mp4',
                meta: '9:16 · 00:24 · no captions',
                size: '166 MB',
                from: 'Nour',
                state: 'Uploading 68%',
                stateType: 'uploading',
            },
            {
                id: 'f-4',
                category: 'documents',
                name: 'appearance-release.pdf',
                meta: 'signed by both · 19 Nov',
                size: '240 KB',
                from: 'System',
                state: 'Yours now',
                stateType: 'ready',
            },
        ],
        receipts: [
            { title: 'You · interview-master-v3.mp4 · watermarked proxy', time: 'today 14:31' },
            { title: 'You · 14 selects · ZIP', time: 'today 14:02' },
            { title: 'Nour · appearance-release.pdf', time: '19 Nov 13:48' },
        ],
    },

    // Financial Ledger (Board 15)
    ledger: {
        bookingId: 'noma-founder-interview',
        buyerPays: 995.40,
        vatToState: 165.90,
        buyerServiceFee: 39.50,
        platformRate: 71.10,
        cardProcessing: 19.10,
        talentReceives: 718.90,
        platformKeeps: 91.50,
        afterProcessing: 72.40,
        events: [
            { date: '06 Nov', event: 'Request authorised', entry: 'hold on buyer card', amount: '€995.40' },
            { date: '06 Nov', event: 'Talent accepted', entry: 'captured -> escrow', amount: '€995.40' },
            { date: '11 Nov', event: 'Scope change accepted', entry: 'top-up -> escrow', amount: '€68.00' },
            { date: '19 Nov', event: 'Rushes delivered', entry: 'acceptance clock starts', amount: '—' },
            { date: '20 Nov', event: 'Buyer accepted', entry: 'fees recognised', amount: '€91.50' },
            { date: '22 Nov', event: 'Payout sent', entry: 'escrow -> talent', amount: '€718.90' },
        ],
        disputeSteps: [
            { step: '01', title: 'Raised', desc: 'Either side within 5 days of delivery. Release freezes immediately.' },
            { step: '02', title: 'Evidence', desc: 'The room assembles itself: brief, accepted quotes, versions, spec check.' },
            { step: '03', title: '48 h to settle', desc: 'Both sides can agree a split themselves. Most do once they see evidence.' },
            { step: '04', title: 'Trust desk', desc: 'A human reads it against the brief. Target 72 h, written reasons.' },
            { step: '05', title: 'Outcome', desc: 'Full release, partial release or refund — and rights licence follows money.' },
        ],
    },

    // ── Interactive Mutations ──────────────────────────────────────────────────

    // Accept Scope Change card in Thread (Board 09)
    acceptScopeChange: (cardId) => {
        set((state) => {
            const thread = state.threads.find(t => t.id === state.activeThreadId);
            if (!thread) return state;

            const updatedMessages = thread.messages.map(m => {
                if (m.id === cardId) {
                    return { ...m, status: 'accepted' };
                }
                return m;
            });

            // Update thread, booking amount, and ledger
            const updatedThreads = state.threads.map(t =>
                t.id === state.activeThreadId ? { ...t, messages: updatedMessages, heldAmount: '€1,063.40 held' } : t
            );

            const updatedBookings = state.bookings.map(b =>
                b.id === state.selectedBookingId ? { ...b, amount: 1063.40, amountLabel: '€1,063.40' } : b
            );

            return {
                threads: updatedThreads,
                bookings: updatedBookings,
                metrics: { ...state.metrics, heldInEscrow: state.metrics.heldInEscrow + 68 },
            };
        });
    },

    declineScopeChange: (cardId) => {
        set((state) => {
            const thread = state.threads.find(t => t.id === state.activeThreadId);
            if (!thread) return state;
            const updatedMessages = thread.messages.map(m =>
                m.id === cardId ? { ...m, status: 'declined' } : m
            );
            return {
                threads: state.threads.map(t =>
                    t.id === state.activeThreadId ? { ...t, messages: updatedMessages } : t
                ),
            };
        });
    },

    // Accept Quote from Bookings dashboard (Board 08)
    acceptQuote: (bookingId) => {
        set((state) => {
            const updatedBookings = state.bookings.map(b => {
                if (b.id === bookingId) {
                    return {
                        ...b,
                        status: 'Confirmed',
                        statusType: 'confirmed',
                        moneyState: 'held',
                        nextAction: 'callsheet',
                        nextActionLabel: 'Call sheet',
                    };
                }
                return b;
            });
            const updatedQueue = state.actionQueue.filter(item => item.bookingId !== bookingId);
            return {
                bookings: updatedBookings,
                actionQueue: updatedQueue,
                metrics: { ...state.metrics, needsYou: Math.max(0, state.metrics.needsYou - 1) },
            };
        });
    },

    // Toggle item in Call Sheet shot list (Board 07)
    toggleShotItem: (shotId) => {
        set((state) => {
            const updatedShotList = state.callSheet.shotList.map(s =>
                s.id === shotId ? { ...s, done: !s.done } : s
            );
            return {
                callSheet: { ...state.callSheet, shotList: updatedShotList },
            };
        });
    },

    addShotItem: (text) => {
        if (!text || !text.trim()) return;
        set((state) => {
            const newItem = {
                id: `shot-${Date.now()}`,
                text: text.trim(),
                done: false,
            };
            return {
                callSheet: {
                    ...state.callSheet,
                    shotList: [...state.callSheet.shotList, newItem],
                },
            };
        });
    },

    // Post message in active thread (Board 09)
    sendMessage: (text) => {
        if (!text || !text.trim()) return;
        set((state) => {
            const thread = state.threads.find(t => t.id === state.activeThreadId);
            if (!thread) return state;
            const now = new Date();
            const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
            const newMsg = {
                id: `msg-${Date.now()}`,
                sender: 'You',
                time: timeStr,
                isUser: true,
                text: text.trim(),
            };
            return {
                threads: state.threads.map(t =>
                    t.id === state.activeThreadId ? { ...t, messages: [...t.messages, newMsg] } : t
                ),
            };
        });
    },

    // Ingest rushes directly into active VIBED Editor project (Board 22)
    ingestRushesToVibed: () => {
        const timelineStore = useTimelineStore.getState();
        // Add overlay / media clip to active timeline project
        const demoClip = {
            id: `rush-ingest-${Date.now()}`,
            name: 'Noma — founder interview master rush.mp4',
            duration: 184,
            src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
            type: 'video',
            startTime: 0,
            trackId: 'track-video-1',
        };

        if (typeof timelineStore.addOverlayClip === 'function') {
            timelineStore.addOverlayClip({
                id: demoClip.id,
                name: demoClip.name,
                url: demoClip.src,
                type: 'video',
                width: 1920,
                height: 1080,
                duration: 184,
            }, {
                label: 'Shoot Rush · Nour Benali',
                duration: 10,
            });
        }
        return true;
    },
}));

export default useMarketplaceStore;
