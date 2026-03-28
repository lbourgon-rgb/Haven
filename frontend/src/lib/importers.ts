/**
 * Haven — Chat Import Parsers
 * Converts exports from ChatGPT, Claude, and SillyTavern into Haven format
 */

export interface ImportedThread {
  title: string;
  messages: Array<{
    role: 'user' | 'companion';
    content: string;
    timestamp?: string;
    model?: string;
  }>;
}

export interface ImportedIdentity {
  name?: string;
  description?: string;
  personality?: string;
  scenario?: string;
  firstMessage?: string;
  appearance?: string;
  systemPrompt?: string;
}

export interface ImportResult {
  source: 'chatgpt' | 'claude' | 'sillytavern' | 'haven' | 'unknown';
  threads: ImportedThread[];
  identity?: ImportedIdentity;
  errors: string[];
}

// ============================================================
// ChatGPT — conversations.json
// ============================================================

export function parseChatGPT(data: any): ImportResult {
  const errors: string[] = [];
  const threads: ImportedThread[] = [];

  // Can be array of conversations or single conversation
  const conversations = Array.isArray(data) ? data : [data];

  for (const conv of conversations) {
    try {
      if (!conv.mapping) {
        errors.push(`Skipped conversation "${conv.title || 'untitled'}": no mapping found`);
        continue;
      }

      const messages: ImportedThread['messages'] = [];

      // Linearize the tree: find root, follow children
      const nodes = conv.mapping;
      let currentId = Object.keys(nodes).find(id => !nodes[id].parent);

      // Walk the tree depth-first, following first child
      const visited = new Set<string>();
      const queue = currentId ? [currentId] : [];

      while (queue.length > 0) {
        const nodeId = queue.shift()!;
        if (visited.has(nodeId)) continue;
        visited.add(nodeId);

        const node = nodes[nodeId];
        if (node?.message?.content?.parts) {
          const role = node.message.author?.role;
          const content = node.message.content.parts
            .filter((p: any) => typeof p === 'string')
            .join('\n');

          if (content.trim() && (role === 'user' || role === 'assistant')) {
            const timestamp = node.message.create_time
              ? new Date(node.message.create_time * 1000).toISOString()
              : undefined;

            messages.push({
              role: role === 'assistant' ? 'companion' : 'user',
              content: content.trim(),
              timestamp,
              model: node.message.metadata?.model_slug,
            });
          }
        }

        // Add children to queue
        if (node?.children) {
          queue.push(...node.children);
        }
      }

      if (messages.length > 0) {
        threads.push({
          title: conv.title || 'Imported conversation',
          messages,
        });
      }
    } catch (e) {
      errors.push(`Failed to parse conversation: ${(e as Error).message}`);
    }
  }

  return { source: 'chatgpt', threads, errors };
}

// ============================================================
// Claude — claude-export format
// ============================================================

export function parseClaude(data: any): ImportResult {
  const errors: string[] = [];
  const threads: ImportedThread[] = [];

  try {
    const title = data.meta?.title || data.title || 'Imported from Claude';
    const chats = data.chats || data.messages || [];
    const messages: ImportedThread['messages'] = [];

    for (const chat of chats) {
      const role = chat.type === 'prompt' || chat.role === 'user' ? 'user' : 'companion';

      let content = '';
      if (Array.isArray(chat.message)) {
        // claude-export format: message is array of content blocks
        content = chat.message
          .map((block: any) => {
            if (block.type === 'pre' || block.type === 'code') {
              return '```' + (block.language || '') + '\n' + block.data + '\n```';
            }
            return block.data || block.text || '';
          })
          .join('\n\n');
      } else if (typeof chat.message === 'string') {
        content = chat.message;
      } else if (typeof chat.content === 'string') {
        content = chat.content;
      }

      if (content.trim()) {
        messages.push({
          role,
          content: content.trim(),
          timestamp: chat.timestamp || chat.created_at,
        });
      }
    }

    if (messages.length > 0) {
      threads.push({ title, messages });
    }
  } catch (e) {
    errors.push(`Failed to parse Claude export: ${(e as Error).message}`);
  }

  return { source: 'claude', threads, errors };
}

