"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.TOOL_CALL_OPEN = exports.TOOL_CALL_CLOSE = exports.REQUIRED_TOOL_REASK = exports.MARKER_CALL_OPEN = exports.MARKER_CALL_CLOSE = exports.FORBIDDEN_TOOL_KEYS = exports.CleartextToolDataError = exports.APP_TOOL_FORMAT = void 0;
exports.assertNoCleartextToolFields = assertNoCleartextToolFields;
exports.createToolCallStreamParser = createToolCallStreamParser;
exports.parseToolCallBody = parseToolCallBody;
exports.parseToolCallsFromText = parseToolCallsFromText;
exports.renderToolsBlock = renderToolsBlock;
exports.toTextToolMessages = toTextToolMessages;
// Tool use as TEXT inside the E2EE envelope.
//
// WHY THIS EXISTS. NEAR's E2EE envelope covers `messages[].content` and the
// response's `content` / `reasoning_content`, nothing else. A native `tools`
// field, `tool_choice`, a replayed `assistant.tool_calls` and the response's
// `delta.tool_calls` all travel in CLEARTEXT through Mera's gateway and NEAR's
// API layer, and the model's tool arguments carry the user's facts and home.
// So no tool field ever leaves the device: the schema is written into the
// (encrypted) system prompt in Qwen's own Hermes format, history is replayed as
// text, and the model's `<tool_call>` blocks come back inside the encrypted
// content and are parsed here after decryption. This is what the chat template
// does server-side anyway; it is just done before encryption instead of after.
//
// PURE. No React Native, no logger, no network: the eval runner and the staging
// probe import this from Node, so the app and the measurement cannot disagree
// about the wire. A purity test walks its import graph.

// A type alias, not an interface: it must stay assignable to the
// index-signatured message shape `encryptMessages` takes.

/**
 * `tool_choice: 'required'` has no text equivalent. The tools block asks for a
 * call, and a reply that still carries none is re-asked ONCE with this line
 * appended as a user turn. The caller owns the re-ask, never the stream.
 */
const REQUIRED_TOOL_REASK = exports.REQUIRED_TOOL_REASK = 'Your reply must call one of the functions. Reply with the <tool_call> block now.';
const TOOL_CALL_OPEN = exports.TOOL_CALL_OPEN = '<tool_call>';
const TOOL_CALL_CLOSE = exports.TOOL_CALL_CLOSE = '</tool_call>';

/**
 * `marker` uses tags of our own that no server-side tool parser knows, so the
 * call can never be lifted out of the content before it is encrypted, whatever
 * the provider deploys. The body is the Hermes JSON.
 */
const MARKER_CALL_OPEN = exports.MARKER_CALL_OPEN = '<mera_call>';
const MARKER_CALL_CLOSE = exports.MARKER_CALL_CLOSE = '</mera_call>';
const MARKER_RESULT_OPEN = '<mera_result>';
const MARKER_RESULT_CLOSE = '</mera_result>';
function callTags(format) {
  return format === 'marker' ? [MARKER_CALL_OPEN, MARKER_CALL_CLOSE] : [TOOL_CALL_OPEN, TOOL_CALL_CLOSE];
}

/**
 * Body keys that must never leave the device on a chat request. Checked by
 * `assertNoCleartextToolFields` before every send: the app FAILS CLOSED.
 */
const FORBIDDEN_TOOL_KEYS = exports.FORBIDDEN_TOOL_KEYS = ['tools', 'tool_choice', 'tool_calls', 'tool_call_id', 'functions', 'function_call'];
class CleartextToolDataError extends Error {
  constructor(key) {
    super(`E2EE: refusing to send a chat request carrying a cleartext "${key}" field`);
    this.key = key;
    this.name = 'CleartextToolDataError';
  }
}

/** Throws when any forbidden key appears anywhere in the body. */
exports.CleartextToolDataError = CleartextToolDataError;
function assertNoCleartextToolFields(body) {
  const walk = v => {
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    if (v === null || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v)) {
      if (FORBIDDEN_TOOL_KEYS.includes(k)) throw new CleartextToolDataError(k);
      walk(x);
    }
  };
  walk(body);
}

/**
 * Python's `json.dumps` default separators (", " and ": "), which is what the
 * Hugging Face template's `tojson` writes. Byte-closeness to what the model was
 * trained on is the point; nothing parses this side of it.
 */
