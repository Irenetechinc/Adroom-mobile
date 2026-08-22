import type { Response } from 'express';

const _clients = new Set<Response>();

export function registerSSEClient(res: Response): void {
  _clients.add(res);
}

export function unregisterSSEClient(res: Response): void {
  _clients.delete(res);
}

export function broadcast(event: string, data: unknown): void {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  _clients.forEach((c) => {
    try { c.write(msg); }
    catch { _clients.delete(c); }
  });
}

export function clientCount(): number {
  return _clients.size;
}
