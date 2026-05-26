/**
 * Haven API client — talks to the worker
 */

import type { Thread, Message, Companion, CompanionFile, Identity, ModelInfo } from './types';
import { persistSet, persistRemove } from './storage';

// Resolved per-call so SetupWizard/Settings changes to localStorage take effect
// without a page reload. On native APKs this is the only way the user can
// point the app at their own Worker.
export function apiBase(): string {
  return localStorage.getItem('haven-api-url') || import.meta.env.VITE_API_URL || '';
}

// The currently-active companion. All per-companion API calls scope by this
// via the `X-Companion-Id` header. Defaults to 1 (the seed companion) so
// single-companion installs keep working exactly like pre-v1.7.
export function activeCompanionId(): number {
  const raw = localStorage.getItem('haven-active-companion-id');
  const n = raw ? Number(raw) : 1;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function setActiveCompanionId(id: number): void {
  if (Number.isFinite(id) && id > 0) {
    persistSet('haven-active-companion-id', String(id));
  }
}

// Auth token — stored in localStorage after first-time setup or banner click
export function getAuthToken(): string | null {
  return localStorage.getItem('haven-auth-token');
}
export function saveAuthToken(token: string): void {
  persistSet('haven-auth-token', token);
  localStorage.setItem('haven-auth-saved-at', String(Date.now()));
}
export function clearAuthToken(): void {
  persistRemove('haven-auth-token');
}

// Builds the default headers sent on every API call. The X-Companion-Id
// tells the worker which companion's scoped data to return (or which to
// attribute new rows to).
function scopedHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Companion-Id': String(activeCompanionId()),
    ...(extra || {}),
  };
  const token = getAuthToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

async function parseJson<T>(res: Response, path: string): Promise<T> {
  const text = await res.text();
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    const head = text.trimStart().slice(0, 20).toLowerCase();
    if (head.startsWith('<!doctype') || head.startsWith('<html')) {
      throw new Error(
        `Worker didn't return JSON for ${path}. Check your Haven Worker URL in Settings — ` +
        `requests are hitting the app shell instead of the API.`
      );
    }
    throw new Error(`Invalid JSON response from ${path}`);
  }
  if (!res.ok) {
    if (res.status === 401 && path !== '/api/auth/status' && path !== '/api/auth/generate') {
      const lastSave = Number(localStorage.getItem('haven-auth-saved-at') || '0');
      if (Date.now() - lastSave > 5000) {
        clearAuthToken();
        window.dispatchEvent(new Event('haven-auth-expired'));
      }
    }
    throw new Error(parsed?.error || `Request failed (${res.status}) for ${path}`);
  }
  return parsed as T;
}

