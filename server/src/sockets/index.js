import { Server } from 'socket.io';

import { config } from '../config/env.js';
import { Membership } from '../models/index.js';
import { verifyAccessToken } from '../services/tokens.js';

/**
 * Real time updates, scoped to a circle.
 *
 * A socket is authenticated once at connection with the same access token the
 * REST API uses, and may then join only the circles its user actually belongs
 * to. Skipping that check would make the room name the only thing standing
 * between a stranger and a family's medication log.
 */
export function attachSockets(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: config.clientOrigin, credentials: true },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Not signed in'));
    try {
      socket.userId = verifyAccessToken(token).sub;
      return next();
    } catch {
      return next(new Error('Session expired'));
    }
  });

  io.on('connection', (socket) => {
    socket.on('circle:join', async (circleId, ack) => {
      try {
        const member = await Membership.exists({ circle: circleId, user: socket.userId });
        if (!member) return ack?.({ ok: false, error: 'Not a member of that circle' });

        socket.join(`circle:${circleId}`);
        return ack?.({ ok: true });
      } catch {
        return ack?.({ ok: false, error: 'Could not join' });
      }
    });

    socket.on('circle:leave', (circleId) => socket.leave(`circle:${circleId}`));
  });

  return io;
}
