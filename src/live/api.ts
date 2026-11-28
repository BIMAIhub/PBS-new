export class ApiError extends Error {
  constructor(public status: number, message: string, public requestId = '') {
    super(message);
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('X-PBS-Request', '1');
  const response = await fetch(`/api${path}`, { ...options, headers });
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new ApiError(response.status, result?.error || 'PBS could not complete the request.', response.headers.get('x-vercel-id') || '');
  }
  return response.status === 204 ? undefined as T : response.json();
}

export function send<T>(path: string, body?: unknown, method = 'POST') {
  return api<T>(path, {
    method,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

export const messageFrom = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Try again.';