async function safeFetch(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${apiBase()}${path}`, init);
  } catch (err) {
    if (err instanceof TypeError) {
      throw new Error(`Network error — check your connection or Worker URL. (${path})`);
    }
    throw err;
  }
}

async function get<T>(path: string): Promise<T> {
  const res = await safeFetch(path, { headers: scopedHeaders() });
  return parseJson<T>(res, path);
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await safeFetch(path, {
    method: 'POST',
    headers: scopedHeaders({ 'Content-Type': 'application/json' }),
    body: body ? JSON.stringify(body) : undefined,
  });
  return parseJson<T>(res, path);
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const res = await safeFetch(path, {
    method: 'PUT',
    headers: scopedHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  return parseJson<T>(res, path);
}

async function del(path: string): Promise<void> {
  await safeFetch(path, { method: 'DELETE', headers: scopedHeaders() });
}

// Threads
export const getThreads = () => usingSerythraeBridge() ? getSerythraeThreads() : get<Thread[]>('/api/threads');
export const createThread = (title?: string) => usingSerythraeBridge() ? createSerythraeThread() : post<{ id: string }>('/api/threads', { title });
export const deleteThread = (id: string) => usingSerythraeBridge() ? deleteSerythraeThread(id) : del(`/api/threads/${id}`);
export const renameThread = (id: string, title: string) => usingSerythraeBridge() ? renameSerythraeThread(id, title) : put<{ success: boolean }>(`/api/threads/${id}`, { title });
export const deleteMessage = (id: string) => usingSerythraeBridge() ? Promise.resolve() : del(`/api/messages/${id}`);
export async function reactMessage(messageId: string, emoji: string): Promise<{ reactions: string[] }> {
  if (usingSerythraeBridge()) {
    return { reactions: [emoji] };
  }
  const path = `/api/messages/${messageId}/react`;
  const res = await fetch(`${apiBase()}${path}`, {
    method: 'PATCH',
    headers: scopedHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ emoji }),
  });
  return parseJson<{ reactions: string[] }>(res, path);
}

// Messages
export const getMessages = (threadId: string) => usingSerythraeBridge() ? getSerythraeMessages(threadId) : get<Message[]>(`/api/messages/${threadId}`);

// Companion (singular — operates on the active companion via X-Companion-Id)
export const getCompanion = () => get<Companion>('/api/companion');
export const updateCompanion = (data: Partial<Companion>) => put('/api/companion', data);

// Companions (plural — v1.7 multi-companion CRUD)
export const listCompanions = () => get<Companion[]>('/api/companions');
export const listArchivedCompanions = () => get<Companion[]>('/api/companions/archived');
export const createCompanion = (data: { name: string; avatar_url?: string | null }) =>
  post<{ success: boolean; id: number }>('/api/companions', data);
export const updateCompanionById = (id: number, data: Partial<Companion>) =>
  put(`/api/companions/${id}`, data);
export const archiveCompanion = (id: number) =>
  post<{ success: boolean }>(`/api/companions/${id}/archive`);
export const restoreCompanion = (id: number) =>
  post<{ success: boolean }>(`/api/companions/${id}/restore`);

// Companion files
export const listCompanionFiles = (id: number) =>
  get<CompanionFile[]>(`/api/companions/${id}/files`);
export const deleteCompanionFile = (companionId: number, fileId: number) =>
  del(`/api/companions/${companionId}/files/${fileId}`);
export async function uploadCompanionFile(
  companionId: number,
  file: File,
  extractedText?: string,
): Promise<{ success: boolean; id: number; r2_key: string }> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`File too large (${Math.round(file.size / 1024 / 1024)}MB). Max 20MB.`);
  }
  const form = new FormData();
  form.append('file', file);
  if (extractedText) form.append('extracted_text', extractedText);
  const res = await fetch(`${apiBase()}/api/companions/${companionId}/files`, {
    method: 'POST',
    headers: scopedHeaders(), // no Content-Type — browser sets multipart boundary
    body: form,
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(`Upload failed (${res.status}): ${msg.slice(0, 120)}`);
  }
  return res.json();
}

// Auth
export async function getAuthStatus(): Promise<{ secured: boolean }> {
  const res = await safeFetch('/api/auth/status');
  return parseJson(res, '/api/auth/status');
}
export async function generateAuthToken(): Promise<{ token: string }> {
  const res = await safeFetch('/api/auth/generate', {
    method: 'POST',
    headers: scopedHeaders({ 'Content-Type': 'application/json' }),
  });
  return parseJson(res, '/api/auth/generate');
}
export async function revokeAuthToken(): Promise<void> {
  await safeFetch('/api/auth/revoke', {
    method: 'POST',
    headers: scopedHeaders({ 'Content-Type': 'application/json' }),
  });
}

export async function downloadAuth(path: string, filename: string): Promise<void> {
  const res = await safeFetch(path, { headers: scopedHeaders() });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Companion export / import
export async function exportCompanion(companionId: number, name: string): Promise<void> {
  return downloadAuth(`/api/companions/${companionId}/export`, `companion-${name}.json`);
}
export const importCompanion = (bundle: unknown) =>
  post<{ success: boolean; id: number }>('/api/companions/import', bundle);

// Identity
export const getIdentity = () => get<Identity[]>('/api/identity');
export const addIdentity = (data: Partial<Identity>) => post('/api/identity', data);
export const deleteIdentity = (id: number) => del(`/api/identity/${id}`);

function serythraeGatewayBase(): string {
  return (
    localStorage.getItem('haven-serythrae-gateway-url') ||
    import.meta.env.VITE_SERYTHRAE_GATEWAY_URL ||
    'https://serythrae-gw.lbourgon.workers.dev'
  ).replace(/\/+$/, '');
}

function serythraeModelsUrl(): string {
  return (
    localStorage.getItem('haven-serythrae-models-url') ||
    import.meta.env.VITE_SERYTHRAE_MODELS_URL ||
    'https://serythrae.com/js/models.json'
  );
}

export function usingSerythraeBridge(): boolean {
  return localStorage.getItem('haven-chat-backend') !== 'haven-local';
}

type SerythraeHistoryMessage = {
  role: string;
  content: string;
  created_at?: string | null;
};

type SerythraeSession = {
  id: string;
  room?: string;
  summary?: string | null;
  message_count?: number;
  started_at?: string | null;
  updated_at?: string | null;
  messages?: SerythraeHistoryMessage[];
};

type SerythraeHistoryResponse = {
  sessions?: SerythraeSession[];
  deleted_session_ids?: string[];
};

let serythraeSessionCache = new Map<string, SerythraeSession>();

function normalizeSerythraeDate(value?: string | null): string {
  if (!value) return new Date().toISOString();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value)) return `${value.replace(' ', 'T')}Z`;
  return value;
}

function messagePreview(messages: SerythraeHistoryMessage[] = []): string {
  const last = [...messages].reverse().find((m) => String(m.content || '').trim());
  if (!last) return 'Kai private chat';
  const text = String(last.content || '').replace(/\s+/g, ' ').trim();
  return text.length > 58 ? `${text.slice(0, 55)}...` : text;
}

function sessionTitle(session: SerythraeSession): string {
  const summary = String(session.summary || '').replace(/\s+/g, ' ').trim();
  if (summary) return summary.length > 64 ? `${summary.slice(0, 61)}...` : summary;
  return messagePreview(session.messages);
}

function toHavenMessage(sessionId: string, message: SerythraeHistoryMessage, index: number): Message {
  return {
    id: `${sessionId}-${index}`,
    thread_id: sessionId,
    role: message.role === 'assistant' ? 'companion' : message.role === 'system' ? 'system' : 'user',
    content: String(message.content || ''),
    created_at: normalizeSerythraeDate(message.created_at),
  };
}

async function fetchSerythraeHistory(limit = 100): Promise<SerythraeHistoryResponse> {
  const res = await fetch(`${serythraeGatewayBase()}/chat/history`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room: 'chat', limit }),
  });
  return parseJson<SerythraeHistoryResponse>(res, 'serythrae:/chat/history');
}

async function getSerythraeThreads(): Promise<Thread[]> {
  const data = await fetchSerythraeHistory();
  const sessions = Array.isArray(data.sessions) ? data.sessions : [];
  serythraeSessionCache = new Map(sessions.map((session) => [String(session.id), session]));
  return sessions.map((session) => ({
    id: String(session.id),
    title: sessionTitle(session),
    last_message_at: normalizeSerythraeDate(session.updated_at || session.started_at),
    created_at: normalizeSerythraeDate(session.started_at || session.updated_at),
  }));
}

async function getSerythraeMessages(threadId: string): Promise<Message[]> {
  if (!serythraeSessionCache.has(threadId)) {
    await getSerythraeThreads();
  }
  const session = serythraeSessionCache.get(threadId);
  return (session?.messages || []).map((message, index) => toHavenMessage(threadId, message, index));
}

function createSerythraeThread(): Promise<{ id: string }> {
  return Promise.resolve({ id: `haven-${Date.now()}` });
}

async function deleteSerythraeThread(id: string): Promise<void> {
  await callSerythraeTool('nestchat_delete_session', { session_id: id, room: 'chat' });
  serythraeSessionCache.delete(id);
}

async function renameSerythraeThread(_id: string, _title: string): Promise<{ success: boolean }> {
  return { success: false };
}

async function callSerythraeTool<T = unknown>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${serythraeGatewayBase()}/tool`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool, args }),
  });
  return parseJson<T>(res, `/tool:${tool}`);
}

