import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

import { getAccessToken } from '../api/client.js';

/**
 * Live updates for one circle.
 *
 * The handler is held in a ref so that changing it — which happens on every
 * render, because it closes over component state — does not tear down and
 * rebuild the socket. Without that, the connection would drop and reconnect
 * constantly and updates would be missed in the gaps.
 */
export function useCircleSocket(circleId, handlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!circleId) return undefined;

    const socket = io({ auth: { token: getAccessToken() } });

    socket.on('connect', () => {
      socket.emit('circle:join', circleId, (ack) => {
        if (!ack?.ok) console.warn('[kin] could not join circle room:', ack?.error);
      });
    });

    socket.on('occurrence:resolved', (payload) => handlersRef.current.onResolved?.(payload));
    socket.on('medication:created', (payload) => handlersRef.current.onMedicationChanged?.(payload));
    socket.on('medication:updated', (payload) => handlersRef.current.onMedicationChanged?.(payload));
    socket.on('medication:stopped', (payload) => handlersRef.current.onMedicationChanged?.(payload));

    return () => {
      socket.emit('circle:leave', circleId);
      socket.disconnect();
    };
  }, [circleId]);
}
