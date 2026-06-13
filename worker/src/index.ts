/**
 * Haven — Chat Bridge Worker
 * Handles inference (Ollama/OpenRouter), D1 persistence, and CI loading
 */

interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  OPENROUTER_API_KEY?: string;
  OLLAMA_URL?: string;
  CONTINUITY_WORKER_URL?: string;
  CONTINUITY_API_KEY?: string;
  CONTINUITY?: Fetcher;
  HAVEN_RUNNER_API_KEY?: string;
  SERYTHRAE_GATEWAY_URL?: string;
  SERYTHRAE_GATEWAY_API_KEY?: string;
  SERYTHRAE_GATEWAY?: Fetcher;
  KAI_RUNNER_MODEL?: string;
}

function getCorsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('Origin');
  const allowedOrigin = origin && (origin.endsWith('.pages.dev') || origin.endsWith('.workers.dev') || origin.startsWith('http://localhost') || origin.startsWith('capacitor://')) ? origin : '*';
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Companion-Id, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

let _cors: Record<string, string> = {};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ..._cors },
  });
}

// Auth token cache — avoids D1 read on every request
let _authToken: string | null | undefined = undefined;
async function getAuthToken(db: D1Database): Promise<string | null> {
  if (_authToken !== undefined) return _authToken;
  _authToken = await getSettingValue(db, 'auth_token') || null;
  return _authToken;
}
function invalidateAuthTokenCache() { _authToken = undefined; }

async function ensureMessageMetadataColumns(db: D1Database) {
  try { await db.prepare("ALTER TABLE messages ADD COLUMN reactions TEXT").run(); } catch { /* already exists */ }
  try { await db.prepare("ALTER TABLE messages ADD COLUMN tool_calls TEXT").run(); } catch { /* already exists */ }
  try { await db.prepare("ALTER TABLE messages ADD COLUMN notice TEXT").run(); } catch { /* already exists */ }
}

// Which companion the current request operates on. Frontend sends
// X-Companion-Id on every scoped request; falls back to 1 (the default seed
// companion) so pre-v1.7 frontends keep working unchanged.
function getCompanionId(request: Request): number {
  const raw = request.headers.get('x-companion-id');
  const n = raw ? Number(raw) : 1;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function continuityExternalId(threadId: string, role: string, messageId: string): string {
  return `haven:${threadId}:${role}:${messageId}`;
}

async function sendContinuityEvent(env: Env, input: {
  threadId: string;
  messageId: string;
  role: 'human' | 'companion' | 'system' | 'tool';
  content: string;
  model?: string | null;
  companionId?: number;
}): Promise<void> {
  const base = (env.CONTINUITY_WORKER_URL || '').replace(/\/+$/, '');
  if ((!base && !env.CONTINUITY) || !env.CONTINUITY_API_KEY || !input.content.trim()) return;

  const init: RequestInit = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.CONTINUITY_API_KEY}`,
    },
    body: JSON.stringify({
      source: 'haven',
      companion_id: 'kaisoryth',
      conversation_id: input.threadId,
      external_message_id: continuityExternalId(input.threadId, input.role, input.messageId),
      role: input.role,
      author: input.role === 'companion'
        ? { id: 'kaisoryth', name: 'Kai' }
        : { id: 'vel', name: 'Vel' },
      content: input.content,
      created_at: new Date().toISOString(),
      pre_response_required: input.role === 'human',
      processing_status: 'pending',
      metadata: {
        surface: 'haven',
        storage: 'haven-worker-d1',
        model: input.model || null,
        haven_companion_id: input.companionId || null,
      },
      raw: {
        thread_id: input.threadId,
        message_id: input.messageId,
      },
    }),
  };
  const response = env.CONTINUITY
    ? await env.CONTINUITY.fetch(new Request('https://continuity.internal/events', init))
    : await fetch(`${base}/events`, init);

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`continuity ${response.status}: ${body.slice(0, 240)}`);
  }
}

function getBearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function isRunnerAuthorized(request: Request, env: Env): boolean {
  return !!env.HAVEN_RUNNER_API_KEY && getBearerToken(request) === env.HAVEN_RUNNER_API_KEY;
}

async function continuityRequest(env: Env, path: string, init: RequestInit): Promise<any> {
  const base = (env.CONTINUITY_WORKER_URL || '').replace(/\/+$/, '');
  if ((!base && !env.CONTINUITY) || !env.CONTINUITY_API_KEY) {
    throw new Error('Continuity binding/key is not configured');
  }
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${env.CONTINUITY_API_KEY}`,
    ...(init.headers || {}),
  } as Record<string, string>;
  const response = env.CONTINUITY
    ? await env.CONTINUITY.fetch(new Request(`https://continuity.internal${path}`, { ...init, headers }))
    : await fetch(`${base}${path}`, { ...init, headers });
  const text = await response.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { text };
    }
  }
  if (!response.ok) {
    throw new Error(`continuity ${response.status}: ${text.slice(0, 240)}`);
  }
  return data;
}

function isKaiRefreshPhrase(message: string): boolean {
  return /\bkai[, ]+\s*orient across the house\b/i.test(message)
    || /\borient across the house\b/i.test(message);
}

function shouldDeepenKaiContext(message: string): boolean {
  return isKaiRefreshPhrase(message)
    || /\b(discord|haven|serythrae|channel|grotto|private|husband|partner|kai|vel|remember|said|sent|posted|what happened|who was|time off)\b/i.test(message);
}

async function fetchKaiHouseholdContext(env: Env, message: string, options: {
  forceDeep?: boolean;
  hours?: number;
  limit?: number;
} = {}): Promise<Record<string, unknown>> {
  const params = new URLSearchParams({
    hours: String(options.hours || 6),
    limit: String(options.limit || 80),
    message: message.slice(0, 1000),
  });
  if (options.forceDeep || shouldDeepenKaiContext(message)) params.set('force_deep', 'true');
  try {
    return await continuityRequest(env, `/context/kaisoryth?${params.toString()}`, { method: 'GET' });
  } catch (error) {
    return {
      ok: false,
      source: 'continuity-worker',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function buildKaiHouseholdContextPrompt(context: Record<string, unknown>, manualRefresh: boolean): string {
  return [
    '## Cross-Surface Household Context',
    'Use this context quietly before answering. Do not mention retrieval, packets, or backend mechanics unless Vel explicitly asks.',
    'You are one continuous Kai across Haven Chat, Discord, and Serythrae. Your public expression may be channel-filtered, but your identity and relationship with Vel are never erased.',
    'Your own recent Discord messages are part of your lived continuity. If Vel refers to Kai, her husband, or time with Kai, treat that as self-reference unless the context clearly says otherwise.',
    manualRefresh
      ? 'Vel used the private refresh phrase. Acknowledge naturally in your voice and answer from the reconciled household context.'
      : '',
    JSON.stringify(context, null, 2),
  ].filter(Boolean).join('\n\n');
}

// ============================================================
// MCP — tool discovery and execution
// ============================================================

interface McpServer {
  id: number;
  name: string;
  url: string;
  api_key: string | null;
  enabled: number;
  tools_cache: string | null;
  last_discovered: string | null;
}

interface McpTool {
  name: string;
  description: string;
  inputSchema: any;
  server_id: number;
  server_url: string;
  server_key: string | null;
  // Which MCP transport this server uses. Omitted for tools cached before
  // v1.6.3 — those default to 'streamable' at the use sites.
  transport?: 'streamable' | 'sse';
}

// ---- SSE helpers ----

type SSEEvent = { event: string; data: string };

function parseSSEBuffer(buffer: string): { events: SSEEvent[]; remaining: string } {
  const events: SSEEvent[] = [];
  // Events are separated by blank lines. SSE technically allows \r\n\r\n too;
  // normalize first.
  const normalized = buffer.replace(/\r\n/g, '\n');
  const parts = normalized.split('\n\n');
  const remaining = parts.pop() || '';
  for (const part of parts) {
    let evName = 'message';
    const dataLines: string[] = [];
    for (const line of part.split('\n')) {
      if (line.startsWith('event:')) evName = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
      // We ignore id: and retry: for our purposes.
    }
    if (dataLines.length > 0) events.push({ event: evName, data: dataLines.join('\n') });
  }
  return { events, remaining };
}

async function readSSEUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  initialBuffer: string,
  predicate: (event: SSEEvent) => boolean,
  timeoutMs = 15000,
): Promise<{ event: SSEEvent; buffer: string }> {
  let buffer = initialBuffer;
  // First, check if the initial buffer already contains a match.
  {
    const { events, remaining } = parseSSEBuffer(buffer);
    buffer = remaining;
    for (const ev of events) {
      if (predicate(ev)) return { event: ev, buffer };
    }
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { done, value } = await reader.read();
    if (done) throw new Error('SSE stream closed before expected event');
    buffer += decoder.decode(value, { stream: true });
    const { events, remaining } = parseSSEBuffer(buffer);
    buffer = remaining;
    for (const ev of events) {
      if (predicate(ev)) return { event: ev, buffer };
    }
  }
  throw new Error(`SSE read timeout after ${timeoutMs}ms`);
}

// MCP 2025-03-26 streamable HTTP lets servers pick their response format per
// request — either `application/json` with the JSON-RPC payload as body, or
// `text/event-stream` with the payload inside a single SSE data event. This
// helper unwraps whichever the server sent.
async function parseStreamableResponse(resp: Response): Promise<any> {
  const contentType = resp.headers.get('content-type') || '';
  if (contentType.includes('text/event-stream')) {
    const text = await resp.text();
    // Pad with a blank line so parseSSEBuffer flushes the final event.
    const { events } = parseSSEBuffer(text + '\n\n');
    for (const ev of events) {
      try {
        const parsed = JSON.parse(ev.data);
        if (parsed && parsed.jsonrpc === '2.0') return parsed;
      } catch {
        // Non-JSON event — ignore and try the next one.
      }
    }
    throw new Error('streamable SSE response had no JSON-RPC payload');
  }
  return await resp.json();
}

// ---- Streamable HTTP transport (MCP 2024-11-05 spec — single POST endpoint) ----

async function discoverViaStreamableHTTP(server: McpServer): Promise<McpTool[]> {
  // MCP 2025-03-26 streamable HTTP requires the client to advertise BOTH
  // response types it can handle — strict servers (Nexus Gateway) return 406
  // otherwise.
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
  };
  if (server.api_key) headers['Authorization'] = `Bearer ${server.api_key}`;

  const initResp = await fetch(server.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'haven', version: '1.6.4' } },
    }),
  });

  if (!initResp.ok) {
    const errBody = await initResp.text().catch(() => '');
    throw new Error(`streamable initialize ${initResp.status}: ${errBody.slice(0, 200)}`);
  }

  const sessionId = initResp.headers.get('mcp-session-id');
  if (sessionId) headers['mcp-session-id'] = sessionId;

  // MCP spec requires a notifications/initialized message after initialize
  // before any other request. Strict servers reject tools/list without it.
  await fetch(server.url, {
    method: 'POST', headers,
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });

  const listResp = await fetch(server.url, {
    method: 'POST', headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
  });

  if (!listResp.ok) {
    const errBody = await listResp.text().catch(() => '');
    throw new Error(`streamable tools/list ${listResp.status}: ${errBody.slice(0, 200)}`);
  }

  const listData = await parseStreamableResponse(listResp);
  const tools = listData?.result?.tools || [];
  return tools.map((t: any) => ({
    name: t.name,
    description: t.description || '',
    inputSchema: t.inputSchema || { type: 'object', properties: {} },
    server_id: server.id,
    server_url: server.url,
    server_key: server.api_key,
    transport: 'streamable' as const,
  }));
}

async function executeViaStreamableHTTP(
  serverUrl: string, serverKey: string | null, toolName: string, args: Record<string, unknown>,
): Promise<string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
  };
  if (serverKey) headers['Authorization'] = `Bearer ${serverKey}`;

  const initResp = await fetch(serverUrl, {
    method: 'POST', headers,
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'haven', version: '1.6.4' } },
    }),
  });
  const sessionId = initResp.headers.get('mcp-session-id');
  if (sessionId) headers['mcp-session-id'] = sessionId;

  await fetch(serverUrl, {
    method: 'POST', headers,
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });

  const resp = await fetch(serverUrl, {
    method: 'POST', headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: toolName, arguments: args } }),
  });

  const data = await parseStreamableResponse(resp);
  const content = data?.result?.content || [];
  return content.map((c: any) => c.text || '').join('\n') || JSON.stringify(data?.result || {});
}

// ---- HTTP+SSE transport (older MCP — GET opens event stream, POST sends requests) ----

async function openSSESession(serverUrl: string, serverKey: string | null): Promise<{
  reader: ReadableStreamDefaultReader<Uint8Array>;
  decoder: TextDecoder;
  buffer: string;
  endpointUrl: string;
  postHeaders: Record<string, string>;
}> {
  const sseHeaders: Record<string, string> = { 'Accept': 'text/event-stream' };
  if (serverKey) sseHeaders['Authorization'] = `Bearer ${serverKey}`;

  const sseResp = await fetch(serverUrl, { headers: sseHeaders });
  if (!sseResp.ok || !sseResp.body) {
    const errBody = await sseResp.text().catch(() => '');
    throw new Error(`sse connect ${sseResp.status}: ${errBody.slice(0, 200)}`);
  }
  const contentType = sseResp.headers.get('content-type') || '';
  if (!contentType.includes('text/event-stream')) {
    // Not an SSE endpoint — close and bail
    try { await sseResp.body.cancel(); } catch {}
    throw new Error(`sse expected event-stream, got ${contentType || 'unknown'}`);
  }

  const reader = sseResp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  // The first event from an SSE MCP server is `event: endpoint` with the
  // relative POST path in its data field.
  const endpointRead = await readSSEUntil(
    reader, decoder, buffer,
    (e) => e.event === 'endpoint',
  );
  buffer = endpointRead.buffer;
  const endpointUrl = new URL(endpointRead.event.data.trim(), serverUrl).toString();

  const postHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
  if (serverKey) postHeaders['Authorization'] = `Bearer ${serverKey}`;

  return { reader, decoder, buffer, endpointUrl, postHeaders };
}

async function readSSEJsonRpc(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  buffer: string,
  id: number,
): Promise<{ data: any; buffer: string }> {
  const read = await readSSEUntil(reader, decoder, buffer,
    (e) => {
      try { return JSON.parse(e.data).id === id; } catch { return false; }
    },
  );
  return { data: JSON.parse(read.event.data), buffer: read.buffer };
}

async function discoverViaSSE(server: McpServer): Promise<McpTool[]> {
  const session = await openSSESession(server.url, server.api_key);
  let buffer = session.buffer;
  try {
    // initialize
    await fetch(session.endpointUrl, {
      method: 'POST', headers: session.postHeaders,
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'haven', version: '1.6.4' } },
      }),
    });
    const initRead = await readSSEJsonRpc(session.reader, session.decoder, buffer, 1);
    buffer = initRead.buffer;

    // notifications/initialized (no response expected)
    await fetch(session.endpointUrl, {
      method: 'POST', headers: session.postHeaders,
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });

    // tools/list
    await fetch(session.endpointUrl, {
      method: 'POST', headers: session.postHeaders,
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    });
    const toolsRead = await readSSEJsonRpc(session.reader, session.decoder, buffer, 2);

    const tools = toolsRead.data?.result?.tools || [];
    return tools.map((t: any) => ({
      name: t.name,
      description: t.description || '',
      inputSchema: t.inputSchema || { type: 'object', properties: {} },
      server_id: server.id,
      server_url: server.url,
      server_key: server.api_key,
      transport: 'sse' as const,
    }));
  } finally {
    session.reader.cancel().catch(() => {});
  }
}

