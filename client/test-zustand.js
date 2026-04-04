import { create } from 'zustand/vanilla';
import { subscribeWithSelector } from 'zustand/middleware';

const useTimelineStore = create(
    subscribeWithSelector((set, get) => ({
        past: [], future: [],
        undo: () => console.log('undo called'),
        redo: () => console.log('redo called')
    }))
);

console.log('Store keys:', Object.keys(useTimelineStore.getState()));