function pyJson(v) {
  if (Array.isArray(v)) return `[${v.map(pyJson).join(', ')}]`;
  if (v !== null && typeof v === 'object') {
    return `{${Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => `${JSON.stringify(k)}: ${pyJson(x)}`).join(', ')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/**
 * `hermes`: the Qwen3 JSON form (`<tool_call>{"name", "arguments"}</tool_call>`).
 * `xml`: the Qwen3-Coder form (`<tool_call><function=..><parameter=..>`), which
 * token-matches what NEAR renders for its Qwen3.6+ models far more closely.
 * `xml-first`: the same, with the tools block BEFORE the system prompt, the
 * order Qwen's own template uses. `xml-first-soft`: tools-first without the
 * template's "NO suffix" / "NOT after" lines, so a sentence may follow a call.
 */

const isXml = format => format === 'xml' || format === 'xml-first' || format === 'xml-first-soft';
const toolsFirst = format => format === 'xml-first' || format === 'xml-first-soft';

/** The one format the app sends. Chosen by an interleaved corpus run;
 *  the others stay only as eval arms. */
const APP_TOOL_FORMAT = exports.APP_TOOL_FORMAT = 'xml';
function xmlExtra(obj, handled) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return '';
  let out = '';
  for (const [k, v] of Object.entries(obj)) {
    if (handled.includes(k) || v === undefined) continue;
    out += v !== null && typeof v === 'object' ? `\n<${k}>${pyJson(v)}</${k}>` : `\n<${k}>${String(v)}</${k}>`;
  }
  return out;
}
const XML_INSTRUCTIONS = '\n\nIf you choose to call a function ONLY reply in the following format with NO suffix:\n\n' + '<tool_call>\n<function=example_function_name>\n<parameter=example_parameter_1>\nvalue_1\n</parameter>\n' + '<parameter=example_parameter_2>\nThis is the value for the second parameter\nthat can span\nmultiple lines\n' + '</parameter>\n</function>\n</tool_call>\n\n<IMPORTANT>\nReminder:\n' + '- Function calls MUST follow the specified format: an inner <function=...></function> block must be nested within <tool_call></tool_call> XML tags\n' + '- Required parameters MUST be specified\n' + '- You may provide optional reasoning for your function call in natural language BEFORE the function call, but NOT after\n' + '- If there is no function call available, answer the question like normal with your current knowledge and do not tell the user about function calls\n' + '</IMPORTANT>';
const SOFT_XML_INSTRUCTIONS = XML_INSTRUCTIONS.replace('If you choose to call a function ONLY reply in the following format with NO suffix:', 'If you choose to call a function, use the following format:').replace('in natural language BEFORE the function call, but NOT after', 'in natural language before the function call, and a short sentence to the user after it');
function renderXmlTools(tools, soft = false) {
  let out = '# Tools\n\nYou have access to the following functions:\n\n<tools>';
  for (const {
    function: f
  } of tools) {
    out += `\n<function>\n<name>${f.name}</name>`;
    if (f.description !== undefined) out += `\n<description>${f.description.trim()}</description>`;
    out += '\n<parameters>';
    const params = f.parameters ?? {};
    for (const [name, field] of Object.entries(params.properties ?? {})) {
      out += `\n<parameter>\n<name>${name}</name>`;
      if (field.type !== undefined) out += `\n<type>${String(field.type)}</type>`;
      if (field.description !== undefined) out += `\n<description>${String(field.description).trim()}</description>`;
      out += `${xmlExtra(field, ['name', 'type', 'description'])}\n</parameter>`;
    }
    out += `${xmlExtra(params, ['type', 'properties'])}\n</parameters>\n</function>`;
  }
  return `${out}\n</tools>${soft ? SOFT_XML_INSTRUCTIONS : XML_INSTRUCTIONS}`;
}

/** The tools block, as Qwen's chat template renders it. */
function renderToolsBlock(tools, toolChoice, format = 'hermes') {
  const required = toolChoice === 'required' ? '\n\nThis reply must contain at least one <tool_call>.' : '';
  if (isXml(format)) return renderXmlTools(tools, format === 'xml-first-soft') + required;
  const lines = tools.map(t => pyJson({
    type: t.type ?? 'function',
    function: t.function
  })).join('\n');
  if (format === 'marker') {
    return '# Tools\n\nYou may call one or more functions to assist with the user query.\n\n' + 'You are provided with function signatures within <tools></tools> XML tags:\n' + `<tools>\n${lines}\n</tools>\n\n` + 'For each function call, return a json object with function name and arguments within ' + `${MARKER_CALL_OPEN}${MARKER_CALL_CLOSE} tags:\n${MARKER_CALL_OPEN}\n{"name": <function-name>, "arguments": <args-json-object>}\n${MARKER_CALL_CLOSE}\n` + `Function results come back to you inside ${MARKER_RESULT_OPEN}${MARKER_RESULT_CLOSE} tags.` + (toolChoice === 'required' ? `\n\nThis reply must contain at least one ${MARKER_CALL_OPEN}.` : '');
  }
  return '# Tools\n\nYou may call one or more functions to assist with the user query.\n\n' + 'You are provided with function signatures within <tools></tools> XML tags:\n' + `<tools>\n${lines}\n</tools>\n\n` + 'For each function call, return a json object with function name and arguments within ' + '<tool_call></tool_call> XML tags:\n<tool_call>\n{"name": <function-name>, "arguments": <args-json-object>}\n</tool_call>' + required;
}
function renderCall(c, format) {
  let args = c.function.arguments;
  try {
    args = JSON.parse(c.function.arguments || '{}');
  } catch {
    // A malformed history call is replayed as its raw string, like the
    // template's tojson would.
  }
  if (isXml(format) && args !== null && typeof args === 'object' && !Array.isArray(args)) {
    const params = Object.entries(args).map(([k, v]) => `<parameter=${k}>\n${typeof v === 'string' ? v : pyJson(v)}\n</parameter>\n`).join('');
    return `${TOOL_CALL_OPEN}\n<function=${c.function.name}>\n${params}</function>\n${TOOL_CALL_CLOSE}`;
  }
  const [open, close] = callTags(format);
  return `${open}\n${pyJson({
    name: c.function.name,
    arguments: args
  })}\n${close}`;
}

/**
 * Rewrites an OpenAI-shaped conversation so that no tool field remains:
 * the tools block joins the system message (one is added when absent),
 * an assistant's `tool_calls` become `<tool_call>` text, and consecutive
 * `role: 'tool'` messages become ONE user turn of `<tool_response>` blocks,
 * the way the template groups them. Everything returned is plain content,
 * which the caller then encrypts.
 */
function toTextToolMessages(messages, tools, toolChoice, format = 'hermes') {
  const out = [];
  const block = tools && tools.length > 0 ? renderToolsBlock(tools, toolChoice, format) : null;
  let blockPlaced = block === null;
  for (const m of messages) {
    if (m.role === 'system') {
      if (!blockPlaced) {
        const joined = toolsFirst(format) ? `${block}\n\n${m.content}` : `${m.content}\n\n${block}`;
        out.push({
          role: 'system',
          content: m.content ? joined : block
        });
        blockPlaced = true;
      } else {
        out.push({
          role: 'system',
          content: m.content
        });
      }
    } else if (m.role === 'assistant') {
      const calls = (m.tool_calls ?? []).map(c => renderCall(c, format));
      const content = [m.content, ...calls].filter(s => s && s.length > 0).join('\n');
      out.push({
        role: 'assistant',
        content
      });
    } else if (m.role === 'tool') {
      const [ro, rc] = format === 'marker' ? [MARKER_RESULT_OPEN, MARKER_RESULT_CLOSE] : ['<tool_response>', '</tool_response>'];
      const response = `${ro}\n${m.content}\n${rc}`;
      const prev = out[out.length - 1];
      if (prev && prev.role === 'user' && prev.content.startsWith(ro)) {
        prev.content = `${prev.content}\n${response}`;
      } else {
        out.push({
          role: 'user',
          content: response
        });
      }
    } else {
      out.push({
        role: 'user',
        content: m.content
      });
    }
  }
  if (!blockPlaced) out.unshift({
    role: 'system',
    content: block
  });
  return out;
}

/** Reads ONE call body: the Hermes JSON form, else the Qwen3-Coder XML form
 *  (`<function=name><parameter=k>v</parameter></function>`). Null when neither. */
function parseToolCallBody(body, tools) {
  const text = body.trim();
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed.name === 'string' && parsed.name.length > 0) {
      const args = parsed.arguments ?? parsed.parameters ?? {};
      return {
        name: parsed.name,
        argumentsRaw: typeof args === 'string' ? args : JSON.stringify(args)
      };
    }
  } catch {
    // fall through to the XML form
  }
  const fn = /<function=([^>\s]+)>([\s\S]*?)(?:<\/function>|$)/.exec(text);
  if (!fn) return null;
  // A declared string stays a string ("2026" is a year, not a number); every
  // other value is read as JSON when it parses, the way vLLM's parser does.
  const props = (tools?.find(t => t.function.name === fn[1])?.function.parameters ?? {}).properties;
  const args = {};
  const re = /<parameter=([^>\s]+)>\n?([\s\S]*?)\n?<\/parameter>/g;
  let p;
  while ((p = re.exec(fn[2])) !== null) {
    const raw = p[2];
    if (props?.[p[1]]?.type === 'string') {
      args[p[1]] = raw;
      continue;
    }
    try {
      args[p[1]] = JSON.parse(raw);
    } catch {
      args[p[1]] = raw;
    }
  }
  return {
    name: fn[1],
    argumentsRaw: JSON.stringify(args)
  };
}

/** Length of the longest suffix of `s` that is a proper prefix of `tag`. */
function heldPrefix(s, tag) {
  for (let n = Math.min(s.length, tag.length - 1); n > 0; n--) {
    if (tag.startsWith(s.slice(s.length - n))) return n;
  }
  return 0;
}
/**
 * Streaming split of visible text from `<tool_call>` blocks. Text that could
 * be the start of an opener is HELD until it resolves, so a tag split across
 * deltas never reaches the bubble. A model sometimes omits the closer between
 * two calls; a second opener closes the first.
 */
function createToolCallStreamParser(tools, format = 'hermes') {
  const [OPEN, CLOSE] = callTags(format);
  let pending = '';
  let inside = false;
  let callBuf = '';
  const step = final => {
    let text = '';
    const calls = [];
    for (;;) {
      if (inside) {
        const close = pending.indexOf(CLOSE);
        const reopen = pending.indexOf(OPEN);
        const implicit = reopen >= 0 && (close < 0 || reopen < close);
        const at = implicit ? reopen : close;
        if (at < 0) {
          // Keep a possible half closer (or half reopener) in `pending`, or a
          // tag split across deltas is never found.
          const hold = final ? 0 : Math.max(heldPrefix(pending, CLOSE), heldPrefix(pending, OPEN));
          callBuf += pending.slice(0, pending.length - hold);
          pending = pending.slice(pending.length - hold);
          break;
        }
        callBuf += pending.slice(0, at);
        pending = pending.slice(implicit ? at : at + CLOSE.length);
        inside = false;
        const call = parseToolCallBody(callBuf, tools);
        if (call) calls.push(call);
        callBuf = '';
      } else {
        const open = pending.indexOf(OPEN);
        if (open >= 0) {
          text += pending.slice(0, open);
          pending = pending.slice(open + OPEN.length);
          inside = true;
          continue;
        }
        // Hold back the longest suffix that is a prefix of the opener.
        const hold = final ? 0 : heldPrefix(pending, OPEN);
        text += pending.slice(0, pending.length - hold);
        pending = pending.slice(pending.length - hold);
        break;
      }
    }
    return {
      text,
      calls
    };
  };
  return {
    push(chunk) {
      pending += chunk;
      return step(false);
    },
    flush() {
      const r = step(true);
      let unclosed = false;
      if (inside) {
        const call = parseToolCallBody(callBuf, tools);
        if (call) r.calls.push(call);else unclosed = true;
        inside = false;
        callBuf = '';
      }
      return {
        ...r,
        unclosed
      };
    }
  };
}

/** Whole-text form of the stream parser. */
function parseToolCallsFromText(full, tools, format = 'hermes') {
  const p = createToolCallStreamParser(tools, format);
  const a = p.push(full);
  const b = p.flush();
  return {
    text: a.text + b.text,
    calls: [...a.calls, ...b.calls]
  };
}