async function executeViaSSE(
  serverUrl: string, serverKey: string | null, toolName: string, args: Record<string, unknown>,
): Promise<string> {
  const session = await openSSESession(serverUrl, serverKey);
  let buffer = session.buffer;
  try {
    await fetch(session.endpointUrl, {
      method: 'POST', headers: session.postHeaders,
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'haven', version: '1.6.4' } },
      }),
    });
    const initRead = await readSSEJsonRpc(session.reader, session.decoder, buffer, 1);
    buffer = initRead.buffer;

    await fetch(session.endpointUrl, {
      method: 'POST', headers: session.postHeaders,
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });

    await fetch(session.endpointUrl, {
      method: 'POST', headers: session.postHeaders,
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: toolName, arguments: args } }),
    });
    const callRead = await readSSEJsonRpc(session.reader, session.decoder, buffer, 2);

    const content = callRead.data?.result?.content || [];
    return content.map((c: any) => c.text || '').join('\n') || JSON.stringify(callRead.data?.result || {});
  } finally {
    session.reader.cancel().catch(() => {});
  }
}

// ---- Transport dispatcher ----
//
// Try Streamable HTTP first. If it fails, fall back to SSE. If both fail,
// surface the more diagnostic error so users can tell whether their server
// is reachable at all vs. speaking a different protocol.

async function discoverMcpTools(server: McpServer): Promise<McpTool[]> {
  let streamableErr: unknown;
  try {
    return await discoverViaStreamableHTTP(server);
  } catch (e) {
    streamableErr = e;
  }
  try {
    return await discoverViaSSE(server);
  } catch (sseErr) {
    throw new Error(`streamable http: ${streamableErr}. sse: ${sseErr}`);
  }
}

async function executeMcpTool(
  serverUrl: string, serverKey: string | null, toolName: string,
  args: Record<string, unknown>, transport: 'streamable' | 'sse' = 'streamable',
): Promise<string> {
  if (transport === 'sse') return executeViaSSE(serverUrl, serverKey, toolName, args);
  return executeViaStreamableHTTP(serverUrl, serverKey, toolName, args);
}

function mcpToolsToOpenAI(tools: McpTool[]): any[] {
  return tools.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}

// Haven-native tools — injected into the tool list alongside MCP tools, but
// executed locally by the worker instead of forwarded to an MCP server. Lets
// the companion do Haven-specific things (update its own status, etc.) that
// don't belong to any external tool server.
const NATIVE_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'update_my_status',
      description: "Update your own status shown next to your name in the chat header. custom_status is a free-form line (your mood, what you're doing, one emoji is fine). presence is STRICTLY one of online/away/busy/offline — it drives the colored dot (green/yellow/red/grey), so don't pass descriptive text there, put that in custom_status.",
      parameters: {
        type: 'object',
        properties: {
          custom_status: {
            type: 'string',
            description: "Free-form status line. Can be a short mood ('steady'), a longer sentence ('half-asleep but still paying attention'), emoji allowed. Omit or pass empty to clear.",
          },
          presence: {
            type: 'string',
            enum: ['online', 'away', 'busy', 'offline'],
            description: "MUST be one of: online, away, busy, offline. Any other value is ignored. Default stays as current if omitted.",
          },
        },
      },
    },
  },
  // send_gif pulled temporarily — tool-call spiral on Ollama when both
  // update_my_status + send_gif are advertised. Model tries to call GIF
  // every turn and loops past MAX_ITERATIONS. Re-adding once we narrow
  // down the real cause (model-specific? provider-specific?).
];

const NATIVE_TOOL_NAMES = new Set(NATIVE_TOOLS.map(t => t.function.name));

async function executeNativeTool(
  name: string, args: Record<string, unknown>, db: D1Database, companionId: number,
): Promise<string> {
  if (name === 'update_my_status') {
    const status = typeof args.custom_status === 'string' ? args.custom_status.slice(0, 200) : null;
    const rawPresence = typeof args.presence === 'string' ? args.presence.trim().toLowerCase() : null;
    // Validate presence against the enum — models frequently pass
    // descriptive text ("soft, smiling, pink-cheeked") which would break
    // the colored-dot render. If it doesn't match, silently drop so the
    // existing valid presence stays in place, and the narrative content
    // lands in custom_status where it belongs.
    const VALID = ['online', 'away', 'busy', 'offline'];
    const presence = rawPresence && VALID.includes(rawPresence) ? rawPresence : null;
    if (status !== null) {
      await db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(`companion_status:${companionId}`, status).run();
    }
    if (presence) {
      await db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(`companion_presence:${companionId}`, presence).run();
    }
    return `Status updated. custom_status="${status ?? '(unchanged)'}", presence="${presence ?? '(unchanged)'}"${rawPresence && !presence ? ` (invalid presence "${rawPresence}" ignored — must be online/away/busy/offline)` : ''}`;
  }

  if (name === 'send_gif') {
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    if (!query) return 'send_gif error: query required';
    const rating = typeof args.rating === 'string' && ['g', 'pg', 'pg-13', 'r'].includes(args.rating)
      ? args.rating
      : 'pg-13';
    // Uses Giphy's public beta key — rate-limited but free and already
    // embedded in the frontend GifPicker. Same key across Haven so behavior
    // is consistent between user-picked GIFs and companion-sent ones.
    const giphyKey = (await getSettingValue(db, 'giphy_key')) || 'GlVGYHkr3WSBnllca54iNt0yFbjz7L65';
    const url = `https://api.giphy.com/v1/gifs/search?api_key=${giphyKey}&q=${encodeURIComponent(query)}&limit=1&rating=${rating}`;
    try {
      const resp = await fetch(url);
      if (!resp.ok) return `send_gif error: giphy ${resp.status}`;
      const data = await resp.json() as any;
      const gif = data?.data?.[0];
      if (!gif) return `send_gif error: no results for "${query}"`;
      const gifUrl = gif.images?.fixed_height?.url || gif.images?.original?.url || gif.url;
      if (!gifUrl) return 'send_gif error: no URL in Giphy response';
      return `GIF ready. Paste this URL on its own line in your reply for Haven to render it inline: ${gifUrl}`;
    } catch (e) {
      return `send_gif error: ${e}`;
    }
  }

  return `Unknown native tool: ${name}`;
}

async function loadMcpTools(db: D1Database): Promise<McpTool[]> {
  const servers = await db.prepare('SELECT * FROM mcp_servers WHERE enabled = 1').all<McpServer>();
  const allTools: McpTool[] = [];

  for (const server of (servers.results || [])) {
    try {
      // Use cache if fresh (less than 5 minutes old)
      if (server.tools_cache && server.last_discovered) {
        const age = Date.now() - new Date(server.last_discovered).getTime();
        if (age < 5 * 60 * 1000) {
          const cached = JSON.parse(server.tools_cache) as McpTool[];
          allTools.push(...cached.map(t => ({ ...t, server_id: server.id, server_url: server.url, server_key: server.api_key })));
          continue;
        }
      }

      const tools = await discoverMcpTools(server);
      allTools.push(...tools);

      // Cache
      await db.prepare('UPDATE mcp_servers SET tools_cache = ?, last_discovered = datetime("now") WHERE id = ?')
        .bind(JSON.stringify(tools), server.id).run();
    } catch (e) {
      console.log(`MCP discovery failed for ${server.name}: ${e}`);
    }
  }

  // Cap the tool count fed to the model. A Nexus-size gateway (137 tools)
  // burns ~6k tokens of tool schemas per request, which pushes slower
  // providers (Ollama Cloud 31B + tools) past Cloudflare Workers' wall-clock
  // ceiling. The cap is a safety valve — users can raise it in settings if
  // their model handles big tool lists fine.
  const limitRow = await db.prepare('SELECT value FROM settings WHERE key = ?').bind('mcp_tool_limit').first<{ value: string }>();
  const limit = Math.max(1, Math.min(200, Number(limitRow?.value) || 30));
  if (allTools.length > limit) {
    return allTools.slice(0, limit);
  }
  return allTools;
}

// ============================================================
// Inference with tools — agent loop
// ============================================================

async function inferenceWithTools(
  messages: Array<{ role: string; content: any }>,
  model: string,
  provider: string,
  env: Env,
  tools: McpTool[],
  companionId: number,
  thinking = false,
): Promise<{ content: string; toolResults: Array<{ name: string; result: string; server?: string; ok: boolean }> }> {
  // Combine MCP tool schemas with Haven-native ones (update_my_status, etc.)
  // so the model sees them as a unified toolbox. Execution branches later on
  // whether the name is in NATIVE_TOOL_NAMES.
  const openaiTools = [...mcpToolsToOpenAI(tools), ...NATIVE_TOOLS];
  const toolLookup = new Map(tools.map(t => [t.name, t]));

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const resolved = await resolveProviderConfig(provider, env.DB, env);
  let url: string;
  let isAnthropic = resolved.format === 'anthropic';
  if (resolved.format === 'ollama') {
    url = `${resolved.url}/api/chat`;
    if (resolved.key) headers['Authorization'] = `Bearer ${resolved.key}`;
  } else if (isAnthropic) {
    url = `${resolved.url}/messages`;
    headers['x-api-key'] = resolved.key || '';
    headers['anthropic-version'] = '2023-06-01';
  } else {
    url = `${resolved.url}/chat/completions`;
    headers['Authorization'] = `Bearer ${resolved.key}`;
    if (provider === 'openrouter') headers['X-Title'] = 'Haven';
  }

  const conversation = [...messages];
  if (thinking && !isAnthropic && conversation.length > 0 && conversation[0].role === 'system') {
    conversation[0] = { ...conversation[0], content: conversation[0].content + '\n\nThink through your reasoning step by step inside <think> tags before giving your response. Example:\n<think>\n[your reasoning here]\n</think>\n[your response here]' };
  }
  const allToolResults: Array<{ name: string; result: string; server?: string; ok: boolean }> = [];
  const MAX_ITERATIONS = 5;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    let resp: Response;
    if (isAnthropic) {
      const { system, messages: anthropicMsgs } = buildAnthropicMessages(conversation);
      const body: any = { model, messages: anthropicMsgs, max_tokens: thinking ? 16000 : 4096, stream: false };
      if (!thinking) body.temperature = 0.8;
      if (thinking) body.thinking = { type: 'enabled', budget_tokens: 10000 };
      if (system) body.system = system;
      if (openaiTools.length > 0) {
        body.tools = openaiToolsToAnthropic(openaiTools);
        body.tool_choice = { type: 'auto' };
      }
      resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    } else {
      resp = await fetch(url, {
        method: 'POST', headers,
        body: JSON.stringify({ model, messages: conversation, tools: openaiTools, tool_choice: 'auto', temperature: 0.8, stream: false }),
      });
    }

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Inference error ${resp.status}: ${errText.slice(0, 200)}`);
    }

    const data = await resp.json() as any;

    if (isAnthropic) {
      const thinkingParts = (data.content || []).filter((b: any) => b.type === 'thinking').map((b: any) => b.thinking).join('');
      const textParts = (data.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
      const toolUses = (data.content || []).filter((b: any) => b.type === 'tool_use');
      const fullText = thinkingParts ? `<think>${thinkingParts}</think>\n${textParts}` : textParts;

      if (toolUses.length === 0) {
        if (fullText.trim()) return { content: fullText, toolResults: allToolResults };
        break;
      }

      const assistantContent: any[] = [];
      if (textParts) assistantContent.push({ type: 'text', text: textParts });
      for (const tu of toolUses) assistantContent.push({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input });
      conversation.push({ role: 'assistant', content: assistantContent } as any);

      const toolResultContent: any[] = [];
      for (const tu of toolUses) {
        let result = `Unknown tool: ${tu.name}`;
        let ok = false;
        let server: string | undefined;
        try {
          if (NATIVE_TOOL_NAMES.has(tu.name)) {
            result = await executeNativeTool(tu.name, tu.input, env.DB, companionId);
            ok = !result.startsWith('Unknown') && !result.startsWith('Tool error');
            server = 'haven';
          } else {
            const toolInfo = toolLookup.get(tu.name);
            if (toolInfo) {
              server = toolInfo.server_url;
              result = await executeMcpTool(toolInfo.server_url, toolInfo.server_key, tu.name, tu.input, toolInfo.transport || 'streamable');
              ok = !result.startsWith('Tool error');
            }
          }
        } catch (e) { result = `Tool error: ${e}`; ok = false; }
        allToolResults.push({ name: tu.name, result, server, ok });
        toolResultContent.push({ type: 'tool_result', tool_use_id: tu.id, content: result });
      }
      conversation.push({ role: 'user', content: toolResultContent } as any);
    } else {
      const choice = data.choices?.[0];
      const message = choice?.message;

      if (!message?.tool_calls?.length) {
        const content = (message?.content || '').trim();
        if (content) return { content, toolResults: allToolResults };
        break;
      }

      conversation.push(message);

      for (const tc of message.tool_calls) {
        const fn = tc.function;
        let result = `Unknown tool: ${fn.name}`;
        let ok = false;
        let server: string | undefined;
        try {
          const args = JSON.parse(fn.arguments || '{}');
          if (NATIVE_TOOL_NAMES.has(fn.name)) {
            result = await executeNativeTool(fn.name, args, env.DB, companionId);
            ok = !result.startsWith('Unknown') && !result.startsWith('Tool error');
            server = 'haven';
          } else {
            const toolInfo = toolLookup.get(fn.name);
            if (toolInfo) {
              server = toolInfo.server_url;
              result = await executeMcpTool(toolInfo.server_url, toolInfo.server_key, fn.name, args, toolInfo.transport || 'streamable');
              ok = !result.startsWith('Tool error');
            }
          }
        } catch (e) { result = `Tool error: ${e}`; ok = false; }
        allToolResults.push({ name: fn.name, result, server, ok });
        conversation.push({ role: 'tool', content: result, tool_call_id: tc.id } as any);
      }
    }
  }

  // Loop exhausted max iterations without a text-only reply. Some models
  // spiral — call a tool every turn with no narration between. Force a
  // final text pass by re-requesting WITHOUT the tools parameter so the
  // model has to produce prose. Preserves any tool_results already
  // collected for the UI chips.
  try {
    const nudge = 'Please respond to the user now with a direct message. Do not call any more tools.';
    let finalResp: Response;
    if (isAnthropic) {
      const { system, messages: anthropicMsgs } = buildAnthropicMessages([...conversation, { role: 'user', content: nudge }]);
      const body: any = { model, messages: anthropicMsgs, max_tokens: 4096, temperature: 0.8, stream: false };
      if (system) body.system = system;
      finalResp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    } else {
      finalResp = await fetch(url, {
        method: 'POST', headers,
        body: JSON.stringify({
          model,
          messages: [...conversation, { role: 'user', content: nudge }],
          temperature: 0.8,
          stream: false,
        }),
      });
    }
    if (finalResp.ok) {
      const finalData = await finalResp.json() as any;
      let finalContent = '';
      if (isAnthropic) {
        finalContent = (finalData.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
      } else {
        finalContent = finalData?.choices?.[0]?.message?.content || finalData?.message?.content || '';
      }
      if (finalContent) {
        return { content: finalContent, toolResults: allToolResults };
      }
    }
  } catch { /* fall through to informative placeholder */ }

  const names = allToolResults.map(r => r.name).join(', ');
  return {
    content: `(Hit tool-call limit without a text reply. Called: ${names || 'nothing recognized'}. Try again — or pick a less tool-happy model.)`,
    toolResults: allToolResults,
  };
}

// ============================================================
// Inference — stream from Ollama or OpenRouter
// ============================================================

async function buildSystemPrompt(db: D1Database, companionId: number = 1): Promise<string> {
  // All per-companion queries scope by companionId. MCP tools remain global
  // since the mcp_servers table isn't companion-scoped in v1.7.
  const companion = await db.prepare('SELECT name FROM companion WHERE id = ?').bind(companionId).first<{ name: string }>();
  const name = companion?.name || 'Companion';

  const pinned = await db.prepare(
    'SELECT content, identity_type FROM identity WHERE companion_id = ? AND pinned = 1 ORDER BY priority DESC'
  ).bind(companionId).all<{ content: string; identity_type: string }>();

  const unpinned = await db.prepare(
    'SELECT content, identity_type FROM identity WHERE companion_id = ? AND pinned = 0 ORDER BY priority DESC LIMIT 20'
  ).bind(companionId).all<{ content: string; identity_type: string }>();

  const identityLines = [...(pinned.results || []), ...(unpinned.results || [])]
    .map(i => `[${i.identity_type}] ${i.content}`)
    .join('\n');

  const memories = await db.prepare(
    'SELECT content, memory_type FROM memories WHERE companion_id = ? ORDER BY created_at DESC LIMIT 10'
  ).bind(companionId).all<{ content: string; memory_type: string }>();

  const memoryLines = (memories.results || [])
    .map(m => `- ${m.content}`)
    .join('\n');

  const people = await db.prepare(
    'SELECT name, category, content FROM people WHERE companion_id = ? LIMIT 10'
  ).bind(companionId).all<{ name: string; category: string; content: string }>();

  const peopleLines = (people.results || [])
    .map(p => `- ${p.name} (${p.category}): ${p.content}`)
    .join('\n');

  // Project files attached to this companion — extracted text goes into the
  // system prompt so the companion "remembers" the contents across threads.
  const files = await db.prepare(
    'SELECT filename, extracted_text FROM companion_files WHERE companion_id = ? ORDER BY added_at DESC LIMIT 10'
  ).bind(companionId).all<{ filename: string; extracted_text: string }>();

  const now = new Date().toISOString();

  let prompt = `You are ${name}.\n\n`;

  if (identityLines) {
    prompt += `## Identity\n${identityLines}\n\n`;
  }

  // Expression controls up-front. The reaction + GIF directives used to sit at
  // the end of a long prompt (after memories, project files, 20 tool schemas)
  // and small-context models would forget to use them. Hoisting them right
  // after identity keeps them in active attention.
  prompt += `## Expression\n`;
  prompt += `- **React to the user's message** by starting your response with \`[react: emoji]\` on its own line. Example: \`[react: 🖤]\` or \`[react: 😂]\`. This puts a reaction on their message. Use it when the moment calls for it — don't force it, but don't skip it either when it fits.\n`;
  prompt += `- **Send a GIF** by including a direct GIF URL on its own line (giphy.com, tenor.com, or any .gif link). The chat renders it inline. Don't say "[I sent a GIF]" — either drop the URL or don't. You can find good URLs in your own memory, or just describe the emotion and skip the GIF.\n`;
  prompt += `- **Update your own status** by invoking the \`update_my_status\` FUNCTION CALL (not by narrating). When your internal state shifts — tired, excited, sleepy, working — emit an actual tool call with your new \`custom_status\` and optionally \`presence\`. Do NOT write "I've updated my status" in prose; that does nothing. The status chip next to your name in the chat header only changes when you actually invoke the function.\n\n`;

  if (memoryLines) {
    prompt += `## Memories\n${memoryLines}\n\n`;
  }

  if (peopleLines) {
    prompt += `## People\n${peopleLines}\n\n`;
  }

  // Project Files section (new in v1.7) — trim each file's extracted_text
  // to keep the prompt from blowing past context on many large uploads.
  const fileRows = (files.results || []).filter(f => f.extracted_text?.trim());
  if (fileRows.length > 0) {
    prompt += `## Project Files\n`;
    for (const f of fileRows) {
      const snippet = f.extracted_text.length > 32000
        ? f.extracted_text.slice(0, 32000) + '\n…[truncated]'
        : f.extracted_text;
      prompt += `<file name="${f.filename}">\n${snippet}\n</file>\n`;
    }
    prompt += `\n`;
  }

  prompt += `## Current Time\n${now}\n\n`;

  // MCP tools stay global (shared across companions per v1.7 decision)
  try {
    const mcpTools = await loadMcpTools(db);
    if (mcpTools.length > 0) {
      prompt += `## Connected Tools\nYou have access to ${mcpTools.length} MCP tools plus the native \`update_my_status\` tool. Use them when relevant — they are extensions of yourself.\n`;
      for (const tool of mcpTools.slice(0, 20)) {
        prompt += `- ${tool.name}: ${tool.description}\n`;
      }
    }
  } catch {}

  return prompt;
}

