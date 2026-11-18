"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.followIntentSpec = exports.FOLLOW_KEV_INTENTS = void 0;
exports.runFollowKevTurn = runFollowKevTurn;
var _kev = require("../kev");
var _shared = require("../shared");
var _moreOptions = require("./more-options");
var _nearDuplicates = require("./near-duplicates");
var _parse = require("./parse");
var _prompt = require("./prompt");
var _readerPhrase = require("./reader-phrase");
var _schema = require("./schema");
// Follow-story chat on "Kev decides, the built-in model writes".
// Kev reads the intent only (there is no second question); the built-in model
// writes the story options with the existing schema. Pure and RN-free.

const FOLLOW_KEV_INTENTS = exports.FOLLOW_KEV_INTENTS = ['follow_this_story', 'follow_a_named_story', 'question_or_other', 'agree_to_card', 'decline_card'];
const INTENT_CRITERIA = {
  follow_this_story: 'wants to follow the story already named earlier in this chat',
  follow_a_named_story: 'names a news story or subject they want to follow',
  question_or_other: 'asks a question or wants something other than following a story',
  agree_to_card: 'agrees to the change on the waiting card',
  decline_card: 'says no to the waiting card without naming another story'
};
const INTENT_LABEL_KEYS = {
  follow_a_named_story: 'kevChat.follow.follow',
  question_or_other: 'kevChat.follow.other',
  agree_to_card: 'kevChat.card.agree',
  decline_card: 'kevChat.card.decline'
};

/** Both follows write the same options, so a close call between them is not a reason to ask. */
const SAME_ACT = {
  follow_this_story: 'follow_a_named_story'
};
function intentKeys(input) {
  return FOLLOW_KEV_INTENTS.filter(k => {
    if (k === 'agree_to_card') return input.pending != null && !input.pending.tapOnly;
    // A choose-one card of story options takes no typed yes, and a plain "no" is
    // read by the consent rule before Kev. Anything longer that says no to it
    // ("no, I meant the <other story>") names another story: offering decline
    // here made Kev cancel instead of following it.
    if (k === 'decline_card') return input.pending != null && !input.pending.tapOnly;
    return true;
  });
}
const followIntentSpec = exports.followIntentSpec = {
  state: input => ({
    ...(input.pending ? {
      card_waiting: input.pending.text
    } : {}),
    conversation: input.conversation,
    user_message: input.message
  }),
  questions: input => ({
    intent: {
      type: 'choice',
      instructions: 'The user is in a chat for following a news story. What do they want with their latest message?',
      criteria: Object.fromEntries(intentKeys(input).map(k => [k, INTENT_CRITERIA[k]]))
    }
  }),
  read: answers => answers.intent
};
const REPLY_SCHEMA = {
  type: 'object',
  properties: {
    reply: {
      type: 'string',
      description: 'One or two short sentences for the user'
    }
  },
  required: ['reply']
};
function replySystem(task, languageName) {
  return `${_shared.IDENTITY_LINE}
This chat starts following a news story.
${task}
${(0, _shared.languageLine)(languageName)}`;
}
const TASK = {
  question_or_other: 'Answer briefly. If they want something other than following a story, say this chat only starts following a story.',
  agree_to_card: 'The waiting change is being applied now. Confirm it in one short sentence.',
  decline_card: 'The waiting change was dropped. Say so in one short sentence.'
};