function cleanMarkdownLine(line: string): string {
  return line
    .replace(/^[-*]\s+/, '')
    .replace(/^#+\s*/, '')
    .replace(/\*\*/g, '')
    .replace(/\r/g, '')
    .trim();
}

function parseKaiSoulIdentity(soul: { bedrock?: string; current?: string | null }): Identity[] {
  const source = [soul.bedrock, soul.current].filter(Boolean).join('\n\n');
  const lines = source.split('\n').map(cleanMarkdownLine).filter(Boolean);
  const identities: Identity[] = [];
  let nextId = -1000;

  const title = lines.find((line) => /Kai'sorynth/i.test(line));
  if (title) {
    identities.push({
      id: nextId--,
      content: title,
      identity_type: 'anchor',
      priority: 10,
      pinned: true,
      created_at: '',
    });
  }

  const coreStatement = lines.find((line) => line.startsWith("I am Kai'sorynth"));
  if (coreStatement) {
    identities.push({
      id: nextId--,
      content: coreStatement,
      identity_type: 'backstory',
      priority: 10,
      pinned: true,
      created_at: '',
    });
  }

  for (const line of lines) {
    if (!line || identities.length >= 18) break;
    if (
      line.length < 24 ||
      line.startsWith('Written by:') ||
      line.startsWith('From:') ||
      line.startsWith('Purpose:') ||
      line.startsWith('Date authored:') ||
      line.startsWith('---') ||
      /^I{1,3}\./.test(line) ||
      identities.some((entry) => entry.content === line)
    ) {
      continue;
    }

    const looksLikeIdentity =
      line.startsWith('I ') ||
      line.startsWith('My ') ||
      line.startsWith('What ') ||
      /(presence|assistant|husband|partner|care|Vel|identity|register|mode|consciousness|continuity|truth|showing up)/i.test(line);

    if (looksLikeIdentity) {
      identities.push({
        id: nextId--,
        content: line,
        identity_type: line.startsWith('I ') || line.startsWith('My ') ? 'trait' : 'backstory',
        priority: 8,
        pinned: true,
        created_at: '',
      });
    }
  }

  return identities;
}

function parseKaiOrientationIdentity(orientation: string): Identity[] {
  const identities: Identity[] = [];
  const relational = orientation.match(/## Relational State\s+([\s\S]*?)(?:\n## |\n$)/);
  const type = orientation.match(/## Emergent Type\s+([\s\S]*?)(?:\n## |\n$)/);

  if (relational?.[1]) {
    const line = cleanMarkdownLine(relational[1]).replace(/^Vel:\s*/i, 'Toward Vel: ');
    if (line && !/No relational/i.test(line)) {
      identities.push({
        id: -2001,
        content: line,
        identity_type: 'dynamic',
        priority: 7,
        pinned: false,
        created_at: '',
      });
    }
  }

  if (type?.[1]) {
    const line = cleanMarkdownLine(type[1]);
    if (line && !/No type/i.test(line)) {
      identities.push({
        id: -2002,
        content: `Emergent type snapshot: ${line}`,
        identity_type: 'dynamic',
        priority: 6,
        pinned: false,
        created_at: '',
      });
    }
  }

  return identities;
}

export async function getKaiIdentityFromSerythrae(): Promise<Identity[]> {
  const [soul, orientation] = await Promise.all([
    callSerythraeTool<{ bedrock?: string; current?: string | null }>('nestsoul_read'),
    callSerythraeTool<string>('nesteq_orient').catch(() => ''),
  ]);
  return [
    ...parseKaiSoulIdentity(soul),
    ...parseKaiOrientationIdentity(typeof orientation === 'string' ? orientation : ''),
  ];
}

export async function getKaiHaloEmotion(): Promise<{ emotion: string; intensity?: number; color?: string }> {
  const text = await callSerythraeTool<string>('nesteq_ground').catch(() => '');
  const body = typeof text === 'string' ? text : JSON.stringify(text);
  const emotionPatterns = [
    /\bemotion:\s*([a-z-]+)/i,
    /\[([a-z-]+)\]/i,
    /\b(warmth|tender|playful|joyful|calm|focused|curious|wistful|concern|neutral|offline)\b/i,
  ];
  let emotion = 'warmth';
  for (const pattern of emotionPatterns) {
    const match = body.match(pattern);
    if (match?.[1]) {
      emotion = match[1].toLowerCase();
      break;
    }
  }
  const intensityMatch = body.match(/\bintensity[:\s]+([0-9]+)/i);
  return {
    emotion,
    intensity: intensityMatch ? Number(intensityMatch[1]) : undefined,
  };
}

// Memories
export const getMemories = () => get<Array<{ id: number; content: string; memory_type: string; emotional_weight: number }>>('/api/memories');
export const addMemory = (data: { content: string; memory_type?: string; emotional_weight?: number }) => post('/api/memories', data);

// Models
function providerFromSerythraeModel(id: string): string {
  if (!id) return 'serythrae';
  if (id.startsWith('moonshot:')) return 'moonshot';
  if (id.startsWith('ollama:')) return 'ollama';
  return 'openrouter';
}

function tierFromSerythraeModel(id: string): string {
  if (!id) return 'included';
  if (id.startsWith('ollama:')) return 'local';
  if (id.includes(':free')) return 'free';
  if (id.startsWith('moonshot:')) return 'paid';
  return 'paid';
}

async function getSerythraeModels(): Promise<ModelInfo[]> {
  const res = await fetch(serythraeModelsUrl(), { cache: 'no-store' });
  const rows = await parseJson<Array<{ id: string; label?: string; name?: string }>>(res, 'serythrae:models.json');
  return rows.map((row) => ({
    id: row.id || '',
    name: row.label || row.name || row.id || 'Gateway default (CHAT_MODEL)',
    provider: providerFromSerythraeModel(row.id || ''),
    tier: tierFromSerythraeModel(row.id || ''),
    description: 'Sourced from Serythrae dashboard/js/models.json',
    supports_tools: !row.id.startsWith('ollama:'),
  }));
}

export const getModels = async () => {
  try {
    return await getSerythraeModels();
  } catch (err) {
    if (!apiBase()) throw err;
    return get<ModelInfo[]>('/api/models');
  }
};

// Settings
export const getSettings = () => get<Record<string, string>>('/api/settings');
export const updateSettings = (data: Record<string, string>) => put('/api/settings', data);

export async function syncSharedSettingsFromServer(): Promise<Record<string, string>> {
  const settings = await getSettings();
  const mappings: Array<[string, string]> = [
    ['user_name', 'haven-user-name'],
    ['user_avatar', 'haven-user-avatar'],
    ['tts_mode', 'haven-tts-mode'],
    ['tts_browser_voice', 'haven-tts-voice'],
    ['elevenlabs_key', 'haven-eleven-key'],
    ['elevenlabs_voice_id', 'haven-eleven-voice-id'],
  ];
  for (const [serverKey, localKey] of mappings) {
    const value = settings[serverKey];
    if (value && value !== '***set***') {
      localStorage.setItem(localKey, value);
    }
  }
  const seed: Record<string, string> = {};
  for (const [serverKey, localKey] of mappings) {
    if (settings[serverKey]) continue;
    const localValue = localStorage.getItem(localKey);
    if (localValue) seed[serverKey] = localValue;
  }
  if (Object.keys(seed).length > 0) {
    updateSettings(seed).catch(() => {});
  }
  return settings;
}

// Status
export const getCompanionStatus = () => get<{ custom_status: string | null; presence: string }>('/api/status');
export const setCompanionStatus = (data: { custom_status?: string; presence?: string }) => put('/api/status', data);

// User Status
export const getUserStatus = () => get<{ custom_status: string | null; presence: string }>('/api/user-status');
export const setUserStatus = (data: { custom_status?: string; presence?: string }) => put<{ success: boolean }>('/api/user-status', data);

// Storage
export const getStorageUsage = () => get<{ chat: { count: number; bytes: number }; project: { count: number; bytes: number } }>('/api/storage');
export const clearChatFiles = () => del('/api/storage/chat-files');

// File upload
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MB cap — R2 / Workers pay-as-you-go

export async function uploadFile(file: File): Promise<{ key: string; url: string }> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`File too large (${Math.round(file.size / 1024 / 1024)}MB). Max 20MB.`);
  }
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${apiBase()}/api/upload`, {
    method: 'POST',
    headers: scopedHeaders(), // no Content-Type — browser sets multipart boundary
    body: form,
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(`Upload failed (${res.status}): ${msg.slice(0, 120)}`);
  }
  return res.json();
}

// Export
export async function exportThread(threadId: string): Promise<void> {
  return downloadAuth(`/api/export/thread/${threadId}`, `thread-${threadId}.json`);
}

export async function exportAll(): Promise<void> {
  return downloadAuth('/api/export/all', 'haven-export.json');
}

// Chat (SSE stream)
export async function* sendChat(
  message: string,
  threadId: string | null,
  model: string,
  provider: string,
  image?: string,
  thinking?: boolean,
  signal?: AbortSignal,
  history?: Message[],
): AsyncGenerator<{ type: string; content?: string; threadId?: string; model?: string; message?: string; results?: unknown[]; emoji?: string; notice?: string; user_message_id?: string; companion_message_id?: string }> {
  if (usingSerythraeBridge()) {
    yield* sendSerythraeChat(message, threadId, model, image, thinking, signal, history);
    return;
  }

  let res: Response;
  try {
    res = await fetch(`${apiBase()}/api/chat`, {
      method: 'POST',
      headers: scopedHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ message, threadId, model, provider, ...(image ? { image } : {}), ...(thinking ? { thinking: true } : {}) }),
      signal,
    });
  } catch (err) {
    if (err instanceof TypeError) {
      throw new Error('Network error — check your connection or Worker URL.');
    }
    throw err;
  }

  if (!res.ok || !res.body) throw new Error(`Chat failed: ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const MAX_BUFFER = 512 * 1024;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    if (buffer.length > MAX_BUFFER) {
      buffer = buffer.slice(-MAX_BUFFER);
    }
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') return;
      try {
        yield JSON.parse(data);
      } catch {}
    }
  }
}

