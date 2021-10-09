const snapshot = require('./handler-prom').snapshot;

async function start() {
    await snapshot();
    console.log('run complete');
}

start()
