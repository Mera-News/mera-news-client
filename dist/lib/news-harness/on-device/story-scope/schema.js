"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.STORY_SCOPE_SCHEMA = void 0;
const STORY_SCOPE_SCHEMA = exports.STORY_SCOPE_SCHEMA = {
  type: 'object',
  properties: {
    label: {
      type: 'string',
      description: "The story's name for the reader, 5 words or fewer"
    },
    search: {
      type: 'string',
      description: 'A search query of 8 words or fewer'
    }
  },
  required: ['label', 'search']
};