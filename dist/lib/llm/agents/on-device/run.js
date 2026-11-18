"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.appKevPorts = appKevPorts;
exports.appLanguageName = appLanguageName;
exports.chatTurns = chatTurns;
exports.kevPorts = kevPorts;
exports.moreTrackOptions = moreTrackOptions;
exports.onDeviceTool = onDeviceTool;
exports.promptBudget = promptBudget;
exports.respondStructured = respondStructured;
exports.routeOf = routeOf;
exports.today = today;
exports.tryKev = tryKev;
var _completeLocal = require("../../completeLocal");
var _onDeviceModel = require("../../../platform/on-device-model");
var _factService = require("../../../database/services/fact-service");
var _i18n = _interopRequireDefault(require("../../../platform/i18n"));
var _logger = _interopRequireDefault(require("../../../logger"));
var _factNormalise = require("../../../mera-harness/core/fact-normalise");
var _moreOptions = require("../../../news-harness/on-device/follow-story/more-options");
var _kev = require("../../../news-harness/on-device/kev");
var _shared = require("../../../news-harness/on-device/shared");
var _appLanguageStore = require("../../../stores/app-language-store");
var _supportedLanguages = require("../../../supported-languages");
var _routes = require("./routes");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// What every on-device chat agent shares: the app language, the history as the
// flows read it, and one structured call sized to the engine's window.

function appLanguageName() {
  const code = _appLanguageStore.useAppLanguageStore.getState().appLanguage;
  return _supportedLanguages.SUPPORTED_LANGUAGES.find(l => l.code === code)?.name ?? 'English';
}

/** The thread as plain turns. Hidden turns stay: the model must read them. */
function chatTurns(messages) {
  return messages.filter(m => m.content.trim().length > 0).map(m => ({
    role: m.role,
    content: m.content
  }));
}

/** Today as YYYY-MM-DD (UTC), the date anchor for story options. */
function today(nowMs = Date.now()) {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** Tokens the prompt may use on this engine, once instructions, schema and reply are paid for. */
async function promptBudget(system, schema) {
  return (0, _shared.promptBudgetTokens)({
    contextSize: await (0, _onDeviceModel.contextSize)(),
    maxTokens: _shared.ON_DEVICE_CHAT_MAX_TOKENS,
    system,
    schemaJson: schema ? JSON.stringify(schema) : undefined
  });
}

/** One structured on-device turn: the value fitting `schema`, or StructuredOutputError. */
async function respondStructured(system, schema, prompt) {
  return (0, _completeLocal.completeLocalStructured)({
    systemPrompt: system,
    prompt: prompt(await promptBudget(system, schema)),
    schema,
    maxTokens: _shared.ON_DEVICE_CHAT_MAX_TOKENS,
    temperature: 0.3
  });
}

/** The app's Kev ports: the toolkit's decide (llama lock inside), the built-in model as writer, i18n. */
function appKevPorts() {
  return {
    decide: _onDeviceModel.decide,
    write: (system, prompt, schema) => (0, _completeLocal.completeLocalStructured)({
      systemPrompt: system,
      prompt,
      schema,
      maxTokens: _shared.ON_DEVICE_CHAT_MAX_TOKENS,
      temperature: 0.3
    }),
    budget: (system, schema) => promptBudget(system, schema),
    t: key => _i18n.default.t(key)
  };
}

/** Constructor options of the on-device chat agents: tests and the harness swap the route and the ports. */

function routeOf(flow, opts) {
  return opts.route ?? _routes.ON_DEVICE_CHAT_ROUTE[flow];
}
function kevPorts(opts) {
  return {
    ...appKevPorts(),
    ...opts.ports
  };
}

/** "More options" for a follow card: the one writer call, on the app's ports. */
function moreTrackOptions(req, opts, articleTitle) {
  return (0, _moreOptions.runMoreTrackOptions)({
    today: today(),
    shown: req.shown,
    room: req.room,
    subject: req.subject,
    articleTitle
  }, kevPorts(opts));
}

/**
 * A Kev turn, or null when Kev itself failed (not downloaded, busy, an
 * unexpected answer): the agent then runs its single built-in call, so the user
 * never sees the failure. Writer failures never get here; the flow answers
 * them with its fixed reply.
 */
async function tryKev(tag, run) {
  try {
    return await run();
  } catch (err) {
    // The class only: the message can quote the user's facts.
    _logger.default.warn(`[${tag}] Kev turn failed, single call instead`, {
      error: err instanceof Error ? err.name : typeof err
    });
    return null;
  }
}

/**
 * The tools an on-device agent answers itself, before the cloud executors:
 * - ask_choice is UI-only; the awaiting result is what makes the chips show.
 * - deleteUserFacts never deletes. It stages the Remove / Keep card with
 *   the shape the cloud loop's gate writes, so the same card renders; only the
 *   card's Remove deletes.
 * Null for every other tool.
 */
async function onDeviceTool(name, input) {
  if (name === _kev.ASK_CHOICE_TOOL) return {
    result: {
      ..._kev.ASK_CHOICE_AWAITING
    }
  };
  if (name !== 'deleteUserFacts') return null;
  const facts = await (0, _factService.getFacts)();
  const pending = (0, _factNormalise.resolveDeleteTargets)(input ?? {}, facts.map(f => ({
    id: f.id,
    statement: f.statement,
    attribute: f.questionnaireAttribute
  })));
  return {
    result: pending.length > 0 ? {
      error: 'The card asks the user to confirm this removal. Do not ask again.',
      pendingFactIds: pending.map(f => f.id),
      pendingStatements: pending.map(f => f.statement)
    } : {
      error: 'No fact on file matches.'
    }
  };
}