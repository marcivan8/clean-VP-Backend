const EventEmitter = require('events');

class Queue {
    add()    { return Promise.resolve({ id: 'mock-job-123' }); }
    getJob() { return Promise.resolve(null); }
    close()  { return Promise.resolve(); }
}

class Worker extends EventEmitter {
    on(event, cb) { super.on(event, cb); return this; }
    close() { return Promise.resolve(); }
}

class QueueEvents extends EventEmitter {
    on(event, cb) { super.on(event, cb); return this; }
    close() { return Promise.resolve(); }
}

module.exports = { Queue, Worker, QueueEvents };
