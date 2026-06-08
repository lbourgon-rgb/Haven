import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../src/index.ts'), 'utf8');

describe('background chat jobs contract', () => {
  it('declares the D1 chat_jobs table with the required status lifecycle', () => {
    assert.match(source, /CREATE TABLE IF NOT EXISTS chat_jobs/);
    assert.match(source, /status TEXT NOT NULL CHECK \(status IN \('queued', 'running', 'complete', 'failed'\)\)/);
    assert.match(source, /companion_message_id TEXT/);
  });

  it('exposes create and status endpoints for async chat jobs', () => {
    assert.match(source, /path === '\/api\/chat\/jobs' && request\.method === 'POST'/);
    assert.ok(source.includes("path.match(/^\\/api\\/chat\\/jobs\\/([^/]+)$/)"));
    assert.match(source, /return json\(\{\s*job_id: jobId,\s*thread_id: turn\.activeThreadId,\s*user_message_id: turn\.userMsgId,\s*status: 'queued'/s);
  });

  it('runs jobs in waitUntil and marks completion or failure without deleting the user message', () => {
    const jobRunnerBody = source.slice(
      source.indexOf('async function runChatJob'),
      source.indexOf('// ============================================================\n// Schema migrations')
    );
    assert.match(source, /ctx\.waitUntil\(runChatJob\(env, jobId/);
    assert.match(jobRunnerBody, /SET status = 'complete', companion_message_id = \?/);
    assert.match(jobRunnerBody, /SET status = 'failed', error = \?/);
    assert.doesNotMatch(jobRunnerBody, /DELETE FROM messages/);
  });

  it('does not use destructive parent-row replace statements in full import', () => {
    const fullImportBody = source.slice(
      source.indexOf("'/api/import/full'"),
      source.indexOf('// ---- MCP Servers ----')
    );
    assert.doesNotMatch(fullImportBody, /INSERT OR REPLACE INTO companion/);
    assert.doesNotMatch(fullImportBody, /INSERT OR REPLACE INTO threads/);
    assert.match(fullImportBody, /ON CONFLICT\(id\) DO UPDATE SET/);
    assert.match(fullImportBody, /const mid = m\.id \|\| crypto\.randomUUID\(\)/);
  });
});
