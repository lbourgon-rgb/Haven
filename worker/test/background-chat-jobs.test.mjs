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

  it('persists companion tool metadata so refreshed messages can render tool chips', () => {
    assert.match(source, /ALTER TABLE messages ADD COLUMN tool_calls TEXT/);
    assert.match(source, /ALTER TABLE messages ADD COLUMN notice TEXT/);
    assert.match(source, /function compactToolCalls/);
    assert.match(source, /INSERT INTO messages \(id, thread_id, role, content, model, tool_calls, notice\)/);
    assert.match(source, /tool_calls: m\.tool_calls \? JSON\.parse\(m\.tool_calls\) : undefined/);
  });

  it('short-circuits safety stop language without calling the model', () => {
    assert.match(source, /function isSafetyStopMessage/);
    assert.match(source, /function safetyStopReply/);
    assert.match(source, /Safety stop handled locally\. No model call was made for this turn\./);
    assert.match(source, /model: 'haven-safety-stop'/);
    assert.match(source, /status: 'complete'/);
  });

  it('exposes create and status endpoints for async chat jobs', () => {
    assert.match(source, /path === '\/api\/chat\/jobs' && request\.method === 'POST'/);
    assert.ok(source.includes("path.match(/^\\/api\\/chat\\/jobs\\/([^/]+)$/)"));
    assert.match(source, /return json\(\{\s*job_id: jobId,\s*thread_id: turn\.activeThreadId,\s*user_message_id: turn\.userMsgId,\s*status: 'queued'/s);
  });

  it('keeps Kai chat jobs on the Serythrae lane regardless of selected provider', () => {
    assert.match(source, /const allowedProviders = \['serythrae', 'openrouter'/);
    assert.match(source, /async function generateSerythraeChatReply/);
    assert.match(source, /const hasSerythraeLine = !!env\.SERYTHRAE_GATEWAY \|\| !!env\.SERYTHRAE_GATEWAY_URL/);
    assert.match(source, /if \(input\.companionId === 1 && hasSerythraeLine\)/);
    assert.match(source, /SERYTHRAE_GATEWAY\?: Fetcher/);
    assert.match(source, /gateway \? 'https:\/\/serythrae-gw\/kai\/respond' : `\$\{base\}\/kai\/respond`/);
    assert.match(source, /surface: 'haven'/);
    assert.match(source, /session_id: input\.threadId/);
  });

  it('runs Kai Discord runner turns through Haven transcript and Serythrae composer', () => {
    assert.match(source, /function buildWakeGroundingPrompt/);
    assert.match(source, /## Current Discord Wake Grounding/);
    assert.match(source, /Tahl pre-response state:/);
    assert.match(source, /Identity and relationship grounding can correct drift, but the newest Discord\/Haven message is the active request\./);
    assert.doesNotMatch(source, /prefer the continuity\/Tahl grounding/);
    assert.match(source, /function runnerThreadId/);
    assert.match(source, /async function persistRunnerUserTurn/);
    assert.match(source, /path === '\/api\/runner\/kai\/respond' && request\.method === 'POST'/);
    assert.match(source, /const runnerThread = runnerThreadId/);
    assert.match(source, /await persistRunnerUserTurn/);
    assert.match(source, /await generateSerythraeChatReply\(env, \{/);
    assert.match(source, /surface: body\.source \|\| 'discord'/);
    assert.match(source, /wakeContext: body\.wake_context/);
    assert.match(source, /const compMsgId = await persistChatReply/);
    assert.match(source, /haven_companion_message_id: compMsgId/);
  });

  it('places current-turn priority after grounding and before transcript history', () => {
    const composerBody = source.slice(
      source.indexOf('async function generateSerythraeChatReply'),
      source.indexOf('function toolNoticeForError')
    );
    assert.match(source, /function buildCurrentTurnPriorityPrompt/);
    assert.match(source, /## Current Turn Priority/);
    assert.match(source, /Answer the newest user message first\./);
    assert.match(source, /<current_user_message>\\n\$\{message\}\\n<\/current_user_message>/);
    assert.ok(
      composerBody.indexOf('buildWakeGroundingPrompt(input.wakeContext)')
        < composerBody.indexOf('buildCurrentTurnPriorityPrompt(input.message)'),
      'wake grounding should be added before current-turn priority'
    );
    assert.ok(
      composerBody.indexOf('buildCurrentTurnPriorityPrompt(input.message)')
        < composerBody.indexOf('...(sessionMessages.length ? sessionMessages'),
      'current-turn priority should be added before transcript history'
    );
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

  it('times out stale background jobs instead of leaving Kai replying forever', () => {
    assert.match(source, /const CHAT_JOB_TIMEOUT_SECONDS = 180/);
    assert.match(source, /function timeoutAfter/);
    assert.match(source, /status = 'complete'[\s\S]+EXISTS \(\s*SELECT 1 FROM messages/);
    assert.match(source, /Kai response timed out\. Please retry this message\./);
    assert.match(source, /datetime\(updated_at\) <= datetime\('now', \?\)/);
    assert.match(source, /timeoutAfter\(generateChatReply\(env, \{/);
  });

  it('marks chat jobs complete before best-effort continuity fanout can block polling', () => {
    const jobRunnerBody = source.slice(
      source.indexOf('async function runChatJob'),
      source.indexOf('// ============================================================\n// Schema migrations')
    );
    assert.ok(
      jobRunnerBody.indexOf("SET status = 'complete', companion_message_id = ?")
        < jobRunnerBody.indexOf('await sendContinuityEvent(env, {'),
      'chat job completion must be persisted before continuity fanout'
    );
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
