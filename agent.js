// ── Autonomous agent powered by the Claude API ────────────────────────────────
//
// Give it a task description (e.g. "Create a social media post about birthday
// gifts"), and it asks Claude to carry the task out, logs the result, and
// returns it. Designed to be extended: add entries to CAPABILITIES below and the
// agent can pick the right one for the job and run it autonomously.

const Anthropic = require('@anthropic-ai/sdk');

// Per the Claude API defaults: latest Opus, adaptive thinking, streaming so long
// generations don't trip the SDK's request timeout.
const MODEL = process.env.AGENT_MODEL || 'claude-opus-4-8';

// Lazily construct the client so the rest of the app still boots without a key.
// `new Anthropic()` reads ANTHROPIC_API_KEY from the environment.
let _client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Add it to your .env to enable the agent.'
    );
  }
  if (!_client) _client = new Anthropic();
  return _client;
}

// ── Capabilities ──────────────────────────────────────────────────────────────
// Each capability is a focused skill the agent can perform. To extend the agent,
// add a new entry: a `match` test that decides when it applies and a `system`
// prompt that specializes Claude for it. The first match wins; `general` is the
// catch-all fallback and must stay last.
const CAPABILITIES = [
  {
    name: 'social_post',
    description: 'Write social media posts / captions.',
    match: (task) => /\b(social|post|caption|tweet|instagram|tiktok|linkedin|facebook)\b/i.test(task),
    system:
      'You are a social media copywriter for Giftly, a gift-recommendation app. ' +
      'Write a single, ready-to-publish post in a warm, upbeat voice. Keep it concise, ' +
      'include a clear call to action, and add a few tasteful, relevant hashtags. ' +
      'Output only the post text — no preamble, options, or explanation.',
  },
  {
    name: 'gift_ideas',
    description: 'Brainstorm gift ideas for a person or occasion.',
    match: (task) => /\b(gift|present|idea|recommend|suggest)\b/i.test(task),
    system:
      'You are a thoughtful gift concierge for Giftly. Suggest specific, creative gift ' +
      'ideas tailored to the request, with a one-line reason for each. Group sensibly ' +
      'and keep it scannable.',
  },
  {
    name: 'general',
    description: 'General-purpose task handling.',
    match: () => true,
    system:
      'You are an autonomous assistant for Giftly, a gift-recommendation app. ' +
      'Complete the requested task directly and concisely. If the task is ambiguous, ' +
      'make a reasonable assumption and note it briefly.',
  },
];

function selectCapability(task) {
  return CAPABILITIES.find((c) => c.match(task)) || CAPABILITIES[CAPABILITIES.length - 1];
}

// ── Core ──────────────────────────────────────────────────────────────────────
/**
 * Run the agent against a free-form task description.
 *
 * @param {string} task - What the agent should do.
 * @param {object} [options]
 * @param {number} [options.maxTokens=4096] - Output token ceiling.
 * @returns {Promise<{capability: string, model: string, result: string, usage: object}>}
 */
async function runAgent(task, options = {}) {
  if (!task || typeof task !== 'string' || !task.trim()) {
    throw new Error('A non-empty task description is required.');
  }

  const capability = selectCapability(task);
  const maxTokens = options.maxTokens || 4096;
  const client = getClient();

  console.log(`[agent] task received: ${JSON.stringify(task)}`);
  console.log(`[agent] capability: ${capability.name} | model: ${MODEL}`);

  // Stream so large outputs don't hit the SDK HTTP timeout, then collect the
  // full message with finalMessage().
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: maxTokens,
    thinking: { type: 'adaptive' },
    system: capability.system,
    messages: [{ role: 'user', content: task }],
  });

  const message = await stream.finalMessage();

  if (message.stop_reason === 'refusal') {
    console.warn('[agent] request refused by safety system');
    throw new Error('The request was declined by the safety system.');
  }

  const result = message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();

  console.log(`[agent] done — ${message.usage.output_tokens} output tokens`);
  console.log(`[agent] result:\n${result}`);

  return {
    capability: capability.name,
    model: MODEL,
    result,
    usage: message.usage,
  };
}

module.exports = { runAgent, CAPABILITIES };