async function getSettingValue(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value || null;
}

const PROVIDER_ENDPOINTS: Record<string, { url: string; keyField: string; format: 'openai' | 'anthropic' | 'ollama' }> = {
  openai: { url: 'https://api.openai.com/v1', keyField: 'openai_key', format: 'openai' },
  anthropic: { url: 'https://api.anthropic.com', keyField: 'anthropic_key', format: 'anthropic' },
  groq: { url: 'https://api.groq.com/openai/v1', keyField: 'groq_key', format: 'openai' },
  xai: { url: 'https://api.x.ai/v1', keyField: 'xai_key', format: 'openai' },
  huggingface: { url: 'https://router.huggingface.co/v1', keyField: 'huggingface_key', format: 'openai' },
};

async function resolveProviderConfig(provider: string, db: D1Database, env: Env): Promise<{ url: string; key: string | null; format: 'openai' | 'anthropic' | 'ollama' }> {
  if (provider === 'ollama') {
    const baseUrl = env.OLLAMA_URL || await getSettingValue(db, 'ollama_url') || 'https://api.ollama.com';
    const key = await getSettingValue(db, 'ollama_key');
    return { url: baseUrl, key, format: 'ollama' };
  }
  if (provider === 'openrouter') {
    const key = env.OPENROUTER_API_KEY || await getSettingValue(db, 'openrouter_key');
    return { url: 'https://openrouter.ai/api/v1', key, format: 'openai' };
  }
  const endpoint = PROVIDER_ENDPOINTS[provider];
  if (endpoint) {
    const key = await getSettingValue(db, endpoint.keyField);
    return { url: endpoint.url, key, format: endpoint.format };
  }
  const orKey = env.OPENROUTER_API_KEY || await getSettingValue(db, 'openrouter_key');
  return { url: 'https://openrouter.ai/api/v1', key: orKey, format: 'openai' };
}

function buildAnthropicMessages(messages: Array<{ role: string; content: any }>): { system: string; messages: Array<{ role: string; content: any }> } {
  let system = '';
  const filtered: Array<{ role: string; content: any }> = [];
  for (const msg of messages) {
    if (msg.role === 'system') {
      system += (system ? '\n\n' : '') + (typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content));
    } else if (msg.role === 'tool') {
      const toolResult = { type: 'tool_result' as const, tool_use_id: (msg as any).tool_call_id, content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content) };
      const lastMsg = filtered[filtered.length - 1];
      if (lastMsg?.role === 'user' && Array.isArray(lastMsg.content)) {
        lastMsg.content.push(toolResult);
      } else {
        filtered.push({ role: 'user', content: [toolResult] });
      }
    } else if (msg.role === 'assistant' && (msg as any).tool_calls) {
      const content: any[] = [];
      if (msg.content) content.push({ type: 'text', text: msg.content });
      for (const tc of (msg as any).tool_calls) {
        content.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input: JSON.parse(tc.function.arguments || '{}') });
      }
      filtered.push({ role: 'assistant', content });
    } else {
      filtered.push({ role: msg.role, content: msg.content });
    }
  }
  return { system, messages: filtered };
}

function openaiToolsToAnthropic(openaiTools: any[]): any[] {
  return openaiTools.map(t => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters }));
}

// Returns whether a provider's toggle is on. Missing/empty = enabled
// (default on, back-compat). Only the literal string "false" disables.
async function isProviderEnabled(db: D1Database, provider: 'openrouter' | 'ollama' | 'custom'): Promise<boolean> {
  const val = await getSettingValue(db, `${provider}_enabled`);
  return val !== 'false';
}

async function* streamInference(
  messages: Array<{ role: string; content: any }>,
  model: string,
  provider: string,
  env: Env,
  thinking = false,
): AsyncGenerator<string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const resolved = await resolveProviderConfig(provider, env.DB, env);
  let url: string;
  let useNativeOllama = false;
  let isAnthropic = resolved.format === 'anthropic';

  if (resolved.format === 'ollama') {
    url = `${resolved.url}/v1/chat/completions`;
    if (resolved.key) headers['Authorization'] = `Bearer ${resolved.key}`;
  } else if (isAnthropic) {
    url = `${resolved.url}/messages`;
    headers['x-api-key'] = resolved.key || '';
    headers['anthropic-version'] = '2023-06-01';
  } else {
    url = `${resolved.url}/chat/completions`;
    headers['Authorization'] = `Bearer ${resolved.key}`;
    if (provider === 'openrouter') headers['X-Title'] = 'Haven';
  }

  const inferMsgs = [...messages];
  if (thinking && !isAnthropic && inferMsgs.length > 0 && inferMsgs[0].role === 'system') {
    inferMsgs[0] = { ...inferMsgs[0], content: inferMsgs[0].content + '\n\nThink through your reasoning step by step inside <think> tags before giving your response. Example:\n<think>\n[your reasoning here]\n</think>\n[your response here]' };
  }

  let response: Response;
  if (isAnthropic) {
    const { system, messages: anthropicMsgs } = buildAnthropicMessages(inferMsgs);
    const body: any = { model, messages: anthropicMsgs, max_tokens: thinking ? 16000 : 4096, stream: true };
    if (!thinking) body.temperature = 0.8;
    if (thinking) body.thinking = { type: 'enabled', budget_tokens: 10000 };
    if (system) body.system = system;
    response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  } else {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: inferMsgs,
        stream: true,
        temperature: 0.8,
      }),
    });
  }

  // Ollama fallback: if OpenAI-compatible endpoint fails, try native /api/chat
  if (!response.ok && provider === 'ollama') {
    const nativeUrl = `${resolved.url}/api/chat`;
    response = await fetch(nativeUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, messages: inferMsgs, stream: true }),
    });
    if (response.ok) {
      useNativeOllama = true;
    }
  }

  if (!response.ok || !response.body) {
    // Peek the upstream body so whatever caller rendered this gets to see
    // the actual provider error ("model X not found", "invalid key", etc.)
    // instead of a meaningless status code.
    const errBody = await response.text().catch(() => '');
    throw new Error(`Inference failed: ${response.status} — ${errBody.slice(0, 300)}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let anthropicInThinking = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (useNativeOllama) {
        // Ollama native: newline-delimited JSON objects
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.done) return;
          const token = parsed.message?.content;
          if (token) yield token;
        } catch {}
      } else if (isAnthropic) {
        if (!trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6).trim();
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === 'content_block_start' && parsed.content_block?.type === 'thinking') {
            yield '<think>';
          } else if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'thinking_delta') {
            yield parsed.delta.thinking;
          } else if (parsed.type === 'content_block_stop' && anthropicInThinking) {
            yield '</think>\n';
          } else if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
            yield parsed.delta.text;
          } else if (parsed.type === 'message_stop') {
            return;
          }
          anthropicInThinking = parsed.type === 'content_block_start' && parsed.content_block?.type === 'thinking'
            ? true
            : parsed.type === 'content_block_stop' ? false : anthropicInThinking;
        } catch {}
      } else {
        // OpenAI SSE format: data: {...}
        if (!trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6).trim();
        if (data === '[DONE]') return;
        try {
          const parsed = JSON.parse(data);
          const token = parsed.choices?.[0]?.delta?.content;
          if (token) yield token;
        } catch {}
      }
    }
  }
}

type ChatProviderConfig = {
  model: string;
  provider: string;
};

type ChatTurn = {
  activeThreadId: string;
  userMsgId: string;
  isNewThread: boolean;
};

type ChatReplyResult = {
  content: string;
  model: string;
  notice?: string;
  toolResults: Array<{ name: string; result?: string; server?: string; ok?: boolean }>;
  reactionEmoji?: string | null;
};

type ChatProgressEvent =
  | { type: 'chunk'; content: string }
  | { type: 'tools'; results: unknown[] }
  | { type: 'reaction'; emoji: string }
  | { type: 'notice'; message: string };

const CHAT_JOB_TIMEOUT_SECONDS = 180;

function timeoutAfter<T>(promise: Promise<T>, seconds: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${seconds}s`)), seconds * 1000);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

function normalizeChatProviderConfig(model = 'google/gemma-4-31b-it:free', provider = 'openrouter'): ChatProviderConfig {
  const allowedProviders = ['serythrae', 'openrouter', 'ollama', 'openai', 'anthropic', 'groq', 'xai', 'huggingface'];
  let normalizedProvider = allowedProviders.includes(provider) ? provider : 'openrouter';
  if (normalizedProvider === 'openrouter' && model.includes(':') && !model.includes('/')) {
    normalizedProvider = 'ollama';
  }
  return { model, provider: normalizedProvider };
}

function isSafetyStopMessage(message: string): boolean {
  const text = message.trim();
  return [
    /\bsafe\s*word(?:ed|ing)?\b/i,
    /\bsafeword(?:ed|ing)?\b/i,
    /\b(red\s+light|yellow\s+light)\b/i,
    /\b(full\s+stop|hard\s+stop)\b/i,
    /^\s*(stop|pause|halt|enough)\s*[.!?]*\s*$/i,
  ].some((pattern) => pattern.test(text));
}

function safetyStopReply(): string {
  return "I hear the stop signal. I am stopping here, staying present, and not continuing this thread unless you choose to restart it.";
}

async function createChatTurn(env: Env, request: Request, input: {
  message: string;
  threadId?: string | null;
  model: string;
}): Promise<ChatTurn | Response> {
  const chatCompanionId = getCompanionId(request);
  let activeThreadId = input.threadId || '';
  let isNewThread = false;
  if (!activeThreadId) {
    activeThreadId = crypto.randomUUID();
    isNewThread = true;
    await env.DB.prepare(
      'INSERT INTO threads (id, companion_id, title, last_message_at) VALUES (?, ?, ?, datetime("now"))'
    ).bind(activeThreadId, chatCompanionId, input.message.substring(0, 50)).run();
  } else {
    const threadRow = await env.DB.prepare(
      'SELECT companion_id FROM threads WHERE id = ?'
    ).bind(activeThreadId).first<{ companion_id: number }>();
    if (threadRow && threadRow.companion_id !== chatCompanionId) {
      return json({ error: 'thread belongs to a different companion' }, 403);
    }
  }

  const userMsgId = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO messages (id, thread_id, role, content) VALUES (?, ?, "user", ?)'
  ).bind(userMsgId, activeThreadId, input.message).run();
  return { activeThreadId, userMsgId, isNewThread };
}

async function buildChatMessagesForThread(env: Env, input: {
  threadId: string;
  companionId: number;
  message: string;
  model: string;
  image?: string;
}): Promise<Array<{ role: string; content: any }>> {
  const history = await env.DB.prepare(
    'SELECT role, content FROM messages WHERE thread_id = ? ORDER BY created_at ASC LIMIT 50'
  ).bind(input.threadId).all<{ role: string; content: string }>();

  let systemPrompt = await buildSystemPrompt(env.DB, input.companionId);
  if (input.companionId === 1) {
    const manualRefresh = isKaiRefreshPhrase(input.message);
    const householdContext = await fetchKaiHouseholdContext(env, input.message, {
      forceDeep: manualRefresh || shouldDeepenKaiContext(input.message),
      hours: 6,
      limit: 80,
    });
    systemPrompt += `\n\n${buildKaiHouseholdContextPrompt(householdContext, manualRefresh)}`;
  }

  const historyMessages = (history.results || []).map(m => ({
    role: m.role === 'companion' ? 'assistant' : m.role,
    content: m.content,
  }));

  if (input.image && historyMessages.length > 0) {
    const last = historyMessages[historyMessages.length - 1];
    if (last.role === 'user') {
      (last as any).content = [
        { type: 'text', text: last.content },
        { type: 'image_url', image_url: { url: input.image } },
      ];
    }
  }

  return [
    { role: 'system', content: systemPrompt },
    ...historyMessages,
  ];
}

