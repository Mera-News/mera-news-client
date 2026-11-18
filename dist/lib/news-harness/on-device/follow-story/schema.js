"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.TRACK_OPTIONS_SCHEMA = exports.NAMED_STORY_SCHEMA = exports.MAX_TRACK_SEARCH_WORDS = exports.MAX_OPTION_LABEL_WORDS = exports.FOLLOW_STORY_SCHEMA = void 0;
/** Word cap on an option's display label. */
const MAX_OPTION_LABEL_WORDS = exports.MAX_OPTION_LABEL_WORDS = 6;
/** Word cap on an option's hidden search query (the cloud prompt's figure). */
const MAX_TRACK_SEARCH_WORDS = exports.MAX_TRACK_SEARCH_WORDS = 8;
const TRACK_OPTION_ITEM = {
  type: 'object',
  properties: {
    label: {
      type: 'string',
      description: `The story name shown to the user, ${MAX_OPTION_LABEL_WORDS} words or fewer`
    },
    search: {
      type: 'string',
      description: `A search query of ${MAX_TRACK_SEARCH_WORDS} words or fewer`
    }
  },
  required: ['label', 'search']
};

/** The story options a follow turn offers: up to 4, none while the story is still unnamed. */
const TRACK_OPTIONS_SCHEMA = exports.TRACK_OPTIONS_SCHEMA = {
  type: 'array',
  maxItems: 4,
  description: 'Empty until the story is named; then 3 or 4, from the narrow event to the broad story',
  items: TRACK_OPTION_ITEM
};
const REPLY_FIELD = {
  type: 'string',
  description: 'One short sentence for the user'
};
const FOLLOW_STORY_SCHEMA = exports.FOLLOW_STORY_SCHEMA = {
  type: 'object',
  properties: {
    reply: REPLY_FIELD,
    options: TRACK_OPTIONS_SCHEMA
  },
  required: ['reply', 'options']
};

/**
 * The Kev writer's schema once the message names a story. AFM's guided generation holds it to 3
 * or more options (the bridge maps minItems to minimumElements): left free it often wrote one.
 * A message that names nothing keeps FOLLOW_STORY_SCHEMA, so the writer can still ask which story.
 */
const NAMED_STORY_SCHEMA = exports.NAMED_STORY_SCHEMA = {
  type: 'object',
  properties: {
    reply: REPLY_FIELD,
    options: {
      type: 'array',
      minItems: 3,
      maxItems: 4,
      description: '3 or 4, from the narrow event to the broad story',
      items: TRACK_OPTION_ITEM
    }
  },
  required: ['reply', 'options']
};