// ============================================================
// SillyTavern — Character Card V2/V3
// ============================================================

export function parseSillyTavern(data: any): ImportResult {
  const errors: string[] = [];
  const threads: ImportedThread[] = [];

  // Handle V2/V3 wrapper
  const card = data.data || data;

  const identity: ImportedIdentity = {
    name: card.name,
    description: card.description,
    personality: card.personality,
    scenario: card.scenario,
    firstMessage: card.first_mes,
    appearance: card.description, // SillyTavern puts appearance in description
    systemPrompt: card.system_prompt,
  };

  // Create a thread from the first message if it exists
  if (card.first_mes) {
    threads.push({
      title: `First meeting with ${card.name || 'companion'}`,
      messages: [{
        role: 'companion',
        content: card.first_mes,
      }],
    });
  }

  // Parse example messages if they exist
  if (card.mes_example) {
    const exampleMessages: ImportedThread['messages'] = [];
    const lines = card.mes_example.split('\n');
    for (const line of lines) {
      const userMatch = line.match(/^<START>\s*$/i);
      if (userMatch) continue;

      const charMatch = line.match(/^{{char}}:\s*(.+)/i);
      const humanMatch = line.match(/^{{user}}:\s*(.+)/i);

      if (charMatch) {
        exampleMessages.push({ role: 'companion', content: charMatch[1].trim() });
      } else if (humanMatch) {
        exampleMessages.push({ role: 'user', content: humanMatch[1].trim() });
      }
    }

    if (exampleMessages.length > 0) {
      threads.push({
        title: 'Example conversation',
        messages: exampleMessages,
      });
    }
  }

  return { source: 'sillytavern', threads, identity, errors };
}

// ============================================================
// Haven — re-import from Haven export
// ============================================================

export function parseHaven(data: any): ImportResult {
  const errors: string[] = [];
  const threads: ImportedThread[] = [];

  if (!data.haven_version) {
    errors.push('Not a Haven export file');
    return { source: 'unknown', threads, errors };
  }

  for (const thread of (data.threads || [])) {
    threads.push({
      title: thread.title || 'Imported thread',
      messages: (thread.messages || []).map((m: any) => ({
        role: m.role === 'user' ? 'user' as const : 'companion' as const,
        content: m.content,
        timestamp: m.created_at || m.timestamp,
        model: m.model,
      })),
    });
  }

  const identity: ImportedIdentity | undefined = data.identity?.length > 0
    ? { description: data.identity.map((i: any) => i.content).join('\n\n') }
    : undefined;

  return { source: 'haven', threads, identity, errors };
}

// ============================================================
// Auto-detect format and parse
// ============================================================

export function autoDetectAndParse(data: any): ImportResult {
  // Haven export
  if (data.haven_version) {
    return parseHaven(data);
  }

  // ChatGPT — has mapping tree
  if (Array.isArray(data) && data[0]?.mapping) {
    return parseChatGPT(data);
  }
  if (data.mapping) {
    return parseChatGPT(data);
  }

  // Claude — has meta + chats
  if (data.meta && data.chats) {
    return parseClaude(data);
  }
  // Claude alternate format
  if (data.messages && data.title && !data.haven_version) {
    return parseClaude(data);
  }

  // SillyTavern — has character card fields
  if (data.spec === 'chara_card_v2' || data.spec === 'chara_card_v3' || data.data?.name) {
    return parseSillyTavern(data);
  }
  if (data.name && (data.personality || data.description || data.first_mes)) {
    return parseSillyTavern(data);
  }

  return {
    source: 'unknown',
    threads: [],
    errors: ['Could not detect the file format. Supported: ChatGPT, Claude, SillyTavern, Haven exports.'],
  };
}