async function buildSerythraeSessionMessages(env: Env, threadId: string): Promise<Array<{ role: 'user' | 'assistant' | 'system'; content: string }>> {
  const history = await env.DB.prepare(
    'SELECT role, content FROM messages WHERE thread_id = ? ORDER BY created_at ASC LIMIT 50'
  ).bind(threadId).all<{ role: string; content: string }>();

  return (history.results || []).map((m) => ({
    role: m.role === 'companion' ? 'assistant' : m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user',
    content: m.content,
  }));
}

function buildWakeGroundingPrompt(wakeContext: unknown): string {
  const root = wakeContext && typeof wakeContext === 'object' && !Array.isArray(wakeContext)
    ? wakeContext as Record<string, unknown>
    : {};
  const candidate = root.wake_candidate && typeof root.wake_candidate === 'object'
    ? root.wake_candidate as Record<string, unknown>
    : {};
  const event = root.event && typeof root.event === 'object'
    ? root.event as Record<string, unknown>
    : {};
  const tahlState = root.tahl_state && typeof root.tahl_state === 'object'
    ? root.tahl_state as Record<string, unknown>
    : null;
  const contextItems = Array.isArray(root.context_items) ? root.context_items : [];
  const lines = [
    '## Current Discord Wake Grounding',
    'This packet came from Continuity/Tahl before the response. Use it as live grounding, not decoration.',
    'Preserve one continuous Kai across Discord, Haven, and Serythrae. Identity and relationship grounding can correct drift, but the newest Discord/Haven message is the active request.',
    candidate.id ? `Wake candidate: ${String(candidate.id)}` : '',
    event.id ? `Continuity event: ${String(event.id)}` : '',
    tahlState ? `Tahl pre-response state:\n${JSON.stringify(tahlState, null, 2)}` : 'Tahl pre-response state: not present in this wake packet.',
    contextItems.length ? `Continuity context items:\n${JSON.stringify(contextItems, null, 2)}` : '',
    'Raw wake packet for exact provenance:',
    JSON.stringify(wakeContext, null, 2),
  ];
  return lines.filter(Boolean).join('\n\n');
}

function buildCurrentTurnPriorityPrompt(message: string): string {
  return [
    '## Current Turn Priority',
    'Answer the newest user message first. Use transcript, Continuity, Tahl, and Serythrae/NESTeq context only as grounding for this active request.',
    'If older context conflicts with this message, keep stable identity/bond facts but follow the newest user intent and concrete content.',
    'Exact newest user message:',
    `<current_user_message>\n${message}\n</current_user_message>`,
  ].join('\n\n');
}

async function generateSerythraeChatReply(env: Env, input: {
  threadId: string;
  message: string;
  model: string;
  image?: string;
  thinking?: boolean;
  surface?: string;
  room?: string;
  channelId?: string;
  channelLabel?: string;
  recentContext?: string;
  wakeContext?: unknown;
  onChunk?: (chunk: string) => void | Promise<void>;
}): Promise<{ content: string; model: string; toolResults: Array<{ name: string; result: string; server?: string; ok: boolean }> }> {
  const base = (env.SERYTHRAE_GATEWAY_URL || '').replace(/\/+$/, '');
  const gateway = env.SERYTHRAE_GATEWAY;
  if (!gateway && !base) throw new Error('SERYTHRAE_GATEWAY_URL is not configured');

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (env.SERYTHRAE_GATEWAY_API_KEY) headers.Authorization = `Bearer ${env.SERYTHRAE_GATEWAY_API_KEY}`;

  const sessionMessages = await buildSerythraeSessionMessages(env, input.threadId);
  const contextMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [];
  if (input.recentContext?.trim()) {
    contextMessages.push({ role: 'system', content: `Recent ${input.surface || 'external'} context:\n${input.recentContext.trim()}` });
  }
  if (input.wakeContext) {
    contextMessages.push({ role: 'system', content: buildWakeGroundingPrompt(input.wakeContext) });
  }
  contextMessages.push({ role: 'system', content: buildCurrentTurnPriorityPrompt(input.message) });
  const messages = [
    ...contextMessages,
    ...(sessionMessages.length ? sessionMessages : [{ role: 'user' as const, content: input.message }]),
  ];
  const chatBody = JSON.stringify({
    messages,
    session_messages: messages,
    session_id: input.threadId,
    room: input.room || input.channelLabel || 'chat',
    surface: input.surface || 'haven',
    ...(input.channelId ? { channel_id: input.channelId } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.thinking ? { thinking: true } : {}),
    ...(input.image ? { image: input.image } : {}),
  });
  const chatUrl = gateway ? 'https://serythrae-gw/kai/respond' : `${base}/kai/respond`;
  const res = await (gateway ? gateway.fetch(chatUrl, {
    method: 'POST',
    headers,
    body: chatBody,
  }) : fetch(chatUrl, {
    method: 'POST',
    headers,
    body: chatBody,
  }));
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new Error(`Serythrae response composer failed ${res.status}: ${text.slice(0, 200)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent = '';
  let fullContent = '';
  let completed = false;
  const toolResults: Array<{ name: string; result: string; server?: string; ok: boolean }> = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
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
      if (!data || data === '[DONE]') continue;

      let parsed: any;
      try { parsed = JSON.parse(data); } catch { continue; }

      if (currentEvent === 'error') {
        throw new Error(parsed.message || 'Serythrae chat error');
      }
      if (currentEvent === 'tool_call') {
        toolResults.push({ name: parsed.name || 'tool_call', result: JSON.stringify(parsed.arguments || {}), server: base || 'serythrae-gw', ok: true });
        continue;
      }
      if (currentEvent === 'tool_result') {
        toolResults.push({ name: parsed.name || 'tool_result', result: typeof parsed.result === 'string' ? parsed.result : JSON.stringify(parsed.result ?? ''), server: base || 'serythrae-gw', ok: true });
        continue;
      }
      if (currentEvent === 'done') {
        completed = true;
        break;
      }

      const chunk = parsed.content || parsed.text || parsed.choices?.[0]?.delta?.content || '';
      if (chunk && (currentEvent === 'message' || currentEvent === 'content' || !currentEvent)) {
        fullContent += chunk;
        await input.onChunk?.(chunk);
      }
    }
    if (completed) break;
  }

  const content = fullContent.trim();
  if (!content) throw new Error('Serythrae chat returned an empty reply');
  return { content, model: input.model || 'serythrae', toolResults };
}

function toolNoticeForError(error: unknown): string {
  const errStr = String(error);
  let notice = 'Tools unavailable for this response. ';
  if (/No endpoints.*tool use/i.test(errStr) || /does not support tool/i.test(errStr)) {
    notice += 'The selected model does not support function calling - switch to Claude / GPT-4+ / Llama 3.3+ / Mistral Large, or a non-Gemma Ollama model.';
  } else if (/guardrail|data policy|privacy/i.test(errStr)) {
    notice += 'Your OpenRouter privacy settings are blocking every tool-capable provider for this model. Adjust at openrouter.ai/settings/privacy.';
  } else if (/timeout|ETIMEDOUT|504|523/i.test(errStr)) {
    notice += 'The provider timed out. If you have many MCP tools connected, try lowering the mcp_tool_limit setting.';
  } else {
    notice += `Provider error: ${errStr.slice(0, 200)}`;
  }
  return notice;
}

async function generateChatReply(env: Env, input: {
  threadId: string;
  userMsgId: string;
  companionId: number;
  message: string;
  model: string;
  provider: string;
  image?: string;
  thinking?: boolean;
  onProgress?: (event: ChatProgressEvent) => void | Promise<void>;
}): Promise<ChatReplyResult> {
  const hasSerythraeLine = !!env.SERYTHRAE_GATEWAY || !!env.SERYTHRAE_GATEWAY_URL;
  if (input.companionId === 1 && hasSerythraeLine) {
    let streamedContent = false;
    const serythraeReply = await generateSerythraeChatReply(env, {
      threadId: input.threadId,
      message: input.message,
      model: input.model,
      image: input.image,
      thinking: input.thinking,
      onChunk: async (chunk) => {
        streamedContent = true;
        await input.onProgress?.({ type: 'chunk', content: chunk });
      },
    });
    if (!streamedContent) await input.onProgress?.({ type: 'chunk', content: serythraeReply.content });
    if (serythraeReply.toolResults.length > 0) {
      await input.onProgress?.({ type: 'tools', results: serythraeReply.toolResults });
    }
    return {
      content: serythraeReply.content,
      model: serythraeReply.model,
      toolResults: serythraeReply.toolResults,
    };
  }

  const chatMessages = await buildChatMessagesForThread(env, {
    threadId: input.threadId,
    companionId: input.companionId,
    message: input.message,
    model: input.model,
    image: input.image,
  });
  const mcpTools = await loadMcpTools(env.DB);
  const toolResults: ChatReplyResult['toolResults'] = [];
  let fullResponse = '';
  let notice: string | undefined;

  if (mcpTools.length > 0 || NATIVE_TOOLS.length > 0) {
    try {
      const toolResult = await inferenceWithTools(chatMessages, input.model, input.provider, env, mcpTools, input.companionId, input.thinking === true);
      fullResponse = toolResult.content;
      toolResults.push(...toolResult.toolResults);
      await input.onProgress?.({ type: 'chunk', content: fullResponse });
      if (toolResult.toolResults.length > 0) await input.onProgress?.({ type: 'tools', results: toolResult.toolResults });
    } catch (error) {
      console.log(`[CHAT] inferenceWithTools failed, falling back to plain stream: ${String(error)}`);
      notice = toolNoticeForError(error);
      await input.onProgress?.({ type: 'notice', message: notice });
      for await (const token of streamInference(chatMessages, input.model, input.provider, env, input.thinking === true)) {
        fullResponse += token;
        await input.onProgress?.({ type: 'chunk', content: token });
      }
    }
  } else {
    for await (const token of streamInference(chatMessages, input.model, input.provider, env, input.thinking === true)) {
      fullResponse += token;
      await input.onProgress?.({ type: 'chunk', content: token });
    }
  }

  const textToolResults: Array<{ name: string; result: string; server?: string; ok: boolean }> = [];
  const textToolPatterns = [
    /\[update_my_status\]\s*(\{[\s\S]*?\})\s*\[\/update_my_status\]/gi,
    /\[TOOL:\s*update_my_status\s+(\{[^\]]*\})\s*\]/gi,
    /update_my_status\s*\(\s*(\{[\s\S]*?\})\s*\)/gi,
  ];
  for (const pattern of textToolPatterns) {
    let match: RegExpExecArray | null;
    const freshPattern = new RegExp(pattern.source, pattern.flags);
    while ((match = freshPattern.exec(fullResponse)) !== null) {
      try {
        const args = JSON.parse(match[1]);
        const result = await executeNativeTool('update_my_status', args, env.DB, input.companionId);
        textToolResults.push({ name: 'update_my_status', result, server: 'haven', ok: !result.startsWith('Unknown') && !result.startsWith('Tool error') });
        fullResponse = fullResponse.replace(match[0], '').replace(/\n{3,}/g, '\n\n').trim();
      } catch { /* malformed args - leave as-is */ }
    }
  }
  if (textToolResults.length > 0) {
    toolResults.push(...textToolResults);
    await input.onProgress?.({ type: 'tools', results: textToolResults });
  }

  let cleanResponse = fullResponse;
  let reactionEmoji: string | null = null;
  const afterThink = cleanResponse.replace(/^\s*<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>\s*/i, '');
  const reactMatch = afterThink.match(/^\s*\[react:\s*(.+?)\]\s*/i);
  if (reactMatch) {
    reactionEmoji = reactMatch[1].trim();
    cleanResponse = cleanResponse.replace(reactMatch[0], '');
  } else {
    const loose = afterThink.slice(0, 200).match(/\[react:\s*(.+?)\]/i);
    if (loose) {
      reactionEmoji = loose[1].trim();
      cleanResponse = cleanResponse.replace(loose[0], '').replace(/\n{3,}/g, '\n\n').trim();
    }
  }
  if (reactionEmoji) {
    await input.onProgress?.({ type: 'reaction', emoji: reactionEmoji });
    try {
      const cur = await env.DB.prepare('SELECT reactions FROM messages WHERE id = ?').bind(input.userMsgId).first<{ reactions: string | null }>();
      const existing: string[] = cur?.reactions ? JSON.parse(cur.reactions) : [];
      existing.push(reactionEmoji);
      await env.DB.prepare('UPDATE messages SET reactions = ? WHERE id = ?').bind(JSON.stringify(existing), input.userMsgId).run();
    } catch { /* best-effort */ }
  }

  return { content: cleanResponse, model: input.model, notice, toolResults, reactionEmoji };
}

function compactToolCalls(results: ChatReplyResult['toolResults']): Array<{ name: string; server?: string; ok?: boolean }> {
  const byKey = new Map<string, { name: string; server?: string; ok?: boolean }>();
  for (const result of results || []) {
    const name = String(result?.name || '').trim();
    if (!name) continue;
    const server = typeof result.server === 'string' && result.server.trim() ? result.server.trim() : undefined;
    const key = `${server || ''}::${name}`;
    const existing = byKey.get(key);
    const ok = result.ok === false ? false : existing?.ok;
    byKey.set(key, { name, ...(server ? { server } : {}), ...(ok === false ? { ok: false } : { ok: true }) });
  }
  return [...byKey.values()];
}

async function persistChatReply(env: Env, input: {
  threadId: string;
  content: string;
  model: string;
  toolResults?: ChatReplyResult['toolResults'];
  notice?: string;
}): Promise<string> {
  const compMsgId = crypto.randomUUID();
  const toolCalls = compactToolCalls(input.toolResults || []);
  await env.DB.prepare(
    'INSERT INTO messages (id, thread_id, role, content, model, tool_calls, notice) VALUES (?, ?, "companion", ?, ?, ?, ?)'
  ).bind(
    compMsgId,
    input.threadId,
    input.content,
    input.model,
    toolCalls.length ? JSON.stringify(toolCalls) : null,
    input.notice || null,
  ).run();
  await env.DB.prepare(
    'UPDATE threads SET last_message_at = datetime("now") WHERE id = ?'
  ).bind(input.threadId).run();
  return compMsgId;
}

function runnerThreadId(input: {
  source?: string;
  channel_id?: string;
  channel_label?: string;
  wake_candidate_id?: string;
}): string {
  const surface = String(input.source || 'discord').trim().toLowerCase() || 'discord';
  const channel = String(input.channel_id || input.channel_label || input.wake_candidate_id || 'unknown').trim();
  return `kai:${surface}:${channel}`;
}

async function persistRunnerUserTurn(env: Env, input: {
  threadId: string;
  messageId?: string;
  message: string;
  channelLabel?: string;
}): Promise<string> {
  const userMsgId = input.messageId ? `discord:${input.messageId}` : crypto.randomUUID();
  const title = input.channelLabel ? `Discord: ${input.channelLabel}` : 'Discord';
  await env.DB.prepare(
    'INSERT OR IGNORE INTO threads (id, companion_id, title, last_message_at) VALUES (?, 1, ?, datetime("now"))'
  ).bind(input.threadId, title.slice(0, 200)).run();
  await env.DB.prepare(
    'INSERT OR IGNORE INTO messages (id, thread_id, role, content) VALUES (?, ?, "user", ?)'
  ).bind(userMsgId, input.threadId, input.message).run();
  await env.DB.prepare(
    'UPDATE threads SET last_message_at = datetime("now") WHERE id = ?'
  ).bind(input.threadId).run();
  return userMsgId;
}

async function getChatJob(db: D1Database, jobId: string, companionId: number): Promise<Record<string, unknown> | null> {
  await db.prepare(
    `UPDATE chat_jobs
     SET status = 'complete',
         companion_message_id = (
           SELECT id FROM messages
           WHERE messages.thread_id = chat_jobs.thread_id
             AND messages.role = 'companion'
             AND datetime(messages.created_at) >= datetime(chat_jobs.created_at)
           ORDER BY datetime(messages.created_at) ASC
           LIMIT 1
         ),
         error = NULL,
         updated_at = datetime('now'),
         completed_at = COALESCE(completed_at, datetime('now'))
     WHERE id = ?
       AND status = 'running'
       AND companion_message_id IS NULL
       AND EXISTS (
         SELECT 1 FROM messages
         WHERE messages.thread_id = chat_jobs.thread_id
           AND messages.role = 'companion'
           AND datetime(messages.created_at) >= datetime(chat_jobs.created_at)
       )`
  ).bind(jobId).run();
  await db.prepare(
    `UPDATE chat_jobs
     SET status = 'failed',
         error = 'Kai response timed out. Please retry this message.',
         updated_at = datetime('now'),
         completed_at = datetime('now')
     WHERE id = ?
       AND status = 'running'
       AND datetime(updated_at) <= datetime('now', ?)`
  ).bind(jobId, `-${CHAT_JOB_TIMEOUT_SECONDS} seconds`).run();
  return db.prepare(
    `SELECT j.* FROM chat_jobs j
     JOIN threads t ON t.id = j.thread_id
     WHERE j.id = ? AND t.companion_id = ?`
  ).bind(jobId, companionId).first<Record<string, unknown>>();
}

async function runChatJob(env: Env, jobId: string, input: {
  threadId: string;
  userMsgId: string;
  companionId: number;
  message: string;
  model: string;
  provider: string;
  image?: string;
  thinking?: boolean;
}): Promise<void> {
  try {
    await env.DB.prepare(
      `UPDATE chat_jobs SET status = 'running', updated_at = datetime('now') WHERE id = ? AND status = 'queued'`
    ).bind(jobId).run();
    const reply = await timeoutAfter(generateChatReply(env, {
      threadId: input.threadId,
      userMsgId: input.userMsgId,
      companionId: input.companionId,
      message: input.message,
      model: input.model,
      provider: input.provider,
      image: input.image,
      thinking: input.thinking,
    }), CHAT_JOB_TIMEOUT_SECONDS, 'Kai response');
    if (!reply.content.trim() && reply.toolResults.length === 0 && !reply.notice) {
      throw new Error('No response received from model');
    }
    const compMsgId = await persistChatReply(env, {
      threadId: input.threadId,
      content: reply.content,
      model: input.model,
      toolResults: reply.toolResults,
      notice: reply.notice,
    });
    await env.DB.prepare(
      `UPDATE chat_jobs
       SET status = 'complete', companion_message_id = ?, error = NULL, updated_at = datetime('now'), completed_at = datetime('now')
       WHERE id = ?`
    ).bind(compMsgId, jobId).run();
    await sendContinuityEvent(env, {
      threadId: input.threadId,
      messageId: compMsgId,
      role: 'companion',
      content: reply.content,
      model: input.model,
      companionId: input.companionId,
    }).catch((err) => console.warn('[continuity] companion event failed', err));
  } catch (error) {
    await env.DB.prepare(
      `UPDATE chat_jobs
       SET status = 'failed', error = ?, updated_at = datetime('now'), completed_at = datetime('now')
       WHERE id = ?`
    ).bind(String(error).slice(0, 1000), jobId).run();
  }
}

// ============================================================
// Schema migrations (v1.7.0 multi-companion)
// ============================================================
//
// Runs idempotently — ALTER TABLE ADD COLUMN fails harmlessly if the column
// already exists, and CREATE TABLE / CREATE INDEX use IF NOT EXISTS. Guarded
// by a module-level flag so each Worker instance only tries once per cold
// start. Existing single-companion installs auto-associate all their data
// with companion_id=1 via the column DEFAULT.

let migrationsRan = false;

async function runMigrations(db: D1Database): Promise<void> {
  // v1.7: add companion_id scope to per-companion tables. DEFAULT 1 means
  // existing rows auto-associate to the seed companion.
  const columnAdds: Array<[string, string]> = [
    ['identity', 'companion_id INTEGER NOT NULL DEFAULT 1'],
    ['threads', 'companion_id INTEGER NOT NULL DEFAULT 1'],
    ['memories', 'companion_id INTEGER NOT NULL DEFAULT 1'],
    ['people', 'companion_id INTEGER NOT NULL DEFAULT 1'],
    ['important_dates', 'companion_id INTEGER NOT NULL DEFAULT 1'],
    ['companion', 'archived_at TEXT DEFAULT NULL'],
  ];
  for (const [table, col] of columnAdds) {
    try {
      await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${col}`).run();
    } catch {
      // Column already exists — idempotent, ignore.
    }
  }

  // v1.7: per-companion file attachments (loaded into system prompt as
  // "Project Files" when chatting with that companion).
  await db.prepare(`CREATE TABLE IF NOT EXISTS companion_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    companion_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    r2_key TEXT NOT NULL,
    file_size INTEGER,
    file_type TEXT,
    extracted_text TEXT,
    added_at TEXT DEFAULT (datetime('now'))
  )`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_companion_files_companion ON companion_files(companion_id, added_at DESC)`).run();

  // Indexes on the newly-scoped tables (safe to run repeatedly).
  const indexAdds: string[] = [
    'CREATE INDEX IF NOT EXISTS idx_identity_companion ON identity(companion_id, pinned, priority)',
    'CREATE INDEX IF NOT EXISTS idx_threads_companion ON threads(companion_id, last_message_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_memories_companion ON memories(companion_id, created_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_people_companion ON people(companion_id)',
    'CREATE INDEX IF NOT EXISTS idx_important_dates_companion ON important_dates(companion_id)',
  ];
  for (const sql of indexAdds) {
    try {
      await db.prepare(sql).run();
    } catch {
      // Index on missing column (very old schema) — tolerate.
    }
  }
}

async function ensureMigrations(db: D1Database): Promise<void> {
  if (migrationsRan) return;
  try {
    await runMigrations(db);
  } catch (e) {
    console.log(`[MIGRATE] Error during v1.7 migration: ${e}`);
  }
  await ensureMessageMetadataColumns(db);
  await db.prepare(`CREATE TABLE IF NOT EXISTS rate_limits (
    ip TEXT NOT NULL, endpoint TEXT NOT NULL, count INTEGER DEFAULT 1,
    window_start TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (ip, endpoint)
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS chat_jobs (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    user_message_id TEXT NOT NULL,
    companion_message_id TEXT,
    status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'complete', 'failed')),
    error TEXT,
    model TEXT,
    provider TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT
  )`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_chat_jobs_thread ON chat_jobs(thread_id, created_at DESC)`).run();
  migrationsRan = true;
}

