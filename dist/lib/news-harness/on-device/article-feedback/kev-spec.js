"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.articleTopicSpec = exports.articleIntentSpec = exports.ARTICLE_KEV_INTENTS = void 0;
exports.runArticleKevTurn = runArticleKevTurn;
var _kev = require("../kev");
var _prompt = require("../follow-story/prompt");
var _schema = require("../follow-story/schema");
var _identity = require("../../../mera-harness/core/identity");
var _shared = require("../shared");
var _parse = require("./parse");
var _prompt2 = require("./prompt");
// Article chat on "Kev decides, the built-in model writes". Kev
// reads the intent and, for less or more, which matched topic (replacing the
// old silent first-topic fallback). The built-in model writes the reply, the
// story options or the change's effect line. The acts are the cloud chat's
// executors via articleFeedbackTurn. Pure and RN-free.

const ARTICLE_KEV_INTENTS = exports.ARTICLE_KEV_INTENTS = ['answer_question', 'follow_story', 'see_less', 'see_more', 'mute_source', 'agree_to_card', 'decline_card'];
const INTENT_CRITERIA = {
  answer_question: 'asks a question about the article: what happened, whether it is true, what is new, or why Mera showed it',
  follow_story: 'asks to follow this story and get updates on it',
  see_less: 'wants fewer articles on this subject, or on one of matched_topics',
  see_more: 'wants more articles on this subject, or on one of matched_topics',
  mute_source: 'wants nothing more from this publication or website',
  agree_to_card: 'agrees to the change on the waiting card',
  decline_card: 'declines the change on the waiting card'
};
const INTENT_LABEL_KEYS = {
  answer_question: 'kevChat.article.answer',
  follow_story: 'kevChat.article.follow',
  see_less: 'kevChat.article.less',
  see_more: 'kevChat.article.more',
  mute_source: 'kevChat.article.mute',
  agree_to_card: 'kevChat.card.agree',
  decline_card: 'kevChat.card.decline'
};

/** The single-call intents the executors map from. */
const ACT = {
  answer_question: 'answer',
  follow_story: 'track',
  see_less: 'less',
  see_more: 'more',
  mute_source: 'mute',
  agree_to_card: 'confirm',
  decline_card: 'cancel'
};

/** The same six topics the single-call prompt shows. */
const MAX_TOPICS = 6;
const topics = input => input.context.matchedTopics.slice(0, MAX_TOPICS);
function intentKeys(input) {
  const c = input.context;
  return ARTICLE_KEV_INTENTS.filter(k => {
    if (k === 'mute_source') return Boolean(c.publication);
    if (k === 'agree_to_card') return c.pending != null && !input.pendingTapOnly;
    if (k === 'decline_card') return c.pending != null;
    return true;
  });
}
function state(input) {
  const c = input.context;
  return {
    article: {
      title: c.title,
      ...(c.publication ? {
        publication: c.publication
      } : {}),
      ...(c.description ? {
        description: c.description.slice(0, 300)
      } : {})
    },
    matched_topics: topics(input),
    ...(c.alreadyFollowing ? {
      already_following: true
    } : {}),
    ...(c.pending ? {
      card_waiting: c.pending
    } : {}),
    conversation: input.conversation,
    user_message: input.message
  };
}
const articleIntentSpec = exports.articleIntentSpec = {
  state,
  questions: input => ({
    intent: {
      type: 'choice',
      instructions: 'What does the user want Mera to do with user_message about this article?',
      criteria: Object.fromEntries(intentKeys(input).map(k => [k, INTENT_CRITERIA[k]]))
    }
  }),
  read: answers => answers.intent
};

