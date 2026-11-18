"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.buildAgentPersona = buildAgentPersona;
exports.callModelViaCloud = callModelViaCloud;
exports.fallbackCandidates = fallbackCandidates;
exports.laneForTier = laneForTier;
exports.logAgentTurn = logAgentTurn;
exports.lookupPlaceWithFallback = lookupPlaceWithFallback;
exports.makeAgentDeps = makeAgentDeps;
exports.makeAgentToolPort = makeAgentToolPort;
exports.narrowToExact = narrowToExact;
exports.placeQueryForms = placeQueryForms;
exports.unmatchedWords = unmatchedWords;
exports.withExactNameMatches = withExactNameMatches;
exports.withUserTerm = withUserTerm;
var _meraHarness = require("../mera-harness");
var _factSimilarityService = require("../database/services/fact-similarity-service");
var _placeService = require("../place-service");
var _cloudComplete = require("../llm/cloudComplete");
var _textToolProtocol = require("../harnesses/text-tool-protocol");
var _chatPhase = require("../services/chat-phase");
var _constants = require("../llm/constants");
var _router = require("../llm/router");
var _toolHandlers = require("./tool-handlers");
var _webSearchHandler = require("./web-search-handler");
var _meraProtocolStore = require("../stores/mera-protocol-store");
var _factService = require("../database/services/fact-service");
var _appLanguageStore = require("../stores/app-language-store");
var _supportedLanguages = require("../supported-languages");
var _languageCodes = require("../algorithms/language-codes");
var _readerPhrase = require("../news-harness/on-device/follow-story/reader-phrase");
var _factPlaces = require("../news-harness/persona-management/fact-places");
var _logger = _interopRequireDefault(require("../logger"));
var _proposals = require("../news-harness/core/proposals");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// agent-device-port — the app's implementation of the harness's AgentToolPort
// and AgentDeps.
//
// This is the seam the whole design rests on: the SAME `runAgentTurn` runs in
// the app and in the eval, so a harness green is evidence about the app rather
// than about a parallel implementation. Everything device-shaped lives here;
// nothing in lib/mera-harness knows this file exists.

const TAG = '[AgentPort]';

/**
 * `statement` comes from the DEVICE, never from the model.
 *
 * The tool takes only an optional `kind` precisely so the user's words stay out
 * of a cleartext tool argument; the raw turn text is supplied here, on-device,
 * where it never leaves the phone.
 */
/**
 * The query forms to try, most specific first.
 *
 * `placeSearch` is an anchored PREFIX match over a GeoNames-seeded collection,
 * so a whole phrase like "Nieuw-West Amsterdam" matches nothing: no row begins
 * with it. On device that surfaced as "I'm having trouble verifying that
 * neighbourhood" and a prose question instead of the chips, even though both
 * "Amsterdam" and "Nieuw-West" resolve on their own.
 *
 * Order matters and is deliberate:
 *  1. the whole query, so an exact single-token place still wins outright;
 *  2. comma or space segments FROM THE END, because a place phrase runs
 *     narrow-to-wide ("Nieuw-West, Amsterdam") and the widest tail is the one
 *     a prefix index actually holds;
 *  3. any hyphenated token, which is the neighbourhood form GeoNames does
 *     carry ("Nieuw-West") and which segment 2 would otherwise skip past.
 *
 * Deterministic and deduped, so the same input always tries the same forms in
 * the same order.
 */
