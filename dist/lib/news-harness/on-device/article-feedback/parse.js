"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.articleFeedbackTurn = articleFeedbackTurn;
var _parse = require("../follow-story/parse");
var _shared = require("../shared");
/** A small step either way; the executor clamps to its own limit. */
const TOPIC_WEIGHT_STEP = 0.3;
/** The model's topic when it is one of the matched topics, else the first matched topic. */
function pickTopic(raw, matched) {
  const wanted = raw.toLowerCase();
  return matched.find(t => t.toLowerCase() === wanted) ?? matched[0] ?? null;
}

/**
 * Each intent to the executors the cloud chat calls: proposeTrack, proposeChanges
 * (which stages a card), applyProposal and cancelProposal. Anything the reply
 * cannot back (no matched topic, no publication, no pending card) stages
 * nothing and leaves just the reply.
 */
function articleFeedbackTurn(value, facts) {
  const reply = (0, _shared.text)(value.reply);
  const change = (actions, chooseOne = false) => [{
    name: 'proposeChanges',
    input: {
      explanation: reply,
      expected_effects: (0, _shared.text)(value.change?.expected_effects) || reply,
      ...(chooseOne ? {
        choose_one: true
      } : {}),
      actions
    }
  }];
  const topic = pickTopic((0, _shared.text)(value.change?.topicText), facts.matchedTopics);
  let calls = [];
  switch (value.intent) {
    case 'track':
      calls = (0, _parse.proposeTrackCalls)(value.options);
      break;
    case 'less':
      if (topic) {
        calls = change([{
          type: 'set_topic_weight',
          topicText: topic,
          delta: -TOPIC_WEIGHT_STEP
        }, {
          type: 'retire_topic',
          topicText: topic
        }], true);
      }
      break;
    case 'more':
      if (topic) calls = change([{
        type: 'set_topic_weight',
        topicText: topic,
        delta: TOPIC_WEIGHT_STEP
      }]);
      break;
    case 'mute':
      if (facts.publication) {
        calls = change([{
          type: 'set_publication_pref',
          publicationId: facts.publication,
          publicationPref: 'mute'
        }]);
      }
      break;
    case 'confirm':
      if (facts.hasPending) calls = [{
        name: 'applyProposal',
        input: {}
      }];
      break;
    case 'cancel':
      if (facts.hasPending) calls = [{
        name: 'cancelProposal',
        input: {}
      }];
      break;
    case 'answer':
      break;
  }
  return {
    reply,
    calls
  };
}