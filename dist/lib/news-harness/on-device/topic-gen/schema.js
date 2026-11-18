"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.topicGenSchema = topicGenSchema;
/** `{topics: string[]}`, at most `count` of them. An empty list is a valid answer. */
function topicGenSchema(count) {
  return {
    type: 'object',
    properties: {
      topics: {
        type: 'array',
        items: {
          type: 'string',
          description: 'A news search phrase of 1 to 5 words'
        },
        maxItems: count
      }
    },
    required: ['topics']
  };
}