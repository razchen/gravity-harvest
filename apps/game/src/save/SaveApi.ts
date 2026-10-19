// HTTP client for saves (apps/server). In dev, Vite proxies /api to it. Saves are only listed, read and
// deleted over HTTP: they are written by the server's match (see net/MatchClient.save). Every request carries this
// browser's player id, and the server answers with that player's saves only.
import { API_PREFIX, PLAYER_ID_HEADER, type ListSavesQuery, type SaveGameSummary, type ScenarioSummary } from '@gravity-harvest/shared';
import { playerId } from '../net/playerId';

export type { SaveGameSummary };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_PREFIX}${path}`, { ...init, headers: { [PLAYER_ID_HEADER]: playerId() } });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { message?: string | string[] };
      if (body.message) message = Array.isArray(body.message) ? body.message.join(', ') : body.message;
    } catch {
      /* not JSON */
    }
    throw new Error(message);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const query = (q: ListSavesQuery) => {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined) params.set(k, String(v));
  const s = params.toString();
  return s ? `?${s}` : '';
};

export const SaveApi = {
  list: (q: ListSavesQuery = {}) => request<SaveGameSummary[]>(`/saves${query(q)}`),
  get: (id: string) => request<SaveGameSummary>(`/saves/${id}`),
  remove: (id: string) => request<void>(`/saves/${id}`, { method: 'DELETE' }),
  scenarios: () => request<ScenarioSummary[]>('/scenarios'),
};
