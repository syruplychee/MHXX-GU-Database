'use strict';

const { startServer } = require('./server/server.js');

startServer(0).then((server) => {
  // The desktop window reads the port and keeps stdin open until it closes.
  process.stdin.on('end', () => {
    server.close();
    server.closeAllConnections();
  });
  process.stdin.resume();
  console.log(server.address().port);
}).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
