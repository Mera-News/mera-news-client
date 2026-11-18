"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.capitalised = exports.STAKE_RULE = exports.STAKE_CHECK_CALL = void 0;
exports.decodeStakeCheck = decodeStakeCheck;
exports.stakeCheckRequest = stakeCheckRequest;
var _stakeHandover = require("../../mera-harness/core/stake-handover");
var _toolContracts = require("../../mera-harness/core/tool-contracts");
// news-harness — the daily sweep's AI check: does this saved fact touch the
// reader's life? PURE, RN-free. Volume alone cannot tell a stake from a flood.
//
// The rule is the chat save's own sentence, read off its tool contract, so the
// two can never drift. A missing or malformed answer is a stake: the check only
// ever proposes, and no offer is the safe side.

const SAVE_INTEREST = _toolContracts.SAVE_INTEREST_FACTS_TOOL.function;

/** What the interest save adds to the plain save's description. */
const STAKE_RULE = exports.STAKE_RULE = SAVE_INTEREST.description.slice(_toolContracts.SAVE_FACTS_TOOL.function.description.length).trim();
const SUBJECT_RULE = SAVE_INTEREST.parameters.properties.extracted_user_information.items.properties.story_subject.description;

/** Sent once per candidate, on the shared small model with thinking off. */
const STAKE_CHECK_CALL = exports.STAKE_CHECK_CALL = {
  maxTokens: 120,
  temperature: 0
};
function stakeCheckRequest(statement) {
  return {
    systemPrompt: 'You read one fact saved about a reader of a news app. The fact is written about them, so "they said" means the fact says. ' + `${STAKE_RULE}\n` + 'Being a fan is liking it: "Supports Ajax", "Follows PSV", "Fan of Manchester United" and "Interested in cryptocurrency" are false. ' + 'A job, studies, a home, an illness, a relative, a trip or money they hold is always true: "Is a nurse", "Has asthma", "Sister lives in Pune" and "Owns a house in Porto" are true.\n' + `story_subject: ${SUBJECT_RULE} Taken from the fact, never made up.\n` + 'search: the same subject in English, as a news search.\n' + 'Answer with JSON only: {"has_stake":true or false,"story_subject":"...","search":"..."}',
    prompt: `Fact: ${JSON.stringify(statement)}`
  };
}
const STAKE = {
  hasStake: true,
  subject: null,
  search: null
};
const wordsOf = s => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** Facts are stored in English, so a subject shares a word with its fact. The
 *  model handing the fact back whole is a phrase about the reader, and one
 *  sharing nothing is made up: it once answered "Formula 1" for a nurse. */
function usable(value, statement) {
  if (!(0, _stakeHandover.isUsableSubject)(value, statement)) return false;
  if (value.trim().toLowerCase() === statement.trim().toLowerCase()) return false;
  const said = new Set(wordsOf(statement));
  return wordsOf(value).some(w => said.has(w));
}

/** A topic is often lower case; a story's name on screen is not. */
const capitalised = s => s.charAt(0).toLocaleUpperCase() + s.slice(1);
exports.capitalised = capitalised;
function decodeStakeCheck(raw, statement) {
  const match = (raw ?? '').match(/\{[\s\S]*\}/);
  if (!match) return STAKE;
  let answer;
  try {
    answer = JSON.parse(match[0]);
  } catch {
    return STAKE;
  }
  if (answer?.has_stake !== false) return STAKE;
  const subject = usable(answer.story_subject, statement) ? capitalised(answer.story_subject.trim()) : null;
  const search = (0, _stakeHandover.isUsableSubject)(answer.search, statement) ? answer.search.trim() : subject;
  return {
    hasStake: false,
    subject,
    search
  };
}