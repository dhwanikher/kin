import http from 'node:http';

import { createApp } from './app.js';
import { config } from './config/env.js';
import { connectDb } from './config/db.js';
import { attachSockets } from './sockets/index.js';
import { startReminderLoop } from './services/reminders.js';

const app = createApp();
const server = http.createServer(app);

await connectDb();

const io = attachSockets(server);
// Route handlers reach the socket server through the app rather than a module
// level singleton, which keeps them testable without a live socket layer.
app.set('io', io);

startReminderLoop();

server.listen(config.port, () => {
  console.log(`kin server listening on http://localhost:${config.port} (${config.env})`);
});