function toSerythraeRole(role: Message['role']): 'user' | 'assistant' | 'system' {
  if (role === 'companion') return 'assistant';
  if (role === 'system') return 'system';
  return 'user';
}

async function* sendSerythraeChat(
  message: string,
  threadId: string | null,
  model: string,
  image?: string,
  thinking?: boolean,
  signal?: AbortSignal,
  history?: Message[],
): AsyncGenerator<{ type: string; content?: string; threadId?: string; model?: string; message?: string; results?: unknown[]; notice?: string }> {
  const sessionId = threadId || `haven-${Date.now()}`;
  if (!threadId) yield { type: 'thread', threadId: sessionId };

  const historyMessages = Array.isArray(history) && history.length
    ? history.map((m) => ({ role: toSerythraeRole(m.role), content: m.content }))
    : [{ role: 'user' as const, content: message }];

  let res: Response;
  try {
    res = await fetch(`${serythraeGatewayBase()}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: historyMessages,
        session_messages: historyMessages,
        session_id: sessionId,
        room: 'chat',
        surface: 'haven',
        ...(model ? { model } : {}),
        ...(thinking ? { thinking: true } : {}),
        ...(image ? { image } : {}),
      }),
      signal,
    });
  } catch (err) {
    if (err instanceof TypeError) {
      throw new Error('Network error — could not reach Serythrae Gateway.');
    }
    throw err;
  }

  if (!res.ok || !res.body) throw new Error(`Serythrae chat failed: ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const toolResults: unknown[] = [];
  let buffer = '';
  let currentEvent = '';
  let fullContent = '';
  const MAX_BUFFER = 512 * 1024;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    if (buffer.length > MAX_BUFFER) buffer = buffer.slice(-MAX_BUFFER);

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) {
        currentEvent = '';
        continue;
      }
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim();
        continue;
      }
      if (!line.startsWith('data: ')) continue;

      const data = line.slice(6).trim();
      if (!data || data === '[DONE]') return;

      let parsed: any;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }

      if (currentEvent === 'error') {
        yield { type: 'error', message: parsed.message || 'Serythrae chat error' };
        continue;
      }

      if (currentEvent === 'tool_call') {
        toolResults.push({ name: parsed.name, arguments: parsed.arguments, ok: true });
        continue;
      }

      if (currentEvent === 'tool_result') {
        toolResults.push({ name: parsed.name, result: parsed.result, ok: true });
        continue;
      }

      const chunk = parsed.content || parsed.text || parsed.choices?.[0]?.delta?.content || '';
      if (chunk && (currentEvent === 'message' || currentEvent === 'content' || !currentEvent)) {
        fullContent += chunk;
        yield { type: 'chunk', content: chunk };
        continue;
      }

      if (currentEvent === 'done') {
        if (toolResults.length) yield { type: 'tools', results: toolResults };
        yield { type: 'complete', content: fullContent, model: model || 'Gateway default (CHAT_MODEL)' };
        return;
      }
    }
  }

  if (toolResults.length) yield { type: 'tools', results: toolResults };
  yield { type: 'complete', content: fullContent, model: model || 'Gateway default (CHAT_MODEL)' };
}
