import { io } from 'socket.io-client';

// One shared connection for the whole app (state stream + low-latency input).
export const socket = io('/', { path: '/socket.io', transports: ['websocket', 'polling'] });