function placeQueryForms(query) {
  const raw = query.trim();
  if (!raw) return [];
  const forms = [raw];
  const segments = raw.split(/[,]/).map(p => p.trim()).filter(Boolean);
  // Narrow to wide, so the widest tail is tried before the narrowest head.
  for (let i = segments.length - 1; i >= 0; i--) forms.push(segments[i]);

  // Strip glued punctuation so "Nieuw-West," is looked up as "Nieuw-West".
  const words = raw.split(/\s+/).map(w => w.replace(/^[,.;:!?]+|[,.;:!?]+$/g, '')).filter(Boolean);
  for (let i = words.length - 1; i >= 0; i--) forms.push(words[i]);
  for (const w of words) if (w.includes('-')) forms.push(w);
  const seen = new Set();
  return forms.filter(f => {
    const k = f.toLowerCase();
    if (!f || k.length < 2 || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * An EXACT name match is not ambiguous with the prefix matches beside it.
 *
 * `placeSearch` is an anchored prefix match, so the fallback form "Amsterdam"
 * returns Amsterdam, Amsterdam-Zuidoost and Nieuw-Amsterdam. Handing all three
 * back reads as genuine ambiguity, and the agent asks "which Amsterdam?" with
 * options the user never said: measured on device from "I live in Nieuw-West
 * Amsterdam", where Nieuw-West is a NEIGHBOURHOOD of Amsterdam and the right
 * answer is one place plus a neighbourhood, not a question.
 *
 * So when exactly one candidate's locality equals the form, that one wins
 * outright. Two candidates with the same name stay ambiguous, which is the
 * case the choice chips exist for (Newcastle upon Tyne / under Lyme).
 */
function narrowToExact(places, form) {
  if (places.length < 2) return places;
  const wanted = form.trim().toLowerCase();
  const exact = places.filter(p => p.locality.trim().toLowerCase() === wanted);
  return exact.length === 1 ? exact : places;
}

/**
 * The candidates a FALLBACK form is allowed to stand on, or null if it has not
 * earned any.
 *
 * A fallback form is a fragment the user never typed on its own, so it needs a
 * higher bar than the query as asked. `placeSearch` is an anchored prefix over
 * a MULTIKEY `search_keys` array that includes each place's Latin alternate
 * names, so a short fragment matches on names nobody would recognise.
 *
 * THE DEVICE CASE: the agent looked up "nieuw west", the whole form and "west"
 * both missed, and the chain reached the bare word "nieuw". That prefix hits
 * Amstelveen (its historic name is Nieuwer-Amstel), Nieuwegein and
 * Nieuw-Vennep, population-sorted, and the user was asked to choose between
 * three towns they had not mentioned and do not live in. "nieuw" is just the
 * Dutch for "new".
 *
 * The tell is that NONE of those rows is called "nieuw". So a fallback is
 * trusted only when its matches actually bear its name:
 *  - exactly one exact match wins outright, which is the "Amsterdam" case that
 *    made this ladder work in the first place;
 *  - all of them exact is real ambiguity between same-named places, and the
 *    choice chips exist for it (Newcastle upon Tyne / under Lyme);
 *  - anything else is prefix noise, and NO ANSWER IS BETTER THAN A CONFIDENT
 *    WRONG ONE. Falling through to `no_match` makes the agent say it could not
 *    verify the place and ask, which is honest; offering three wrong towns
 *    invites a tap that writes the wrong home town into the persona.
 */
function fallbackCandidates(places, form) {
  const wanted = form.trim().toLowerCase();
  const exact = places.filter(p => p.locality.trim().toLowerCase() === wanted);
  if (exact.length === 0) return null;
  if (exact.length === 1 || exact.length === places.length) return exact;
  return null;
}

/**
 * THE PLACE THE USER NAMED EXACTLY must survive the candidate cap.
 *
 * `lookupPlace` keeps the first three `placeSearch` rows, ranked by population
 * over an anchored prefix of every alternate name. For "Porto" that is Porto
 * Alegre, Port-au-Prince (whose Portuguese name starts "Porto") and Porto
 * Velho; Porto itself is fourth and was cut, so the user was asked which of
 * three places they had not named. When none of the three is called exactly
 * what the user typed, this looks for rows that are, and fetches each one
 * through `lookupPlace` restricted to its own country (so the mapping to a
 * candidate stays in place-service). At most two extra countries; nothing
 * extra is asked when an exact match is already among the three, or when the
 * caller already gave a country.
 */
async function withExactNameMatches(places, form, countryHint) {
  return (await exactMatchesFor(places, form, countryHint)).places;
}

/**
 * The candidates plus the ones named EXACTLY: by their name, or by one of
 * their alternate names equal to the query. "Porto Santo"
 * is an exact search key of Vila Baleira and only a prefix of Porto Santo
 * Stefano, so Vila Baleira is the place the user named. A prefix alias
 * ("Porto" in "Porto Príncipe") is not exact and is never promoted.
 */
async function exactMatchesFor(places, form, countryHint) {
  const wanted = foldName(form);
  const named = places.filter(p => foldName(p.locality) === wanted);
  if (countryHint || named.length > 0) return {
    places,
    exact: named
  };
  const search = await (0, _placeService.searchPlaces)(form);
  if (!search.ok) return {
    places,
    exact: []
  };
  const hits = search.places.filter(r => foldName(r.city) === wanted || (r.search_keys ?? []).some(k => foldName(k) === wanted));
  const cities = new Set(hits.map(r => foldName(r.city)));
  const codes = [...new Set(hits.map(r => r.countryCode))].slice(0, 2);
  const exact = [];
  for (const code of codes) {
    // eslint-disable-next-line no-await-in-loop -- at most two, in rank order.
    const out = await (0, _placeService.lookupPlace)(form, code);
    if (out.status === 'resolved') {
      exact.push(...out.places.filter(p => cities.has(foldName(p.locality))));
    }
  }
  if (exact.length === 0) return {
    places,
    exact
  };
  const merged = [...exact, ...places.filter(p => !exact.some(e => e.locality === p.locality && e.countryCode === p.countryCode))];
  return {
    places: merged.slice(0, _placeService.PLACE_CANDIDATE_LIMIT),
    exact
  };
}

/**
 * Try each form and return the first result that has earned it, recording
 * which form matched.
 *
 * The query AS ASKED keeps the old behaviour: the user typed it, so ambiguity
 * there is real ambiguity and the chips are the right answer. Every NARROWER
 * form has to clear `fallbackCandidates` instead, and a form that does not is
 * skipped rather than returned.
 *
 * `unavailable` short-circuits: the lookup FAILED, and retrying a narrower
 * form would turn a transport failure into a confident "no such place".
 */
/** Filler words that are never part of a place name the user wrote. */
const FILLER = new Set(['in', 'at', 'near', 'the', 'of', 'from', 'to', 'and', 'area', 'district']);

/**
 * The words of `asked` that the matched `form` did not use, in the user's
 * order, filler dropped: "niew west" for "niew west Amsterdam" matched on
 * "Amsterdam". The place service has no districts, and without this the finer
 * area the user named was thrown away with nothing telling the model.
 */
function unmatchedWords(asked, form) {
  const used = new Set(form.toLowerCase().split(/[\s,]+/).filter(Boolean));
  return asked.split(/[\s,]+/).filter(w => w && !used.has(w.toLowerCase()) && !FILLER.has(w.toLowerCase())).join(' ');
}

/** Lower case, accents and punctuation dropped, for a prefix comparison. */
function foldName(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * A single place reached through one of its ALTERNATE names carries the
 * user's own term: "Porto Santo" is only a search key of Vila Baleira, and a
 * statement without it names a place the user never said. A
 * prefix of the locality, or the locality itself, is not an alias.
 */
function withUserTerm(places, form) {
  if (places.length !== 1) return places;
  const p = places[0];
  const f = foldName(form);
  const l = foldName(p.locality);
  if (!f || l.startsWith(f) || f.startsWith(l) || p.neighbourhood && foldName(p.neighbourhood).startsWith(f)) {
    return places;
  }
  const term = form.trim() === form.trim().toLowerCase() ? form.trim().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : form.trim();
  return [{
    ...p,
    userTerm: term
  }];
}
async function lookupPlaceWithFallback(args) {
  const asked = args.query.trim().toLowerCase();
  const forms = placeQueryForms(args.query);
  let last = {
    status: 'no_match',
    query: args.query
  };
  for (const form of forms) {
    const out = await (0, _placeService.lookupPlace)(form, args.countryHint);
    if (out.status === 'unavailable') return out;
    if (out.status === 'resolved' && out.places.length > 0) {
      if (form.toLowerCase() === asked) {
        const {
          places,
          exact
        } = await exactMatchesFor(out.places, form, args.countryHint);
        // ONE place named exactly, by name or by alias, is the answer.
        const narrowed = exact.length === 1 ? exact : narrowToExact(places, form);
        return {
          ...out,
          places: withUserTerm(narrowed, form)
        };
      }
      const trusted = fallbackCandidates(out.places, form);
      if (trusted === null) {
        _logger.default.debug(`${TAG} discarded a fallback form its matches do not name`, {
          candidateCount: out.places.length
        });
        continue;
      }
      _logger.default.debug(`${TAG} place resolved on a fallback form`);
      const unmatched = unmatchedWords(args.query, form);
      return {
        ...out,
        places: withUserTerm(trusted, form),
        ...(unmatched ? {
          unmatched
        } : {})
      };
    }
    if (out.status !== 'too_short') last = out;
  }
  return last;
}

/** Lookup kinds that ask about where the user lives. */
const HOME_KINDS = new Set(['residence', 'location', 'home']);

/** The user's own home: any home key (short or canonical) or a residence
 *  statement, never a relative's and never the retired combined fact. */
function isOwnHomeFact(f) {
  if ((0, _meraHarness.isCombinedOriginFact)(f.questionnaireAttribute)) return false;
  if ((0, _meraHarness.isRelationalStatement)(f.statement)) return false;
  return (0, _meraHarness.isLocationKey)(f.questionnaireAttribute) || /^(?:lives|living|based|resides?)\s+in\b/i.test(f.statement.trim());
}

/** The engine's hooks for the three card tools: its own `executeTool` (so no
 *  consent logic is re-implemented here), the store sinks, and the card on screen. */

/** The live step row. `start` as a device tool begins, `end` in a `finally`.
 *  A TRAILING parameter and never a field on `AgentToolPort`: the harness may
 *  not know about the app's rows (boundary.test.ts). */

function makeAgentToolPort(userMessage, onPhase, cards, onTool, stop) {
  // Fired HERE, inside the port, so `haltable` answers a stopped turn before
  // any `start`. `toolName` is the CONTRACT name the row labels key on. The
  // args can hold fact text: they go to the in-memory row, never to a log.
  const live = async (toolName, args, run) => {
    if (!onTool) return run();
    const tool = {
      kind: (0, _chatPhase.stepKindForTool)(toolName),
      toolName,
      args: args && typeof args === 'object' ? args : {}
    };
    onTool('start', tool);
    try {
      return await run();
    } finally {
      onTool('end', tool);
    }
  };
  const runCard = async (name, args) => {
    const {
      result,
      sideEffects
    } = await cards.execute(name, args);
    cards.onSideEffects(sideEffects);
    return result;
  };
  return {
    ...(cards ? {
      proposeChanges: args => runCard('proposeChanges', args),
      proposeTrack: async args => {
        // The loop's handover already put the subject first: a reader's phrase
        // here would be the whole sentence in any language but English.
        if (Array.isArray(args.storySubjects)) {
          const {
            storySubjects: _subjects,
            ...card
          } = args;
          return runCard('proposeTrack', card);
        }
        // More options sends no message, so a grown card adds nothing.
        const card = (0, _readerPhrase.withReaderPhrase)(args.options, userMessage, appIsEnglish());
        if (!card) return runCard('proposeTrack', args);
        return {
          ...(await runCard('proposeTrack', {
            ...args,
            options: card.options
          })),
          ...card.hints
        };
      },
      searchNews: args => live('searchNews', args, () => runCard('searchNews', args)),
      // A card that only a tap may apply is refused here, before the agent is asked.
      applyProposal: async () => cards.pending()?.appliable ? runCard('applyProposal', {}) : (0, _proposals.userTapOnlyRefusal)(),
      cancelProposal: () => runCard('cancelProposal', {})
    } : {}),
    findSimilarFacts: args => live('find_similar_facts', args, () => similarFacts(args)),
    lookupPlace: args => live('lookup_place', args, () => lookupPlaceWithFallback(args)),
    saveExtractedFacts: args => live('saveExtractedFacts', args, () => (0, _toolHandlers.handleSaveExtractedFacts)(args)),
    deleteUserFacts: args => live('deleteUserFacts', args, () => (0, _toolHandlers.handleDeleteUserFacts)(args)),
    // Mera's own reference text; pure and lazy, no network, so no live row.
    explainMera: a => (0, _toolHandlers.handleExplainMera)(a),
    // GATE 1: offered only while "Web search in chat" is on, so the loop never
    // declares the tool otherwise. `handleWebSearch` re-checks the setting
    // before any await (gate 2), for a switch flipped mid-turn.
    ...((0, _cloudComplete.usesGateway)() && _meraProtocolStore.useMeraProtocolStore.getState().webSearchInChat ? {
      webSearch: args => live('webSearch', args, () => {
        // The wait line's phase for the same search. The next model call
        // opens with 'reset', which moves the line on; the row ends here.
        onPhase?.('webSearch');
        return (0, _webSearchHandler.handleWebSearch)(args, stop);
      })
    } : {})
  };
  async function similarFacts(args) {
    const similar = await (0, _factSimilarityService.findSimilarFacts)(args.kind ?? null, userMessage, args.limit ?? 5);
    // THE CURRENT HOME, always, on a residence lookup. Similarity is word
    // overlap with the user's message, and "I moved to Porto" shares no
    // word with "Lives in Berlin...", so the model was told there was no
    // home to replace and offered a plain Add.
    const homes = HOME_KINDS.has((args.kind ?? '').toLowerCase()) ? (await (0, _factService.getFacts)()).filter(isOwnHomeFact) : [];
    const rows = [...homes.map(f => ({
      id: f.id,
      statement: f.statement,
      questionnaireAttribute: f.questionnaireAttribute ?? null,
      score: 1
    })), ...similar.filter(r => !homes.some(h => h.id === r.id))];
    return {
      candidates: rows.map(r => ({
        factId: r.id,
        statement: r.statement,
        attribute: r.questionnaireAttribute ?? null,
        overlap: r.score
      }))
    };
  }
}

/**
 * Adapts `cloudChatStream` to the harness's `callModel`.
 *
 * Streaming is preserved through `onDelta`: the harness returns a whole result,
 * but the bubble has to fill token by token and the thinking caption has to
 * fire on the reasoning event, so deltas are forwarded as they arrive and the
 * aggregate is returned at the end.
 *
 * THROWS PROPAGATE. The harness only captures a RESOLVED error into the leg; a
 * thrown one must end the turn, which is what the hook's own catch expects.
 */
/**
 * Turn the core's TIER LABEL into the lane whose profiles serve it.
 *
 * The core is RN-free and must never know a model id, so it emits 'BIG' /
 * 'SMALL'; the router picks the model. Anything else (absent included) is the
 * chat loop: a tier word must never reach the wire as a model id, which is how
 * NEAR once answered `503 Provider error: Model 'BIG' not found`.
 */
function laneForTier(tier) {
  return tier === 'SMALL' ? 'topics' : 'chat-tools';
}

/**
 * `onPhase` is a SECOND PARAMETER, not a field on `AgentModelRequest`.
 *
 * That type lives in `lib/mera-harness/core/types.ts`, and the harness may not
 * import anything outside itself. Threading the wait line's signal through it
 * would either drag `PhaseSignal` across the boundary `boundary.test.ts`
 * guards or duplicate the union there. The loop has no interest in the phase
 * either way: it is transport progress, not agent state.
 */
async function callModelViaCloud(req, onPhase, stop) {
  const messages = [{
    role: 'system',
    content: req.systemPrompt
  }, ...req.messages.map(m => m.role === 'tool' ? {
    role: 'user',
    content: m.content
  } : {
    role: m.role,
    content: m.content
  })];
  const first = await callModelOnce(req, messages, onPhase, stop);
  // `required` has no text equivalent (tools travel inside the envelope): a
  // forced leg that came back with no call is re-asked ONCE, here, by the
  // caller, never inside the stream. A stopped turn is never re-asked.
  if (req.toolChoice !== 'required' || first.toolCalls.length > 0 || stop?.aborted) return first;
  const second = await callModelOnce(req, [...messages, {
    role: 'user',
    content: _textToolProtocol.REQUIRED_TOOL_REASK
  }], onPhase, stop);
  return {
    ...second,
    latencyMs: first.latencyMs + second.latencyMs
  };
}
async function callModelOnce(req, messages, onPhase, stop) {
  const started = Date.now();
  let ttVisibleMs = null;
  let content = '';
  const byIndex = new Map();
  const stream = (0, _cloudComplete.cloudChatStream)({
    messages,
    // Only a leg the user watches streams. Every other leg is ONE envelope:
    // its tool calls now ride inside the encrypted content, and streamed they
    // would cost one ECDH per token on the JS thread.
    stream: req.onDelta !== undefined,
    tools: req.tools,
    toolChoice: req.toolChoice ?? 'auto',
    route: laneForTier(req.model),
    maxTokens: req.maxTokens ?? _constants.CHAT_MAX_OUTPUT_TOKENS,
    // Thinking OFF on every agent call. Measured: the trace buys nothing here
    // and costs the whole budget on the topic path. A harness that cannot think
    // (Qwen3.6 truncates with it on) is never asked to: the transport applies it.
    enableThinking: req.enableThinking ?? false,
    onPhase,
    signal: stop
  });
  let finishReason = 'stop';
  for await (const event of stream) {
    if (event.type === 'reasoning') {
      req.onDelta?.({
        reasoning: ''
      });
    } else if (event.type === 'restart') {
      content = '';
      ttVisibleMs = null;
      byIndex.clear();
      req.onDelta?.({
        restart: true
      });
    } else if (event.type === 'text-delta') {
      if (ttVisibleMs === null) ttVisibleMs = Date.now() - started;
      content += event.delta;
      req.onDelta?.({
        content: event.delta
      });
    } else if (event.type === 'tool-call-delta') {
      const slot = byIndex.get(event.index) ?? {
        name: '',
        args: ''
      };
      if (event.name) slot.name = event.name;
      slot.args += event.argumentsDelta;
      byIndex.set(event.index, slot);
    } else if (event.type === 'finish') {
      finishReason = event.reason;
    } else if (event.type === 'error') {
      throw new Error(event.message);
    }
  }
  return {
    content,
    toolCalls: [...byIndex.values()].filter(c => c.name).map(c => ({
      name: c.name,
      argumentsRaw: c.args
    })),
    finishReason,
    truncated: finishReason === 'length',
    usage: null,
    // The router's first choice for the lane; a failover inside the transport is not reflected.
    modelSent: (0, _router.routeLane)(laneForTier(req.model))[0]?.model ?? null,
    latencyMs: Date.now() - started,
    ttVisibleMs,
    error: null
  };
}
function makeAgentDeps(userMessage, onDelta, onPhase,
/** The Stop button. Once aborted, no further model call or tool runs: the
 *  loop sees a resolved `error` and ends the turn with no new legs. */
stop, cards, onTool) {
  const tools = makeAgentToolPort(userMessage, onPhase, cards, onTool, stop);
  return {
    // Only the leg the loop marks `streamToUser` reaches the bubble. Passing
    // `onDelta` on every leg streamed each later leg's text into the
    // acknowledgement bubble, where the final write then split it off again.
    callModel: async req => {
      if (stop?.aborted) return stoppedModelResult();
      try {
        return await callModelViaCloud({
          ...req,
          onDelta: req.streamToUser ? onDelta : undefined
        }, onPhase, stop);
      } catch (err) {
        if (stop?.aborted) return stoppedModelResult();
        throw err;
      }
    },
    tools: stop ? haltable(tools, stop) : tools,
    loadSkill: _meraHarness.loadSkill,
    skillIds: _meraHarness.skillIds,
    now: () => Date.now()
  };
}

/** What a model call returns once the reader pressed Stop. A RESOLVED error is
 *  the one thing the loop treats as terminal without running another leg. */
function stoppedModelResult() {
  return {
    content: '',
    toolCalls: [],
    finishReason: 'stop',
    truncated: false,
    usage: null,
    modelSent: null,
    latencyMs: 0,
    ttVisibleMs: null,
    error: 'stopped'
  };
}

/** After Stop, every tool answers "stopped" without touching the device. A tool
 *  already past its guard (a write in flight) finishes on its own: each is a
 *  single atomic call. A web search in flight takes `stop` itself and ends at once. Mid-turn tools only read or STAGE a card; nothing is
 *  committed until the reader taps it, so a stopped turn leaves nothing behind. */
function haltable(port, stop) {
  const halted = run => stop.aborted ? Promise.resolve({
    error: 'stopped'
  }) : run();
  return {
    findSimilarFacts: a => halted(() => port.findSimilarFacts(a)),
    lookupPlace: a => halted(() => port.lookupPlace(a)),
    saveExtractedFacts: a => halted(() => port.saveExtractedFacts(a)),
    deleteUserFacts: a => halted(() => port.deleteUserFacts(a)),
    ...(port.webSearch ? {
      webSearch: a => halted(() => port.webSearch(a))
    } : {}),
    ...(port.explainMera ? {
      explainMera: a => halted(() => port.explainMera(a))
    } : {}),
    ...(port.proposeChanges ? {
      proposeChanges: a => halted(() => port.proposeChanges(a))
    } : {}),
    ...(port.proposeTrack ? {
      proposeTrack: a => halted(() => port.proposeTrack(a))
    } : {}),
    ...(port.searchNews ? {
      searchNews: a => halted(() => port.searchNews(a))
    } : {}),
    ...(port.applyProposal ? {
      applyProposal: () => halted(() => port.applyProposal())
    } : {}),
    ...(port.cancelProposal ? {
      cancelProposal: () => halted(() => port.cancelProposal())
    } : {})
  };
}
function logAgentTurn(reason, unknownTools) {
  if (unknownTools.length > 0) {
    _logger.default.warn(`${TAG} model invented tool names`, {
      unknownTools
    });
  }
  if (reason !== 'settled' && reason !== 'awaiting-user') {
    _logger.default.warn(`${TAG} turn ended abnormally`, {
      reason
    });
  }
}
const appIsEnglish = () => ((0, _languageCodes.canonicalizeLanguageCode)(_appLanguageStore.useAppLanguageStore.getState().appLanguage) ?? 'en').split('-')[0] === 'en';

/**
 * The app language's English name ("Hindi"), which pins every reply. Without
 * it the loop is told only to match the user's language, and a reader on a
 * Hindi app who types English, or whose question loads a skill, gets English.
 */
function appLanguageName() {
  const code = (0, _languageCodes.canonicalizeLanguageCode)(_appLanguageStore.useAppLanguageStore.getState().appLanguage) ?? 'en';
  const match = _supportedLanguages.SUPPORTED_LANGUAGES.find(l => l.code === code) ?? _supportedLanguages.SUPPORTED_LANGUAGES.find(l => l.code === code.split('-')[0]);
  return match?.name ?? 'English';
}

/**
 * The persona the loop reasons over, read fresh EVERY turn.
 *
 * Never cached across turns: the facts table is the authority, and a cached
 * copy would let the model be told it still holds a fact the user just
 * deleted.
 */
async function buildAgentPersona(agentId, languageName = appLanguageName()) {
  const facts = await (0, _factService.getFacts)();
  return {
    // `getFacts()` is created_at DESC, and the harness keeps the FIRST n, so
    // the cap drops the OLDEST rather than the newest. Taking the last n here
    // once sent a heavy persona the 22 facts it had least recently created.
    facts: facts.map(f => ({
      id: f.id,
      statement: f.statement,
      attribute: f.questionnaireAttribute ?? null,
      places: (0, _factPlaces.describeFactPlaces)(f) ?? undefined
    })),
    surface: agentId.endsWith('ONBOARDING') ? 'ONBOARDING' : 'CONFIG',
    languageName
  };
}