/** Topic keys t1..tN in shown order. */
const topicKey = i => `t${i + 1}`;
const articleTopicSpec = exports.articleTopicSpec = {
  state,
  questions: input => ({
    topic: {
      type: 'choice',
      instructions: input.intent === 'see_less' ? 'Which of the matched topics does the user want less of?' : 'Which of the matched topics does the user want more of?',
      criteria: Object.fromEntries(topics(input).map((t, i) => [topicKey(i), t]))
    }
  }),
  read: answers => answers.topic
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
const CHANGE_SCHEMA = {
  type: 'object',
  properties: {
    reply: {
      type: 'string',
      description: 'One or two short sentences for the user'
    },
    expected_effects: {
      type: 'string',
      description: 'One short sentence on what changes in the feed'
    }
  },
  required: ['reply', 'expected_effects']
};
const FOLLOW_SCHEMA = {
  type: 'object',
  properties: {
    reply: {
      type: 'string',
      description: 'One short line asking the user to pick a story below'
    },
    options: _schema.TRACK_OPTIONS_SCHEMA
  },
  required: ['reply', 'options']
};
const TASK = {
  answer_question: 'Explain why it was suggested, or answer from what you see. Fact checks and web searches need Private cloud, so say that if asked.',
  follow_story: 'Give 3 or 4 options to follow this story, following the option rules, using names from the article.',
  see_less: 'A card asks the user to confirm seeing less of the topic. Point to the card and say what changes.',
  see_more: 'A card asks the user to confirm seeing more of the topic. Point to the card and say what changes.',
  mute_source: 'A card asks to mark this publication Not preferred. Point to the card.',
  agree_to_card: 'The waiting change is being applied now. Confirm it in one short sentence.',
  decline_card: 'The waiting change was dropped. Say so in one short sentence.'
};
const ALREADY_FOLLOWING_TASK = 'The user already follows this story, so nothing changes. Say so in one short sentence.';
function writerSystem(task, languageName) {
  return `${_shared.IDENTITY_LINE}
The user is asking about one news article Mera suggested. You see only its title, publication and a short description, never the full text. ${_identity.PUBLISHERS_LINE}
${task}
${(0, _shared.languageLine)(languageName)}`;
}

/** One article chat turn: decide, rules, explain, write, act. Throws only when Kev itself fails. */
async function runArticleKevTurn(input, messages, ports) {
  const chat = (0, _kev.readChat)(messages);
  const trace = (0, _kev.newTrace)();
  const shown = topics(input);
  const base = {
    ...input,
    message: chat.subject,
    conversation: (0, _kev.conversationState)(chat.earlier)
  };
  const facts = {
    matchedTopics: shown,
    publication: input.context.publication ?? null,
    hasPending: input.context.pending != null
  };
  const done = (intent, reply, calls = []) => {
    trace.intent = trace.intent || intent;
    return {
      reply,
      calls,
      trace
    };
  };

  // --- Decide ---------------------------------------------------------------
  let intent = null;
  let tapTopic = null;
  const lines = [];
  if (chat.tap) {
    // `intent` or `intent:<topic text>`: the text, so a changed topic list cannot shift it.
    const sep = chat.tap.indexOf(':');
    const tapIntent = sep === -1 ? chat.tap : chat.tap.slice(0, sep);
    if (ARTICLE_KEV_INTENTS.includes(tapIntent)) {
      intent = tapIntent;
      tapTopic = sep === -1 ? null : chat.tap.slice(sep + 1);
      trace.source = 'tap';
    }
  }
  if (!intent && input.context.pending) {
    const consent = (0, _kev.classifyConsent)(chat.subject);
    if (consent !== 'none') trace.source = 'rule';
    if (consent === 'apply') {
      if (input.pendingTapOnly) return done('agree_to_card', ports.t('kevChat.reply.pickOnCard'));
      intent = 'agree_to_card';
    } else if (consent === 'decline') intent = 'decline_card';else if (consent === 'acknowledge') intent = 'answer_question';
  }
  if (!intent) {
    const run = await (0, _kev.timedDecide)(trace, () => (0, _kev.runDecision)(articleIntentSpec, base, ports.decide));
    const keys = Object.keys(run.questions.intent.criteria);
    trace.intent = (0, _kev.top)(run.decision, keys)?.key ?? 'answer_question';
    const labels = Object.fromEntries(keys.map(k => [k, ports.t(INTENT_LABEL_KEYS[k])]));
    const ask = (0, _kev.askIfUnsure)(run.decision, labels, ports.t('kevChat.askIntent'));
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
    lines.push((0, _kev.formatDecision)(run.questions, run.answers, {
      labels: {
        intent: 'What the user wants'
      }
    }));
  } else {
    lines.push(`What the user wants: ${INTENT_CRITERIA[intent]}`);
  }
  trace.intent = trace.intent || intent;

  // --- Which topic, for less or more ---------------------------------------
  let topic = null;
  if (intent === 'see_less' || intent === 'see_more') {
    const which = intent;
    if (tapTopic && shown.includes(tapTopic)) topic = tapTopic;else if (shown.length === 1) topic = shown[0];else if (shown.length > 1) {
      const run = await (0, _kev.timedDecide)(trace, () => (0, _kev.runDecision)(articleTopicSpec, {
        ...base,
        intent: which
      }, ports.decide));
      const labels = Object.fromEntries(shown.map(t => [`${which}:${t}`, t]));
      const scoped = {
        probabilities: Object.fromEntries(Object.entries(run.decision.probabilities).flatMap(([k, p]) => {
          const t = shown[Number(k.slice(1)) - 1];
          return t ? [[`${which}:${t}`, p]] : [];
        }))
      };
      const ask = (0, _kev.askIfUnsure)(scoped, labels, ports.t('kevChat.askTopic'));
      if (ask) {
        trace.asked = true;
        return done(intent, ports.t('kevChat.askTopic'), [ask]);
      }
      const best = (0, _kev.top)(run.decision, Object.keys(run.questions.topic.criteria));
      topic = best ? shown[Number(best.key.slice(1)) - 1] ?? null : null;
      lines.push((0, _kev.formatDecision)(run.questions, run.answers, {
        labels: {
          topic: 'The topic they mean'
        }
      }));
    }
    if (topic && topic === tapTopic) lines.push(`The topic they mean: ${topic}`);
  }

  // --- Explain, write, act ---------------------------------------------------
  // Follow stays an option once the story is followed: left out, Kev read "follow this"
  // as the next best act (more of this). It now gets a reply and stages nothing.
  if (intent === 'follow_story' && input.context.alreadyFollowing) {
    const value = await (0, _kev.write)(ports, trace, {
      system: writerSystem(ALREADY_FOLLOWING_TASK, input.languageName),
      schema: REPLY_SCHEMA,
      context: `${(0, _kev.decisionBlock)(lines.join('\n'))}\n\n${(0, _prompt2.articleChatContext)(input.context)}`,
      history: chat.history
    });
    trace.intent = 'answer_question'; // the act: an answer, nothing staged
    return done('answer_question', (0, _kev.replyOr)(value, ports.t('kevChat.reply.chat')));
  }
  // Less or more with no matched topic stages nothing: the old first-topic guess is gone.
  const noTopic = (intent === 'see_less' || intent === 'see_more') && !topic;
  const task = noTopic ? TASK.answer_question : TASK[intent];
  const schema = noTopic ? REPLY_SCHEMA : intent === 'follow_story' ? FOLLOW_SCHEMA : intent === 'see_less' || intent === 'see_more' ? CHANGE_SCHEMA : REPLY_SCHEMA;
  const optionRules = intent === 'follow_story' ? `Option rules: ${_prompt.TRACK_OPTION_RULES}\n\n` : '';
  const value = await (0, _kev.write)(ports, trace, {
    system: writerSystem(task, input.languageName),
    schema,
    context: `${optionRules}${(0, _kev.decisionBlock)(lines.join('\n'))}\n\n${(0, _prompt2.articleChatContext)(input.context)}`,
    history: chat.history
  });
  if (noTopic) return done(intent, (0, _kev.replyOr)(value, ports.t('kevChat.reply.chat')));
  if (intent === 'follow_story' && !value) return done(intent, ports.t('kevChat.reply.followFailed'));
  const fallback = intent === 'agree_to_card' ? 'kevChat.reply.applied' : intent === 'decline_card' ? 'kevChat.reply.cancelled' : intent === 'answer_question' ? 'kevChat.reply.chat' : intent === 'follow_story' ? 'kevChat.reply.followFailed' : 'kevChat.reply.changeCard';
  const reply = (0, _kev.replyOr)(value, ports.t(fallback));
  const turn = (0, _parse.articleFeedbackTurn)({
    intent: ACT[intent],
    reply,
    options: value?.options,
    ...(topic ? {
      change: {
        topicText: topic,
        expected_effects: (0, _shared.text)(value?.expected_effects) || reply
      }
    } : {})
  }, facts);
  // "Pick a story below" with no options under it would point at nothing.
  if (intent === 'follow_story' && turn.calls.length === 0) return done(intent, ports.t('kevChat.reply.followFailed'));
  return done(intent, turn.reply, turn.calls);
}