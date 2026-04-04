/**
 * RingBuffer.js
 * A circular buffer for storing Video Frames to prevent Garbage Collection spikes.
 */

class RingBuffer {
    /**
     * @param {number} capacity - Max number of frames to store (e.g. 60 for 1-2s @ 30/60fps)
     */
    constructor(capacity = 60) {
        this.capacity = capacity;
        this.buffer = new Array(capacity).fill(null);
        this.readPtr = 0;
        this.writePtr = 0;
        this.size = 0;
    }

    /**
     * Add an item to the buffer.
     * @param {any} item - The frame object
     * @returns {boolean} True if successful, False if buffer full
     */
    push(item) {
        if (this.size === this.capacity) {
            return false;
        }
        this.buffer[this.writePtr] = item;
        this.writePtr = (this.writePtr + 1) % this.capacity;
        this.size++;
        return true;
    }

    /**
     * Look at the next item without removing it.
     * @returns {any|null} The item or null if empty
     */
    peek() {
        if (this.size === 0) return null;
        return this.buffer[this.readPtr];
    }

    /**
     * Remove and return the next item.
     * @returns {any|null} The item or null if empty
     */
    pop() {
        if (this.size === 0) return null;
        const item = this.buffer[this.readPtr];
        this.buffer[this.readPtr] = null; // Release reference
        this.readPtr = (this.readPtr + 1) % this.capacity;
        this.size--;
        return item;
    }

    /**
     * Clear all items (useful on Seek).
     * @param {function} cleanupFn - Optional function to cleanup items (e.g. frame.close())
     */
    clear(cleanupFn) {
        while (this.size > 0) {
            const item = this.pop();
            if (item && cleanupFn) cleanupFn(item);
        }
        this.readPtr = 0;
        this.writePtr = 0;
    }

    get isFull() {
        return this.size === this.capacity;
    }

    get isEmpty() {
        return this.size === 0;
    }
}

export default RingBuffer;
