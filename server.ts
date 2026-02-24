
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ server });
  const port = Number(process.env.PORT) || 3000;
  const host = '127.0.0.1';

  let currentBroadcast: string | null = null;

  // Broadcast to all clients
  wss.on('connection', (ws) => {
    // Send current broadcast to new connection
    if (currentBroadcast) {
      ws.send(JSON.stringify({ type: 'BROADCAST', payload: currentBroadcast }));
    }

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.type === 'BROADCAST') {
          currentBroadcast = message.payload;
          // Send to everyone
          wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify(message));
            }
          });
        } else if (message.type === 'CLEAR_BROADCAST') {
          currentBroadcast = null;
          wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ type: 'BROADCAST', payload: null }));
            }
          });
        }
      } catch (e) {
        console.error('Failed to parse WS message:', e);
      }
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  server.listen(port, host, () => {
    console.log(`CK-Flow 2.0 running at http://${host}:${port}/`);
  });
}

startServer();
