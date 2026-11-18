"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ARTICLE_INTENTS = exports.ARTICLE_FEEDBACK_SCHEMA = void 0;
var _schema = require("../follow-story/schema");
const ARTICLE_INTENTS = exports.ARTICLE_INTENTS = ['answer', 'track', 'less', 'more', 'mute', 'confirm', 'cancel'];
const ARTICLE_FEEDBACK_SCHEMA = exports.ARTICLE_FEEDBACK_SCHEMA = {
  type: 'object',
  properties: {
    intent: {
      type: 'string',
      enum: [...ARTICLE_INTENTS]
    },
    reply: {
      type: 'string',
      description: 'One or two short sentences for the user'
    },
    options: _schema.TRACK_OPTIONS_SCHEMA,
    change: {
      type: 'object',
      description: 'Only for less or more',
      properties: {
        topicText: {
          type: 'string',
          description: 'One topic copied from Matched topics'
        },
        expected_effects: {
          type: 'string',
          description: 'One short sentence on what changes in the feed'
        }
      },
      required: ['topicText', 'expected_effects']
    }
  },
  required: ['intent', 'reply']
};