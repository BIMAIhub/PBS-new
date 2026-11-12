import type { Request, Response, NextFunction } from 'express';

export class RequestError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const badRequest = (message: string) => new RequestError(400, message);
export const conflict = (message: string) => new RequestError(409, message);
export const notFound = (message: string) => new RequestError(404, message);

export function route(handler: (req: Request, res: Response) => unknown) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve().then(() => handler(req, res)).catch(next);
  };
}

export function field(value: unknown, label: string, limit = 160, required = true): string {
  const result = typeof value === 'string' ? value.trim() : '';
  if ((required && !result) || result.length > limit) throw badRequest(`Enter a valid ${label}.`);
  return result;
}

export function emailAddress(value: unknown) {
  const result = field(value, 'email address', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw badRequest('Enter a valid email address.');
  return result;
}

export function integer(value: unknown, label: string, min = 0, max = 100_000_000_00): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw badRequest(`Enter a valid ${label}.`);
  }
  return value;
}

export function limitAttempts(limit: number, interval = 60_000) {
  const attempts = new Map<string, { expires: number; count: number }>();
  let nextCleanup = 0;
  return (req: Request, res: Response, next: NextFunction) => {
    const time = Date.now();
    if (time >= nextCleanup) {
      for (const [key, value] of attempts) if (value.expires <= time) attempts.delete(key);
      nextCleanup = time + interval;
    }
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const current = attempts.get(key);
    const attempt = current && current.expires > time ? current : { expires: time + interval, count: 0 };
    attempt.count++;
    attempts.set(key, attempt);
    if (attempt.count > limit) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((attempt.expires - time) / 1000))));
      return next(new RequestError(429, 'Too many requests. Try again in a moment.'));
    }
    next();
  };
}

export function apiError(error: unknown, _req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) return next(error);
  if (error instanceof RequestError) return res.status(error.status).json({ error: error.message });
  if (error instanceof SyntaxError && 'status' in error && error.status === 400) {
    return res.status(400).json({ error: 'The request contains invalid JSON.' });
  }
  if (error instanceof Error && 'status' in error && error.status === 413) {
    return res.status(413).json({ error: 'The request is too large.' });
  }
  if (error instanceof Error && /UNIQUE constraint failed/i.test(error.message)) {
    return res.status(409).json({ error: 'A record with these details already exists.' });
  }
  console.error('PBS API request failed:', error instanceof Error ? error.message : 'unknown error');
  return res.status(500).json({ error: 'PBS could not complete the request. Try again.' });
}
