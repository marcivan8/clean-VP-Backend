const EventEmitter = require('events');

class Redis extends EventEmitter {
    constructor() {
        super();
        this.status = 'ready';
    }
    connect()  { return Promise.resolve(); }
    quit()     { return Promise.resolve(); }
    get()      { return Promise.resolve(null); }
    set()      { return Promise.resolve('OK'); }
    del()      { return Promise.resolve(1); }
    on(event, cb) { super.on(event, cb); return this; }
}

// ioredis exports Redis as both default and named export
module.exports = Redis;
module.exports.Redis = Redis;