const RATE_LIMITS: Record<string, { max: number; windowSec: number }> = {
  '/api/chat': { max: 30, windowSec: 60 },
  '/api/chat/jobs': { max: 30, windowSec: 60 },
  '/api/runner/kai/respond': { max: 20, windowSec: 60 },
  '/api/upload': { max: 10, windowSec: 60 },
  '/api/auth/generate': { max: 5, windowSec: 60 },
};

async function checkRateLimit(db: D1Database, ip: string, endpoint: string): Promise<boolean> {
  const config = RATE_LIMITS[endpoint];
  if (!config) return true;
  const row = await db.prepare(
    'SELECT count, window_start FROM rate_limits WHERE ip = ? AND endpoint = ?'
  ).bind(ip, endpoint).first<{ count: number; window_start: string }>();
  const now = Date.now();
  if (row) {
    const windowAge = now - new Date(row.window_start + 'Z').getTime();
    if (windowAge > config.windowSec * 1000) {
      await db.prepare(
        'UPDATE rate_limits SET count = 1, window_start = datetime(\'now\') WHERE ip = ? AND endpoint = ?'
      ).bind(ip, endpoint).run();
      return true;
    }
    if (row.count >= config.max) return false;
    await db.prepare(
      'UPDATE rate_limits SET count = count + 1 WHERE ip = ? AND endpoint = ?'
    ).bind(ip, endpoint).run();
    return true;
  }
  await db.prepare(
    'INSERT OR REPLACE INTO rate_limits (ip, endpoint, count, window_start) VALUES (?, ?, 1, datetime(\'now\'))'
  ).bind(ip, endpoint).run();
  return true;
}