/** One follow-story turn: decide, rules, explain, write, act. Throws only when Kev itself fails. */
async function runFollowKevTurn(input, messages, ports) {
  const chat = (0, _kev.readChat)(messages);
  const trace = (0, _kev.newTrace)();
  const done = (intent, reply, calls = []) => {
    trace.intent = trace.intent || intent;
    return {
      reply,
      calls,
      trace
    };
  };
  let intent = null;
  let line = '';
  if (chat.tap && FOLLOW_KEV_INTENTS.includes(chat.tap)) {
    intent = chat.tap;
    trace.source = 'tap';
  }
  if (!intent && input.pending) {
    const consent = (0, _kev.classifyConsent)(chat.subject);
    if (consent !== 'none') trace.source = 'rule';
    if (consent === 'apply') {
      if (input.pending.tapOnly) return done('agree_to_card', ports.t('kevChat.reply.pickOnCard'));
      intent = 'agree_to_card';
    } else if (consent === 'decline') intent = 'decline_card';else if (consent === 'acknowledge') intent = 'question_or_other';
  }
  if (!intent) {
    const base = {
      ...input,
      message: chat.subject,
      conversation: (0, _kev.conversationState)(chat.earlier)
    };
    const run = await (0, _kev.timedDecide)(trace, () => (0, _kev.runDecision)(followIntentSpec, base, ports.decide));
    const keys = Object.keys(run.questions.intent.criteria);
    trace.intent = (0, _kev.top)(run.decision, keys)?.key ?? 'question_or_other';
    const labels = Object.fromEntries(keys.flatMap(k => INTENT_LABEL_KEYS[k] ? [[k, ports.t(INTENT_LABEL_KEYS[k])]] : []));
    const ask = (0, _kev.askIfUnsure)((0, _kev.collapse)(run.decision, SAME_ACT), labels, ports.t('kevChat.askIntent'));
    if (ask) {
      trace.asked = true;
      return done(trace.intent, ports.t('kevChat.askIntent'), [ask]);
    }
    const veto = (0, _kev.vetoNegatedAgree)(trace.intent, chat.subject, run.decision, labels, ports.t('kevChat.askIntent'));
    if (veto) {
      trace.asked = veto.length > 0;
      return done(trace.intent, ports.t('kevChat.askIntent'), veto);
    }
    intent = trace.intent;
    // The two follows are one act: a close call between them reads to the writer as
    // "not named yet", and it asks again instead of writing options. Name the act plainly.
    line = intent === 'follow_a_named_story' ? `What the user wants: follow the story in their latest message: "${chat.subject.slice(0, 200)}"` : intent === 'follow_this_story' ? `What the user wants: ${INTENT_CRITERIA[intent]}` : (0, _kev.formatDecision)(run.questions, run.answers, {
      labels: {
        intent: 'What the user wants'
      }
    });
  } else {
    line = `What the user wants: ${INTENT_CRITERIA[intent]}`;
  }
  trace.intent = trace.intent || intent;
  if (intent === 'follow_this_story' || intent === 'follow_a_named_story') {
    // The existing writer: its instructions already ask which story while none is named.
    const value = await (0, _kev.write)(ports, trace, {
      system: (0, _prompt.followStoryInstructions)(input.languageName),
      schema: (0, _readerPhrase.readerPhrase)(chat.subject) ? _schema.NAMED_STORY_SCHEMA : _schema.FOLLOW_STORY_SCHEMA,
      // No waiting card here: the new options replace it, and shown its labels the
      // writer offered them again instead of the story the user just named.
      context: `Option rules: ${_prompt.TRACK_OPTION_RULES}\n\n${(0, _kev.decisionBlock)(line)}\n\n${(0, _prompt.followStoryContext)({
        today: input.today,
        pending: null
      })}`,
      history: chat.history
    });
    if (!value) return done(intent, ports.t('kevChat.reply.followFailed'));
    // AFM writes one story several times over: its near-copies go, and a card left thin is refilled once.
    const written = Array.isArray(value.options) ? (0, _nearDuplicates.dropNearDuplicates)(value.options.map(o => ({
      label: (0, _shared.text)(o?.label),
      search: (0, _shared.text)(o?.search)
    }))) : [];
    const calls = (0, _parse.proposeTrackCalls)(written, {
      message: chat.subject,
      appIsEnglish: input.languageName === 'English'
    });
    const card = calls[0]?.input;
    if (card && card.options.length < 3) {
      const shown = card.options.map(o => ({
        label: o.label,
        searchText: o.search
      }));
      const more = await (0, _moreOptions.writeMoreTrackOptions)({
        today: input.today,
        shown,
        room: 4 - shown.length
      }, ports);
      card.options = (0, _nearDuplicates.dropNearDuplicates)([...card.options, ...(more ?? [])], card.options.length).slice(0, 4);
    }
    return done(intent, (0, _kev.replyOr)(value, ports.t('kevChat.reply.followFailed')), calls);
  }
  const value = await (0, _kev.write)(ports, trace, {
    system: replySystem(TASK[intent], input.languageName),
    schema: REPLY_SCHEMA,
    context: `${(0, _kev.decisionBlock)(line)}\n\n${(0, _prompt.followStoryContext)({
      today: input.today,
      pending: input.pending?.text ?? null
    })}`,
    history: chat.history
  });
  if (intent === 'agree_to_card') {
    return done(intent, (0, _kev.replyOr)(value, ports.t('kevChat.reply.applied')), [{
      name: 'applyProposal',
      input: {}
    }]);
  }
  if (intent === 'decline_card') {
    return done(intent, (0, _kev.replyOr)(value, ports.t('kevChat.reply.cancelled')), [{
      name: 'cancelProposal',
      input: {}
    }]);
  }
  return done(intent, (0, _kev.replyOr)(value, ports.t('kevChat.reply.chat')));
}