"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.personaChatSchema = personaChatSchema;
const SAVE = {
  type: 'array',
  maxItems: 6,
  description: 'New facts the user just shared; empty when there are none',
  items: {
    type: 'object',
    properties: {
      statement: {
        type: 'string',
        description: 'One short fact in English'
      },
      attribute: {
        type: 'string',
        description: 'A short label, category: detail'
      }
    },
    required: ['statement', 'attribute']
  }
};

/** Onboarding has no facts to remove yet, so its schema has no `delete`. */
function personaChatSchema(surface) {
  return {
    type: 'object',
    properties: {
      reply: {
        type: 'string',
        description: 'Under 200 characters, at most one question'
      },
      save: SAVE,
      ...(surface === 'CONFIG' ? {
        delete: {
          type: 'array',
          maxItems: 6,
          items: {
            type: 'string'
          },
          description: 'Fact ids to remove'
        }
      } : {}),
      confirm: {
        type: 'boolean',
        description: 'True only when the user agrees to a waiting change'
      },
      cancel: {
        type: 'boolean',
        description: 'True only when the user declines a waiting change'
      }
    },
    required: ['reply', 'save']
  };
}