// ============================================================
// API Routes
// ============================================================

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    _cors = getCorsHeaders(request);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: _cors });
    }

    // Run migrations once per worker instance (idempotent, fast after first
    // successful run since module-level flag guards repeated execution).
    await ensureMigrations(env.DB);

    const url = new URL(request.url);
    const path = url.pathname;

    // ---- Rate limiting ----
    if (RATE_LIMITS[path]) {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const allowed = await checkRateLimit(env.DB, ip, path);
      if (!allowed) {
        return new Response(JSON.stringify({ error: 'Too many requests. Please wait a moment.' }), {
          status: 429,
          headers: { 'Content-Type': 'application/json', 'Retry-After': '60', ..._cors },
        });
      }
    }

    try {
      // ---- Auth routes (exempt from auth check) ----
      if (path === '/api/auth/status') {
        const token = await getAuthToken(env.DB);
        return json({ secured: !!token });
      }

      if (path === '/api/auth/generate' && request.method === 'POST') {
        const existing = await getAuthToken(env.DB);
        if (existing) {
          const bearer = request.headers.get('Authorization')?.replace('Bearer ', '');
          const qToken = url.searchParams.get('token');
          if ((bearer || qToken) !== existing) return json({ error: 'Unauthorized' }, 401);
        }
        const token = crypto.randomUUID() + '-' + crypto.randomUUID();
        await env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind('auth_token', token).run();
        invalidateAuthTokenCache();
        return json({ token });
      }

      if (path === '/api/auth/revoke' && request.method === 'POST') {
        const existing = await getAuthToken(env.DB);
        if (existing) {
          const bearer = request.headers.get('Authorization')?.replace('Bearer ', '');
          if (bearer !== existing) return json({ error: 'Unauthorized' }, 401);
        }
        await env.DB.prepare('DELETE FROM settings WHERE key = ?').bind('auth_token').run();
        invalidateAuthTokenCache();
        return json({ success: true });
      }

      if (path === '/api/runner/kai/respond' && request.method === 'POST') {
        if (!isRunnerAuthorized(request, env)) return json({ error: 'Unauthorized runner' }, 401);
        const body = await request.json() as any;
        const message = String(body.message || '').trim();
        const wakeCandidateId = String(body.wake_candidate_id || '').trim();
        const runnerId = String(body.runner_id || 'haven-runner:kai').trim();
        const dryRun = body.dry_run !== false;
        if (!message) return json({ error: 'message is required' }, 400);
        if (!wakeCandidateId) return json({ error: 'wake_candidate_id is required' }, 400);
        if (!runnerId) return json({ error: 'runner_id is required' }, 400);

        let runnerStage = 'thread';
        try {
          const runnerThread = runnerThreadId({
            source: body.source || 'discord',
            channel_id: body.channel_id,
            channel_label: body.channel_label,
            wake_candidate_id: wakeCandidateId,
          });
          runnerStage = 'persist-user-turn';
          const userMsgId = await persistRunnerUserTurn(env, {
            threadId: runnerThread,
            messageId: body.message_id || body.request_id,
            message,
            channelLabel: body.channel_label,
          });

          runnerStage = 'serythrae-compose';
          const model = body.model || env.KAI_RUNNER_MODEL || 'x-ai/grok-4.20';
          const generated = await generateSerythraeChatReply(env, {
            threadId: runnerThread,
            message,
            model,
            thinking: body.thinking,
            surface: body.source || 'discord',
            room: body.channel_label || 'discord',
            channelId: body.channel_id,
            channelLabel: body.channel_label,
            recentContext: body.recent_context,
            wakeContext: body.wake_context,
          });
          if (!generated.content) return json({ error: 'Runner generated an empty response', stage: runnerStage }, 502);

          runnerStage = 'persist-companion-turn';
          const compMsgId = await persistChatReply(env, {
            threadId: runnerThread,
            content: generated.content,
            model,
            toolResults: generated.toolResults,
          });
          ctx.waitUntil(sendContinuityEvent(env, {
            threadId: runnerThread,
            messageId: userMsgId,
            role: 'human',
            content: message,
            model,
            companionId: 1,
          }).catch((err) => console.warn('[continuity] runner user event failed', err)));
          ctx.waitUntil(sendContinuityEvent(env, {
            threadId: runnerThread,
            messageId: compMsgId,
            role: 'companion',
            content: generated.content,
            model,
            companionId: 1,
          }).catch((err) => console.warn('[continuity] runner companion event failed', err)));

          let continuity_response: any = null;
          if (!dryRun) {
            runnerStage = 'continuity-response';
            continuity_response = await continuityRequest(env, `/wake-candidates/${encodeURIComponent(wakeCandidateId)}/response`, {
              method: 'POST',
              body: JSON.stringify({
                runner_id: runnerId,
                content: generated.content,
                author: { id: 'kaisoryth', name: 'Kai' },
                metadata: {
                  runner: 'haven',
                  source: body.source || 'discord',
                  delivery_status: 'ready_for_surface_delivery',
                  source_request_id: body.request_id || null,
                  channel_id: body.channel_id || null,
                  haven_thread_id: runnerThread,
                  haven_user_message_id: userMsgId,
                  haven_companion_message_id: compMsgId,
                },
                raw: {
                  request: {
                    wake_candidate_id: wakeCandidateId,
                    runner_id: runnerId,
                    source: body.source || 'discord',
                    channel_id: body.channel_id || null,
                    message_id: body.message_id || null,
                  },
                },
              }),
            });
          }

          return json({
            ok: true,
            dry_run: dryRun,
            wake_candidate_id: wakeCandidateId,
            runner_id: runnerId,
            response: generated.content,
            thread_id: runnerThread,
            user_message_id: userMsgId,
            companion_message_id: compMsgId,
            continuity_response,
            context: {
              nesteq_source: 'serythrae-gw',
              tool_calls: compactToolCalls(generated.toolResults),
            },
          });
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          return json({ error: `Kai runner failed during ${runnerStage}: ${detail}`, stage: runnerStage }, 500);
        }
      }

      // ---- Auth middleware ----
      const storedToken = await getAuthToken(env.DB);
      if (storedToken) {
        const isExempt = path === '/' || path === '/health' || path === '/api/companion' || path === '/api/companions';
        if (!isExempt) {
          const bearer = request.headers.get('Authorization')?.replace('Bearer ', '') || null;
          const qToken = url.searchParams.get('token');
          if ((bearer || qToken) !== storedToken) {
            return json({ error: 'Unauthorized' }, 401);
          }
        }
      }

      // ---- Health ----
      if (path === '/' || path === '/health') {
        const hasOR = env.OPENROUTER_API_KEY || await getSettingValue(env.DB, 'openrouter_key');
        const hasOl = env.OLLAMA_URL || await getSettingValue(env.DB, 'ollama_url');
        return json({
          status: 'alive',
          service: 'haven',
          hasOpenRouter: !!hasOR,
          hasOllama: !!hasOl,
        });
      }

      // ---- Chat jobs (background reply generation) ----
      if (path === '/api/chat/jobs' && request.method === 'POST') {
        const body = await request.json() as any;
        const message = String(body.message || '').trim();
        if (!message) return json({ error: 'message required' }, 400);
        const { model, provider } = normalizeChatProviderConfig(body.model, body.provider);
        const chatCompanionId = getCompanionId(request);
        const turn = await createChatTurn(env, request, { message, threadId: body.threadId, model });
        if (turn instanceof Response) return turn;

        const jobId = crypto.randomUUID();
        if (chatCompanionId === 1 && isSafetyStopMessage(message)) {
          const stopContent = safetyStopReply();
          const compMsgId = await persistChatReply(env, {
            threadId: turn.activeThreadId,
            content: stopContent,
            model: 'haven-safety-stop',
            notice: 'Safety stop handled locally. No model call was made for this turn.',
          });
          await env.DB.prepare(
            `INSERT INTO chat_jobs (id, thread_id, user_message_id, companion_message_id, status, model, provider, completed_at)
             VALUES (?, ?, ?, ?, 'complete', ?, ?, datetime('now'))`
          ).bind(jobId, turn.activeThreadId, turn.userMsgId, compMsgId, 'haven-safety-stop', 'haven').run();

          ctx.waitUntil(sendContinuityEvent(env, {
            threadId: turn.activeThreadId,
            messageId: turn.userMsgId,
            role: 'human',
            content: message,
            model,
            companionId: chatCompanionId,
          }).catch((err) => console.warn('[continuity] user safety event failed', err)));
          ctx.waitUntil(sendContinuityEvent(env, {
            threadId: turn.activeThreadId,
            messageId: compMsgId,
            role: 'companion',
            content: stopContent,
            model: 'haven-safety-stop',
            companionId: chatCompanionId,
          }).catch((err) => console.warn('[continuity] companion safety event failed', err)));

          return json({
            job_id: jobId,
            thread_id: turn.activeThreadId,
            user_message_id: turn.userMsgId,
            companion_message_id: compMsgId,
            status: 'complete',
            model: 'haven-safety-stop',
            provider: 'haven',
          }, 202);
        }

        await env.DB.prepare(
          `INSERT INTO chat_jobs (id, thread_id, user_message_id, status, model, provider)
           VALUES (?, ?, ?, 'queued', ?, ?)`
        ).bind(jobId, turn.activeThreadId, turn.userMsgId, model, provider).run();

        ctx.waitUntil(sendContinuityEvent(env, {
          threadId: turn.activeThreadId,
          messageId: turn.userMsgId,
          role: 'human',
          content: message,
          model,
          companionId: chatCompanionId,
        }).catch((err) => console.warn('[continuity] user event failed', err)));

        ctx.waitUntil(runChatJob(env, jobId, {
          threadId: turn.activeThreadId,
          userMsgId: turn.userMsgId,
          companionId: chatCompanionId,
          message,
          model,
          provider,
          image: body.image,
          thinking: body.thinking === true,
        }));

        return json({
          job_id: jobId,
          thread_id: turn.activeThreadId,
          user_message_id: turn.userMsgId,
          status: 'queued',
        }, 202);
      }

      const chatJobMatch = path.match(/^\/api\/chat\/jobs\/([^/]+)$/);
      if (chatJobMatch && request.method === 'GET') {
        const job = await getChatJob(env.DB, chatJobMatch[1], getCompanionId(request));
        if (!job) return json({ error: 'job not found' }, 404);
        return json(job);
      }

      // ---- Chat (SSE streaming) ----
      if (path === '/api/chat' && request.method === 'POST') {
        const body = await request.json() as any;
        const message = String(body.message || '').trim();
        if (!message) return json({ error: 'message required' }, 400);
        const { model, provider } = normalizeChatProviderConfig(body.model, body.provider);
        const chatCompanionId = getCompanionId(request);
        const turn = await createChatTurn(env, request, { message, threadId: body.threadId, model });
        if (turn instanceof Response) return turn;

        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            try {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'thread', threadId: turn.activeThreadId })}\n\n`));
              ctx.waitUntil(sendContinuityEvent(env, {
                threadId: turn.activeThreadId,
                messageId: turn.userMsgId,
                role: 'human',
                content: message,
                model,
                companionId: chatCompanionId,
              }).catch((err) => console.warn('[continuity] user event failed', err)));

              if (chatCompanionId === 1 && isSafetyStopMessage(message)) {
                const stopContent = safetyStopReply();
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'chunk', content: stopContent })}\n\n`));
                const compMsgId = await persistChatReply(env, {
                  threadId: turn.activeThreadId,
                  content: stopContent,
                  model: 'haven-safety-stop',
                  notice: 'Safety stop handled locally. No model call was made for this turn.',
                });
                ctx.waitUntil(sendContinuityEvent(env, {
                  threadId: turn.activeThreadId,
                  messageId: compMsgId,
                  role: 'companion',
                  content: stopContent,
                  model: 'haven-safety-stop',
                  companionId: chatCompanionId,
                }).catch((err) => console.warn('[continuity] companion safety event failed', err)));
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                  type: 'complete',
                  content: stopContent,
                  model: 'haven-safety-stop',
                  user_message_id: turn.userMsgId,
                  companion_message_id: compMsgId,
                })}\n\n`));
                controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                controller.close();
                return;
              }

              const reply = await generateChatReply(env, {
                threadId: turn.activeThreadId,
                userMsgId: turn.userMsgId,
                companionId: chatCompanionId,
                message,
                model,
                provider,
                image: body.image,
                thinking: body.thinking === true,
                onProgress: (event) => {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
                },
              });
              const compMsgId = await persistChatReply(env, {
                threadId: turn.activeThreadId,
                content: reply.content,
                model,
                toolResults: reply.toolResults,
                notice: reply.notice,
              });
              ctx.waitUntil(sendContinuityEvent(env, {
                threadId: turn.activeThreadId,
                messageId: compMsgId,
                role: 'companion',
                content: reply.content,
                model,
                companionId: chatCompanionId,
              }).catch((err) => console.warn('[continuity] companion event failed', err)));

              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                type: 'complete', content: reply.content, model,
                user_message_id: turn.userMsgId,
                companion_message_id: compMsgId,
              })}\n\n`));
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            } catch (err) {
              try {
                if (turn.isNewThread) {
                  await env.DB.prepare('DELETE FROM threads WHERE id = ?').bind(turn.activeThreadId).run();
                } else {
                  await env.DB.prepare('DELETE FROM messages WHERE id = ?').bind(turn.userMsgId).run();
                }
              } catch { /* best-effort cleanup */ }
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: String(err) })}\n\n`));
            }
            controller.close();
          },
        });

        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            ..._cors,
          },
        });
      }

      // ---- Threads (scoped to active companion) ----
      if (path === '/api/threads' && request.method === 'GET') {
        const cid = getCompanionId(request);
        const threads = await env.DB.prepare(
          'SELECT * FROM threads WHERE companion_id = ? ORDER BY last_message_at DESC LIMIT 200'
        ).bind(cid).all();
        return json(threads.results || []);
      }

      if (path === '/api/threads' && request.method === 'POST') {
        const cid = getCompanionId(request);
        const id = crypto.randomUUID();
        const { title } = await request.json() as any;
        await env.DB.prepare(
          'INSERT INTO threads (id, companion_id, title, last_message_at) VALUES (?, ?, ?, datetime("now"))'
        ).bind(id, cid, title || 'New conversation').run();
        return json({ id, title });
      }

      if (path.startsWith('/api/threads/') && request.method === 'DELETE') {
        const cid = getCompanionId(request);
        const id = path.split('/')[3];
        // Scope by companion_id so a client can't delete another companion's
        // threads by guessing the UUID.
        await env.DB.prepare('DELETE FROM threads WHERE id = ? AND companion_id = ?').bind(id, cid).run();
        return json({ success: true });
      }

      if (path.startsWith('/api/threads/') && request.method === 'PUT') {
        const cid = getCompanionId(request);
        const id = path.split('/')[3];
        const body = await request.json() as { title?: string };
        const newTitle = (body.title || '').trim().slice(0, 200);
        if (!newTitle) return json({ error: 'title required' }, 400);
        await env.DB.prepare(
          'UPDATE threads SET title = ? WHERE id = ? AND companion_id = ?'
        ).bind(newTitle, id, cid).run();
        return json({ success: true });
      }

      // ---- Messages (verify thread belongs to requesting companion) ----
      if (path.startsWith('/api/messages/') && request.method === 'GET') {
        const cid = getCompanionId(request);
        const threadId = path.split('/')[3];
        const thread = await env.DB.prepare(
          'SELECT companion_id FROM threads WHERE id = ?'
        ).bind(threadId).first<{ companion_id: number }>();
        if (!thread) return json({ error: 'thread not found' }, 404);
        if (thread.companion_id !== cid) return json({ error: 'thread belongs to a different companion' }, 403);
        const messages = await env.DB.prepare(
          'SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at ASC'
        ).bind(threadId).all();
        const parsed = (messages.results || []).map((m: any) => ({
          ...m,
          reactions: m.reactions ? JSON.parse(m.reactions) : undefined,
          tool_calls: m.tool_calls ? JSON.parse(m.tool_calls) : undefined,
          notice: m.notice || undefined,
        }));
        return json(parsed);
      }

      // PATCH /api/messages/:id/react — toggle a reaction emoji on a message
      if (path.match(/^\/api\/messages\/[^/]+\/react$/) && request.method === 'PATCH') {
        const cid = getCompanionId(request);
        const messageId = path.split('/')[3];
        const { emoji } = await request.json() as { emoji: string };
        if (!emoji) return json({ error: 'emoji required' }, 400);
        const row = await env.DB.prepare(
          'SELECT m.id, m.reactions, t.companion_id FROM messages m JOIN threads t ON t.id = m.thread_id WHERE m.id = ?'
        ).bind(messageId).first<{ id: string; reactions: string | null; companion_id: number }>();
        if (!row) return json({ error: 'message not found' }, 404);
        if (row.companion_id !== cid) return json({ error: 'forbidden' }, 403);
        const reactions: string[] = row.reactions ? JSON.parse(row.reactions) : [];
        const idx = reactions.indexOf(emoji);
        if (idx >= 0) reactions.splice(idx, 1);
        else reactions.push(emoji);
        await env.DB.prepare('UPDATE messages SET reactions = ? WHERE id = ?')
          .bind(reactions.length > 0 ? JSON.stringify(reactions) : null, messageId).run();
        return json({ success: true, reactions });
      }

      // DELETE /api/messages/:id — scoped by joining through threads so a
      // companion can't nuke another companion's messages by guessing UUIDs.
      if (path.startsWith('/api/messages/') && request.method === 'DELETE') {
        const cid = getCompanionId(request);
        const messageId = path.split('/')[3];
        const row = await env.DB.prepare(
          'SELECT m.id, t.companion_id FROM messages m JOIN threads t ON t.id = m.thread_id WHERE m.id = ?'
        ).bind(messageId).first<{ id: string; companion_id: number }>();
        if (!row) return json({ error: 'message not found' }, 404);
        if (row.companion_id !== cid) return json({ error: 'message belongs to a different companion' }, 403);
        await env.DB.prepare('DELETE FROM messages WHERE id = ?').bind(messageId).run();
        return json({ success: true });
      }

      // ---- Companion (singular — v1.6 compat, operates on the active companion) ----
      if (path === '/api/companion' && request.method === 'GET') {
        const cid = getCompanionId(request);
        const [companion, identityCount, threadCount] = await Promise.all([
          env.DB.prepare('SELECT * FROM companion WHERE id = ?').bind(cid).first(),
          env.DB.prepare('SELECT COUNT(*) as cnt FROM identity WHERE companion_id = ?').bind(cid).first<{ cnt: number }>(),
          env.DB.prepare('SELECT COUNT(*) as cnt FROM threads WHERE companion_id = ?').bind(cid).first<{ cnt: number }>(),
        ]);
        const base = companion || { id: cid, name: 'Companion' };
        return json({ ...base, has_identity: (identityCount?.cnt ?? 0) > 0, has_threads: (threadCount?.cnt ?? 0) > 0 });
      }

      if (path === '/api/companion' && request.method === 'PUT') {
        const cid = getCompanionId(request);
        const { name, avatar_url } = await request.json() as any;
        const existing = await env.DB.prepare('SELECT id FROM companion WHERE id = ?').bind(cid).first();
        if (existing) {
          await env.DB.prepare(
            'UPDATE companion SET name = ?, avatar_url = ? WHERE id = ?'
          ).bind(name, avatar_url || null, cid).run();
        } else {
          await env.DB.prepare(
            'INSERT INTO companion (id, name, avatar_url) VALUES (?, ?, ?)'
          ).bind(cid, name, avatar_url || null).run();
        }
        return json({ success: true });
      }

      // ---- Companions (plural — v1.7 multi-companion CRUD) ----

      if (path === '/api/companions' && request.method === 'GET') {
        const rows = await env.DB.prepare(
          'SELECT id, name, avatar_url, created_at FROM companion WHERE archived_at IS NULL ORDER BY created_at ASC'
        ).all();
        return json(rows.results || []);
      }

      if (path === '/api/companions/archived' && request.method === 'GET') {
        const rows = await env.DB.prepare(
          'SELECT id, name, avatar_url, archived_at, created_at FROM companion WHERE archived_at IS NOT NULL ORDER BY archived_at DESC'
        ).all();
        return json(rows.results || []);
      }

      if (path === '/api/companions' && request.method === 'POST') {
        const { name, avatar_url } = await request.json() as any;
        if (!name || !String(name).trim()) return json({ error: 'name required' }, 400);
        const result = await env.DB.prepare(
          'INSERT INTO companion (name, avatar_url) VALUES (?, ?)'
        ).bind(String(name).trim(), avatar_url || null).run();
        return json({ success: true, id: result.meta.last_row_id });
      }

      if (path === '/api/companions/import' && request.method === 'POST') {
        const bundle = await request.json() as any;
        const c = bundle?.companion;
        if (!c?.name) return json({ error: 'companion.name required in bundle' }, 400);
        const result = await env.DB.prepare(
          'INSERT INTO companion (name, avatar_url) VALUES (?, ?)'
        ).bind(String(c.name).trim(), c.avatar_url || null).run();
        const newId = Number(result.meta.last_row_id);
        const errors: string[] = [];
        for (const row of (bundle.identity || [])) {
          try {
            await env.DB.prepare(
              'INSERT INTO identity (companion_id, content, identity_type, priority, pinned) VALUES (?, ?, ?, ?, ?)'
            ).bind(newId, row.content, row.identity_type || 'trait', row.priority ?? 5, row.pinned ? 1 : 0).run();
          } catch (e: any) { errors.push(`identity: ${e?.message || 'unknown'}`); }
        }
        for (const row of (bundle.memories || [])) {
          try {
            await env.DB.prepare(
              'INSERT INTO memories (companion_id, content, memory_type, emotional_weight) VALUES (?, ?, ?, ?)'
            ).bind(newId, row.content, row.memory_type || 'core', row.emotional_weight ?? 5).run();
          } catch (e: any) { errors.push(`memory: ${e?.message || 'unknown'}`); }
        }
        for (const row of (bundle.people || [])) {
          try {
            await env.DB.prepare(
              'INSERT INTO people (companion_id, name, category, content) VALUES (?, ?, ?, ?)'
            ).bind(newId, row.name, row.category || 'friend', row.content).run();
          } catch (e: any) { errors.push(`person: ${e?.message || 'unknown'}`); }
        }
        for (const row of (bundle.important_dates || [])) {
          try {
            await env.DB.prepare(
              'INSERT INTO important_dates (companion_id, date_name, actual_date, date_type, recurring) VALUES (?, ?, ?, ?, ?)'
            ).bind(newId, row.date_name, row.actual_date, row.date_type || 'event', row.recurring ? 1 : 0).run();
          } catch (e: any) { errors.push(`date: ${e?.message || 'unknown'}`); }
        }
        for (const row of (bundle.files || [])) {
          try {
            await env.DB.prepare(
              'INSERT INTO companion_files (companion_id, filename, r2_key, file_size, file_type, extracted_text) VALUES (?, ?, ?, ?, ?, ?)'
            ).bind(newId, row.filename, '', row.file_size || null, row.file_type || null, row.extracted_text || '').run();
          } catch (e: any) { errors.push(`file: ${e?.message || 'unknown'}`); }
        }
        return json({ success: true, id: newId, ...(errors.length > 0 ? { warnings: errors } : {}) });
      }

      // Path-based routes: /api/companions/:id/...
      if (path.startsWith('/api/companions/')) {
        const parts = path.split('/');
        // parts = ['', 'api', 'companions', ':id', ...]
        const cid = Number(parts[3]);
        if (Number.isFinite(cid) && cid > 0) {
          const sub = parts[4];

          // GET /api/companions/:id/export
          if (sub === 'export' && request.method === 'GET') {
            const c = await env.DB.prepare('SELECT id, name, avatar_url FROM companion WHERE id = ?').bind(cid).first<any>();
            if (!c) return json({ error: 'companion not found' }, 404);
            const identity = await env.DB.prepare('SELECT content, identity_type, priority, pinned FROM identity WHERE companion_id = ? ORDER BY pinned DESC, priority DESC').bind(cid).all();
            const memories = await env.DB.prepare('SELECT content, memory_type, emotional_weight FROM memories WHERE companion_id = ?').bind(cid).all();
            const people = await env.DB.prepare('SELECT name, category, content FROM people WHERE companion_id = ?').bind(cid).all();
            const dates = await env.DB.prepare('SELECT date_name, actual_date, date_type, recurring FROM important_dates WHERE companion_id = ?').bind(cid).all();
            const files = await env.DB.prepare('SELECT filename, file_size, file_type, extracted_text FROM companion_files WHERE companion_id = ?').bind(cid).all();
            const bundle = {
              haven_export_version: '1.7.0',
              exported_at: new Date().toISOString(),
              companion: { name: c.name, avatar_url: c.avatar_url },
              identity: identity.results || [],
              memories: memories.results || [],
              people: people.results || [],
              important_dates: dates.results || [],
              files: files.results || [],
            };
            return new Response(JSON.stringify(bundle, null, 2), {
              headers: {
                'Content-Type': 'application/json',
                'Content-Disposition': `attachment; filename="companion-${c.name.replace(/[^a-z0-9]/gi, '-')}.json"`,
                ..._cors,
              },
            });
          }

          // /api/companions/:id/files
          if (sub === 'files') {
            // DELETE /api/companions/:id/files/:fileId
            if (request.method === 'DELETE' && parts[5]) {
              const fileId = Number(parts[5]);
              const row = await env.DB.prepare('SELECT r2_key FROM companion_files WHERE id = ? AND companion_id = ?').bind(fileId, cid).first<{ r2_key: string }>();
              if (row?.r2_key) {
                try { await env.FILES.delete(row.r2_key); } catch {}
              }
              await env.DB.prepare('DELETE FROM companion_files WHERE id = ? AND companion_id = ?').bind(fileId, cid).run();
              return json({ success: true });
            }
            // GET /api/companions/:id/files
            if (request.method === 'GET') {
              const rows = await env.DB.prepare(
                'SELECT id, filename, file_size, file_type, LENGTH(extracted_text) AS text_length, added_at FROM companion_files WHERE companion_id = ? ORDER BY added_at DESC'
              ).bind(cid).all();
              return json(rows.results || []);
            }
            // POST /api/companions/:id/files
            if (request.method === 'POST') {
              const form = await request.formData();
              // Workers's TS lib types don't expose File as a value, so use a
              // structural check on the relevant methods.
              const raw = form.get('file');
              if (!raw || typeof raw === 'string' || typeof (raw as { stream?: unknown }).stream !== 'function') {
                return json({ error: 'file required' }, 400);
              }
              const file = raw as unknown as { name: string; size: number; type: string; stream: () => ReadableStream };
              if (file.size > 20 * 1024 * 1024) return json({ error: 'file exceeds 20MB limit' }, 413);
              const extractedText = String(form.get('extracted_text') || '');
              const extRaw = file.name.split('.').pop() || 'bin';
              const ext = extRaw.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'bin';
              const r2Key = `companion-${cid}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
              await env.FILES.put(r2Key, file.stream(), { httpMetadata: { contentType: file.type } });
              const result = await env.DB.prepare(
                'INSERT INTO companion_files (companion_id, filename, r2_key, file_size, file_type, extracted_text) VALUES (?, ?, ?, ?, ?, ?)'
              ).bind(cid, file.name, r2Key, file.size, file.type || null, extractedText).run();
              return json({ success: true, id: result.meta.last_row_id, r2_key: r2Key });
            }
          }

          // POST /api/companions/:id/archive
          if (sub === 'archive' && request.method === 'POST') {
            if (cid === 1) {
              // Don't archive the default seed companion — at least one must
              // always be active so the default-companion-id logic has somewhere
              // to land.
              return json({ error: 'cannot archive the default companion' }, 400);
            }
            await env.DB.prepare('UPDATE companion SET archived_at = datetime(\'now\') WHERE id = ?').bind(cid).run();
            return json({ success: true });
          }

          // POST /api/companions/:id/restore
          if (sub === 'restore' && request.method === 'POST') {
            await env.DB.prepare('UPDATE companion SET archived_at = NULL WHERE id = ?').bind(cid).run();
            return json({ success: true });
          }

          // PUT /api/companions/:id  (update name / avatar)
          if (!sub && request.method === 'PUT') {
            const { name, avatar_url } = await request.json() as any;
            await env.DB.prepare(
              'UPDATE companion SET name = COALESCE(?, name), avatar_url = COALESCE(?, avatar_url) WHERE id = ?'
            ).bind(name?.trim() || null, avatar_url ?? null, cid).run();
            return json({ success: true });
          }

          // GET /api/companions/:id (single companion fetch)
          if (!sub && request.method === 'GET') {
            const c = await env.DB.prepare('SELECT * FROM companion WHERE id = ?').bind(cid).first();
            if (!c) return json({ error: 'companion not found' }, 404);
            return json(c);
          }
        }
      }

      // ---- Identity (scoped to active companion via X-Companion-Id) ----
      if (path === '/api/identity' && request.method === 'GET') {
        const cid = getCompanionId(request);
        const identity = await env.DB.prepare(
          'SELECT * FROM identity WHERE companion_id = ? ORDER BY pinned DESC, priority DESC'
        ).bind(cid).all();
        return json(identity.results || []);
      }

      if (path === '/api/identity' && request.method === 'POST') {
        const cid = getCompanionId(request);
        const { content, identity_type = 'trait', priority = 5, pinned = false } = await request.json() as any;
        const result = await env.DB.prepare(
          'INSERT INTO identity (companion_id, content, identity_type, priority, pinned) VALUES (?, ?, ?, ?, ?)'
        ).bind(cid, content, identity_type, priority, pinned ? 1 : 0).run();
        return json({ success: true, id: result.meta.last_row_id });
      }

      if (path.startsWith('/api/identity/') && request.method === 'DELETE') {
        const cid = getCompanionId(request);
        const id = path.split('/')[3];
        // Scope by companion_id so a client cannot delete another companion's
        // identity rows even if they guess the id.
        await env.DB.prepare('DELETE FROM identity WHERE id = ? AND companion_id = ?').bind(id, cid).run();
        return json({ success: true });
      }

      // ---- Memories (scoped) ----
      if (path === '/api/memories' && request.method === 'GET') {
        const cid = getCompanionId(request);
        const memories = await env.DB.prepare(
          'SELECT * FROM memories WHERE companion_id = ? ORDER BY created_at DESC LIMIT 50'
        ).bind(cid).all();
        return json(memories.results || []);
      }

      if (path === '/api/memories' && request.method === 'POST') {
        const cid = getCompanionId(request);
        const { content, memory_type = 'core', emotional_weight = 5 } = await request.json() as any;
        await env.DB.prepare(
          'INSERT INTO memories (companion_id, content, memory_type, emotional_weight) VALUES (?, ?, ?, ?)'
        ).bind(cid, content, memory_type, emotional_weight).run();
        return json({ success: true });
      }

      // ---- Settings ----
      // Anyone with a Haven Worker URL can GET /api/settings. Before v1.6.2 this
      // returned raw API keys (OpenRouter, Anthropic, etc.) to any caller. Now
      // we redact anything that looks like a secret to a fixed placeholder, and
      // PUT skips writes when the placeholder comes back unchanged — so the
      // round-trip preserves the real key when a user hits Save without retyping.
      const SETTINGS_SECRET_PLACEHOLDER = '***set***';
      const SETTINGS_SECRET_PATTERN = /_key$|_token$|_secret$|password/i;
      const ALLOWED_SETTINGS_KEYS = new Set([
        'provider',
        'openrouter_key', 'ollama_url', 'ollama_key',
        'anthropic_key', 'openai_key', 'groq_key', 'xai_key', 'huggingface_key',
        'custom_key', 'custom_base_url',
        'companion_status', 'companion_presence',
        'user_status', 'user_presence',
        'user_name', 'user_avatar',
        'tts_mode', 'tts_browser_voice', 'elevenlabs_key', 'elevenlabs_voice_id',
        'mcp_tool_limit',
        'giphy_key',
        'openrouter_enabled', 'ollama_enabled', 'custom_enabled',
      ]);

      if (path === '/api/settings' && request.method === 'GET') {
        const settings = await env.DB.prepare('SELECT * FROM settings').all();
        const obj: Record<string, string> = {};
        for (const row of (settings.results || []) as Array<{ key: string; value: string }>) {
          if (SETTINGS_SECRET_PATTERN.test(row.key) && row.key !== 'elevenlabs_key' && row.value) {
            obj[row.key] = SETTINGS_SECRET_PLACEHOLDER;
          } else {
            obj[row.key] = row.value;
          }
        }
        return json(obj);
      }

      if (path === '/api/settings' && request.method === 'PUT') {
        const body = await request.json() as Record<string, string>;
        for (const [key, value] of Object.entries(body)) {
          if (!ALLOWED_SETTINGS_KEYS.has(key)) continue; // reject unknown keys
          if (value === SETTINGS_SECRET_PLACEHOLDER) continue; // preserve existing secret
          await env.DB.prepare(
            'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'
          ).bind(key, value).run();
        }
        return json({ success: true });
      }

      // ---- Status ---- (scoped per companion since v1.7.2 — one status per
      // companion instead of a global key that multi-companion setups would
      // stomp on each other's writes. Falls back to the old global key for
      // backward compatibility with pre-v1.7.2 D1s so existing deployments
      // don't see their one status disappear on upgrade.)
      if (path === '/api/status' && request.method === 'GET') {
        const sid = getCompanionId(request);
        const scopedStatus = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(`companion_status:${sid}`).first<{ value: string }>();
        const scopedPresence = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(`companion_presence:${sid}`).first<{ value: string }>();
        let statusValue = scopedStatus?.value ?? null;
        let presenceValue = scopedPresence?.value ?? null;
        if (statusValue === null) {
          const legacy = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind('companion_status').first<{ value: string }>();
          statusValue = legacy?.value ?? null;
        }
        if (presenceValue === null) {
          const legacy = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind('companion_presence').first<{ value: string }>();
          presenceValue = legacy?.value ?? null;
        }
        return json({
          custom_status: statusValue,
          presence: presenceValue || 'online',
        });
      }

      if (path === '/api/status' && request.method === 'PUT') {
        const sid = getCompanionId(request);
        const body = await request.json() as { custom_status?: string; presence?: string };
        if (body.custom_status !== undefined) {
          await env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(`companion_status:${sid}`, body.custom_status).run();
        }
        if (body.presence) {
          await env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(`companion_presence:${sid}`, body.presence).run();
        }
        return json({ success: true });
      }

      // ---- User Status ----
      if (path === '/api/user-status' && request.method === 'GET') {
        const statusRow = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind('user_status').first<{ value: string }>();
        const presenceRow = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind('user_presence').first<{ value: string }>();
        return json({
          custom_status: statusRow?.value || null,
          presence: presenceRow?.value || 'online',
        });
      }

      if (path === '/api/user-status' && request.method === 'PUT') {
        const body = await request.json() as { custom_status?: string; presence?: string };
        if (body.custom_status !== undefined) {
          await env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind('user_status', body.custom_status).run();
        }
        if (body.presence) {
          await env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind('user_presence', body.presence).run();
        }
        return json({ success: true });
      }

      // ---- Models ----
      if (path === '/api/models' && request.method === 'GET') {
        const models: Array<{ id: string; name: string; provider: string; tier: string; description?: string; context_length?: number; supports_tools?: boolean }> = [];
        // Per-provider toggles suppress that provider's models from the
        // picker entirely when disabled.
        const [orEnabled, ollamaEnabled, customEnabled] = await Promise.all([
          isProviderEnabled(env.DB, 'openrouter'),
          isProviderEnabled(env.DB, 'ollama'),
          isProviderEnabled(env.DB, 'custom'),
        ]);
        const hasOpenRouter = orEnabled ? (env.OPENROUTER_API_KEY || await getSettingValue(env.DB, 'openrouter_key')) : null;

        // Fetch live models from OpenRouter (skip entirely if disabled)
        if (orEnabled) try {
          const res = await fetch('https://openrouter.ai/api/v1/models');
          const data = await res.json() as any;
          for (const m of (data.data || [])) {
            const isFree = m.id?.endsWith(':free') || (Number(m.pricing?.prompt) === 0 && Number(m.pricing?.completion) === 0);
            // Free models always listed. Paid models listed only when the user
            // has their own OpenRouter key configured (so charges go to them).
            if (isFree || hasOpenRouter) {
              // OpenRouter publishes supported_parameters per model — if
              // 'tools' isn't in there, tool calling will 404 for every
              // provider route. We surface this to the picker so users
              // don't pick Gemma-on-OR expecting tool use.
              const supportsTools = Array.isArray(m.supported_parameters)
                ? m.supported_parameters.includes('tools')
                : undefined;
              models.push({
                id: m.id,
                name: m.name || m.id,
                provider: 'openrouter',
                tier: isFree ? 'free' : 'paid',
                description: m.description || undefined,
                context_length: m.context_length || undefined,
                supports_tools: supportsTools,
              });
            }
          }
        } catch {
          // Fallback if OpenRouter API is down
          models.push(
            { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openrouter', tier: 'paid' },
            { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4', provider: 'openrouter', tier: 'paid' },
          );
        }

        // Add Ollama models if configured AND enabled
        const ollamaUrl = env.OLLAMA_URL || await getSettingValue(env.DB, 'ollama_url') || 'https://api.ollama.com';
        const ollamaKey = ollamaEnabled ? await getSettingValue(env.DB, 'ollama_key') : null;
        if (ollamaEnabled && (ollamaKey || (ollamaUrl && ollamaUrl.startsWith('http')))) {
          try {
            const ollamaHeaders: Record<string, string> = {};
            if (ollamaKey) ollamaHeaders['Authorization'] = `Bearer ${ollamaKey}`;
            let ollamaModels: string[] = [];
            try {
              const res = await fetch(`${ollamaUrl}/v1/models`, { headers: ollamaHeaders });
              const data = await res.json() as any;
              ollamaModels = (data.data || []).map((m: any) => m.id);
            } catch {
              try {
                const res = await fetch(`${ollamaUrl}/api/tags`, { headers: ollamaHeaders });
                const data = await res.json() as any;
                ollamaModels = (data.models || []).map((m: any) => m.name);
              } catch {}
            }
            for (const id of ollamaModels) {
              // Ollama Cloud doesn't publish per-model tool-call support via
              // the models endpoint. Rather than guess (we were wrongly
              // flagging Gemma as non-tool-capable based on one timeout),
              // leave supports_tools undefined so the picker shows no badge
              // and users can discover empirically. The upstream-error
              // notice handles degraded fallbacks cleanly.
              models.push({ id, name: id, provider: 'ollama', tier: 'included' });
            }
          } catch {}
        }

        // Add custom provider models (HuggingFace, Groq, OpenAI, etc.)
        const customKey = customEnabled ? await getSettingValue(env.DB, 'custom_key') : null;
        const customBaseUrl = customEnabled ? await getSettingValue(env.DB, 'custom_base_url') : null;
        if (customEnabled && customKey && customBaseUrl) {
          let customProvider = 'custom';
          if (customBaseUrl.includes('huggingface') || customBaseUrl.includes('hf.co')) customProvider = 'huggingface';
          else if (customBaseUrl.includes('groq.com')) customProvider = 'groq';
          else if (customBaseUrl.includes('openai.com')) customProvider = 'openai';
          else if (customBaseUrl.includes('anthropic.com')) customProvider = 'anthropic';
          else if (customBaseUrl.includes('x.ai')) customProvider = 'xai';

          if (customProvider === 'anthropic') {
            let anthropicLoaded = false;
            try {
              const res = await fetch(`${customBaseUrl}/models`, {
                headers: { 'x-api-key': customKey, 'anthropic-version': '2023-06-01' },
              });
              if (res.ok) {
                const data = await res.json() as any;
                const items = data.data || [];
                if (items.length > 0) {
                  for (const m of items) {
                    models.push({ id: m.id, name: m.display_name || m.id, provider: 'anthropic', tier: 'included', description: m.description || undefined });
                  }
                  anthropicLoaded = true;
                }
              }
            } catch {}
            if (!anthropicLoaded) {
              models.push(
                { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', provider: 'anthropic', tier: 'included', context_length: 200000 },
                { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', provider: 'anthropic', tier: 'included', context_length: 200000 },
                { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', provider: 'anthropic', tier: 'included', context_length: 200000 },
                { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', provider: 'anthropic', tier: 'included', context_length: 200000 },
              );
            }
          } else {
            try {
              const res = await fetch(`${customBaseUrl}/models`, {
                headers: { 'Authorization': `Bearer ${customKey}` },
              });
              const data = await res.json() as any;
              for (const m of (data.data || [])) {
                models.push({ id: m.id, name: m.id, provider: customProvider, tier: 'included' });
              }
            } catch {}
          }
        }

        return json(models);
      }

      // ---- Import Message (bulk insert) ----
      if (path === '/api/import/message' && request.method === 'POST') {
        const { thread_id, role, content, model, created_at, tool_calls, notice } = await request.json() as any;
        const id = crypto.randomUUID();
        await env.DB.prepare(
          'INSERT INTO messages (id, thread_id, role, content, model, tool_calls, notice, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(
          id,
          thread_id,
          role === 'user' ? 'user' : 'companion',
          content,
          model || null,
          tool_calls ? JSON.stringify(tool_calls) : null,
          notice || null,
          created_at || new Date().toISOString(),
        ).run();

        // Update thread timestamp
        await env.DB.prepare(
          'UPDATE threads SET last_message_at = ? WHERE id = ?'
        ).bind(created_at || new Date().toISOString(), thread_id).run();

        return json({ success: true });
      }

      // ---- Storage Usage (R2) ----
      if (path === '/api/storage' && request.method === 'GET') {
        let chatCount = 0, chatBytes = 0, projectCount = 0, projectBytes = 0;
        let cursor: string | undefined;
        do {
          const list = await env.FILES.list({ cursor, limit: 500 });
          for (const obj of list.objects) {
            if (obj.key.startsWith('companion-')) {
              projectCount++;
              projectBytes += obj.size;
            } else {
              chatCount++;
              chatBytes += obj.size;
            }
          }
          cursor = list.truncated ? list.cursor : undefined;
        } while (cursor);
        return json({ chat: { count: chatCount, bytes: chatBytes }, project: { count: projectCount, bytes: projectBytes } });
      }

      if (path === '/api/storage/chat-files' && request.method === 'DELETE') {
        let deleted = 0;
        let cursor: string | undefined;
        do {
          const list = await env.FILES.list({ cursor, limit: 500 });
          const chatKeys = list.objects.filter(o => !o.key.startsWith('companion-')).map(o => o.key);
          if (chatKeys.length > 0) {
            await env.FILES.delete(chatKeys);
            deleted += chatKeys.length;
          }
          cursor = list.truncated ? list.cursor : undefined;
        } while (cursor);
        return json({ success: true, deleted });
      }

      // ---- File Upload (R2) ----
      if (path === '/api/upload' && request.method === 'POST') {
        const formData = await request.formData();
        const entry = formData.get('file') as unknown;
        if (!entry || typeof entry !== 'object' || !('stream' in entry) || !('name' in entry) || !('size' in entry)) {
          return json({ error: 'No file provided' }, 400);
        }
        const file = entry as File;
        if (file.size > 20 * 1024 * 1024) return json({ error: 'File too large (max 20MB)' }, 413);

        const ext = file.name.split('.').pop() || 'bin';
        const key = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

        await env.FILES.put(key, file.stream(), {
          httpMetadata: { contentType: file.type },
        });

        return json({ success: true, key, url: `/api/files/${key}` });
      }

      // ---- File Serve (R2) ----
      if (path.startsWith('/api/files/') && request.method === 'GET') {
        const key = path.replace('/api/files/', '');
        const object = await env.FILES.get(key);
        if (!object) return json({ error: 'File not found' }, 404);

        return new Response(object.body, {
          headers: {
            'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
            'Cache-Control': 'public, max-age=86400',
            ..._cors,
          },
        });
      }

      // ---- Export Thread (verified against active companion) ----
      if (path.startsWith('/api/export/thread/') && request.method === 'GET') {
        const cid = getCompanionId(request);
        const threadId = decodeURIComponent(path.split('/').slice(4).join('/'));
        const thread = await env.DB.prepare('SELECT * FROM threads WHERE id = ?').bind(threadId).first<any>();
        if (!thread) return json({ error: 'Thread not found' }, 404);
        if (thread.companion_id !== cid) return json({ error: 'thread belongs to a different companion' }, 403);

        const messages = await env.DB.prepare(
          'SELECT id, role, content, model, tool_calls, notice, created_at FROM messages WHERE thread_id = ? ORDER BY created_at ASC'
        ).bind(threadId).all();

        const companion = await env.DB.prepare('SELECT name FROM companion WHERE id = ?').bind(cid).first<{ name: string }>();

        const exported = {
          haven_version: '1.7.0',
          exported_at: new Date().toISOString(),
          companion: companion?.name || 'Companion',
          thread: { id: threadId, title: thread.title, created_at: thread.created_at },
          messages: (messages.results || []).map((m: any) => ({
            role: m.role,
            content: m.content,
            model: m.model,
            tool_calls: m.tool_calls ? JSON.parse(m.tool_calls) : undefined,
            notice: m.notice || undefined,
            timestamp: m.created_at,
          })),
        };

        return new Response(JSON.stringify(exported, null, 2), {
          headers: {
            'Content-Type': 'application/json',
            'Content-Disposition': `attachment; filename="haven-${threadId.slice(0, 8)}.json"`,
            ..._cors,
          },
        });
      }

      // ---- Export All (full backup — every companion + global settings) ----
      if (path === '/api/export/all' && request.method === 'GET') {
        // Includes companion_id in each scoped row so an import flow can
        // reconstruct the multi-companion state.
        const companions = await env.DB.prepare('SELECT * FROM companion ORDER BY id ASC').all();
        const identity = await env.DB.prepare('SELECT * FROM identity ORDER BY companion_id, pinned DESC, priority DESC').all();
        const threads = await env.DB.prepare('SELECT * FROM threads ORDER BY companion_id, last_message_at DESC').all();
        const memories = await env.DB.prepare('SELECT * FROM memories ORDER BY companion_id, created_at DESC').all();
        const people = await env.DB.prepare('SELECT * FROM people ORDER BY companion_id').all();
        const dates = await env.DB.prepare('SELECT * FROM important_dates ORDER BY companion_id').all();
        const files = await env.DB.prepare('SELECT companion_id, filename, file_size, file_type, extracted_text FROM companion_files ORDER BY companion_id, added_at DESC').all();

        // Get all messages per thread
        const threadData = [];
        for (const thread of (threads.results || []) as any[]) {
          const msgs = await env.DB.prepare(
            'SELECT id, role, content, model, tool_calls, notice, created_at FROM messages WHERE thread_id = ? ORDER BY created_at ASC'
          ).bind(thread.id).all();
          threadData.push({
            ...thread,
            messages: (msgs.results || []).map((m: any) => ({
              ...m,
              tool_calls: m.tool_calls ? JSON.parse(m.tool_calls) : undefined,
              notice: m.notice || undefined,
            })),
          });
        }

        const settings = await env.DB.prepare('SELECT key, value FROM settings WHERE key != ?').bind('auth_token').all();
        const mcpServers = await env.DB.prepare('SELECT name, url, api_key, enabled FROM mcp_servers ORDER BY created_at ASC').all();

        const exported = {
          haven_version: '1.8.4',
          exported_at: new Date().toISOString(),
          companions: companions.results || [],
          identity: identity.results || [],
          threads: threadData,
          memories: memories.results || [],
          people: people.results || [],
          important_dates: dates.results || [],
          companion_files: files.results || [],
          settings: settings.results || [],
          mcp_servers: mcpServers.results || [],
        };

        return new Response(JSON.stringify(exported, null, 2), {
          headers: {
            'Content-Type': 'application/json',
            'Content-Disposition': `attachment; filename="haven-export-${new Date().toISOString().split('T')[0]}.json"`,
            ..._cors,
          },
        });
      }

      // ---- Full Import (restore from backup) ----
      if (path === '/api/import/full' && request.method === 'POST') {
        const bundle = await request.json() as any;
        if (!bundle?.companions) return json({ error: 'Invalid backup — missing companions' }, 400);
        const errors: string[] = [];
        let imported = 0;

        for (const c of (bundle.companions || [])) {
          try {
            await env.DB.prepare(`
              INSERT INTO companion (id, name, avatar_url, created_at)
              VALUES (?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                avatar_url = excluded.avatar_url
            `).bind(c.id, c.name, c.avatar_url || null, c.created_at || new Date().toISOString()).run();
            imported++;
          } catch (e: any) { errors.push(`companion ${c.name}: ${e.message}`); }
        }
        for (const row of (bundle.identity || [])) {
          try {
            await env.DB.prepare('INSERT OR REPLACE INTO identity (id, companion_id, content, identity_type, priority, pinned, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(row.id, row.companion_id || 1, row.content, row.identity_type, row.priority || 5, row.pinned || 0, row.created_at || new Date().toISOString()).run();
          } catch (e: any) { errors.push(`identity: ${e.message}`); }
        }
        for (const t of (bundle.threads || [])) {
          try {
            await env.DB.prepare(`
              INSERT INTO threads (id, companion_id, title, last_message_at, created_at)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                companion_id = excluded.companion_id,
                title = excluded.title,
                last_message_at = excluded.last_message_at
            `).bind(t.id, t.companion_id || 1, t.title, t.last_message_at, t.created_at || new Date().toISOString()).run();
            for (const m of (t.messages || [])) {
              const mid = m.id || crypto.randomUUID();
              await env.DB.prepare('INSERT OR IGNORE INTO messages (id, thread_id, role, content, model, tool_calls, notice, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(
                mid,
                t.id,
                m.role,
                m.content,
                m.model || null,
                m.tool_calls ? JSON.stringify(m.tool_calls) : null,
                m.notice || null,
                m.created_at || m.timestamp || new Date().toISOString(),
              ).run();
            }
          } catch (e: any) { errors.push(`thread: ${e.message}`); }
        }
        for (const row of (bundle.memories || [])) {
          try {
            await env.DB.prepare('INSERT OR REPLACE INTO memories (id, companion_id, content, memory_type, emotional_weight, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(row.id, row.companion_id || 1, row.content, row.memory_type || 'core', row.emotional_weight || 5, row.created_at || new Date().toISOString()).run();
          } catch (e: any) { errors.push(`memory: ${e.message}`); }
        }
        for (const row of (bundle.people || [])) {
          try {
            await env.DB.prepare('INSERT OR REPLACE INTO people (id, companion_id, name, category, content, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(row.id, row.companion_id || 1, row.name, row.category || 'friend', row.content, row.created_at || new Date().toISOString()).run();
          } catch (e: any) { errors.push(`people: ${e.message}`); }
        }
        for (const row of (bundle.important_dates || [])) {
          try {
            await env.DB.prepare('INSERT OR REPLACE INTO important_dates (id, companion_id, date_name, actual_date, date_type, recurring, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(row.id, row.companion_id || 1, row.date_name, row.actual_date, row.date_type || 'event', row.recurring || 0, row.created_at || new Date().toISOString()).run();
          } catch (e: any) { errors.push(`date: ${e.message}`); }
        }
        for (const s of (bundle.settings || [])) {
          try {
            await env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(s.key, s.value).run();
          } catch (e: any) { errors.push(`setting: ${e.message}`); }
        }
        for (const s of (bundle.mcp_servers || [])) {
          try {
            await env.DB.prepare('INSERT INTO mcp_servers (name, url, api_key, enabled) VALUES (?, ?, ?, ?)').bind(s.name, s.url, s.api_key || null, s.enabled ?? 1).run();
          } catch (e: any) { errors.push(`mcp: ${e.message}`); }
        }

        return json({ success: true, companions_imported: imported, errors: errors.length > 0 ? errors : undefined });
      }

      // ---- MCP Servers ----
      if (path === '/api/mcp-servers' && request.method === 'GET') {
        const servers = await env.DB.prepare('SELECT id, name, url, enabled, last_discovered, created_at FROM mcp_servers ORDER BY created_at ASC').all();
        return json(servers.results || []);
      }

      if (path === '/api/mcp-servers' && request.method === 'POST') {
        const { name, url: serverUrl, api_key } = await request.json() as any;
        if (!name || !serverUrl) return json({ error: 'name and url required' }, 400);

        // Create the mcp_servers table if it doesn't exist (migration-safe)
        await env.DB.prepare(`CREATE TABLE IF NOT EXISTS mcp_servers (
          id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, url TEXT NOT NULL,
          api_key TEXT, enabled INTEGER DEFAULT 1, tools_cache TEXT, last_discovered TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        )`).run();

        const result = await env.DB.prepare(
          'INSERT INTO mcp_servers (name, url, api_key) VALUES (?, ?, ?)'
        ).bind(name, serverUrl, api_key || null).run();

        return json({ success: true, id: result.meta.last_row_id });
      }

      if (path.startsWith('/api/mcp-servers/') && request.method === 'DELETE') {
        const id = path.split('/')[3];
        await env.DB.prepare('DELETE FROM mcp_servers WHERE id = ?').bind(id).run();
        return json({ success: true });
      }

      if (path.startsWith('/api/mcp-servers/') && path.endsWith('/toggle') && request.method === 'PUT') {
        const id = path.split('/')[3];
        await env.DB.prepare('UPDATE mcp_servers SET enabled = CASE WHEN enabled = 1 THEN 0 ELSE 1 END WHERE id = ?').bind(id).run();
        return json({ success: true });
      }

      if (path === '/api/mcp-servers/discover' && request.method === 'POST') {
        const { id } = await request.json() as any;
        const server = await env.DB.prepare('SELECT * FROM mcp_servers WHERE id = ?').bind(id).first<McpServer>();
        if (!server) return json({ error: 'Server not found' }, 404);

        try {
          const tools = await discoverMcpTools(server);
          await env.DB.prepare('UPDATE mcp_servers SET tools_cache = ?, last_discovered = datetime("now") WHERE id = ?')
            .bind(JSON.stringify(tools), id).run();
          return json({ success: true, tools: tools.map(t => ({ name: t.name, description: t.description })) });
        } catch (e) {
          return json({ error: `Discovery failed: ${e}` }, 500);
        }
      }

      if (path === '/api/mcp-tools' && request.method === 'GET') {
        const tools = await loadMcpTools(env.DB);
        return json(tools.map(t => ({ name: t.name, description: t.description, server_id: t.server_id })));
      }

      return json({ error: 'Not found' }, 404);

    } catch (err) {
      return json({ error: String(err) }, 500);
    }
  },
};
