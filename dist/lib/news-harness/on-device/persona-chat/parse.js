"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.personaChatTurn = personaChatTurn;
var _shared = require("../shared");
/**
 * The fields to PersonaUpdateAgent's executors: saveExtractedFacts (which only
 * stages fact cards), deleteUserFacts, applyProposal and cancelProposal.
 */
function personaChatTurn(value, facts) {
  const calls = [];
  const save = (value.save ?? []).map(s => ({
    statement: (0, _shared.text)(s?.statement),
    questionnaire_attribute: (0, _shared.text)(s?.attribute) || 'other'
  })).filter(s => s.statement.length > 0);
  if (save.length > 0) calls.push({
    name: 'saveExtractedFacts',
    input: {
      extracted_user_information: save
    }
  });
  const remove = [...new Set((value.delete ?? []).map(_shared.text))].filter(id => facts.factIds.has(id));
  if (remove.length > 0) calls.push({
    name: 'deleteUserFacts',
    input: {
      fact_ids: remove
    }
  });
  if (facts.hasPending && value.confirm === true) calls.push({
    name: 'applyProposal',
    input: {}
  });else if (facts.hasPending && value.cancel === true) calls.push({
    name: 'cancelProposal',
    input: {}
  });
  return {
    reply: (0, _shared.text)(value.reply),
    calls
  };
}