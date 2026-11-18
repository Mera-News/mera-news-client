"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.articleChatContext = articleChatContext;
exports.articleFeedbackInstructions = articleFeedbackInstructions;
exports.buildArticleFeedbackPrompt = buildArticleFeedbackPrompt;
var _untrustedText = require("../../prompts/untrusted-text");
var _prompt = require("../follow-story/prompt");
var _shared = require("../shared");
var _slots = require("../../../harnesses/slots");
var _template = require("../../../harnesses/template");
function articleFeedbackInstructions(languageName) {
  const language = (0, _shared.languageLine)(languageName);
  return (0, _template.render)(_slots.DEVICE_SLOTS["article-chat/instructions"], {
    IDENTITY_LINE: _shared.IDENTITY_LINE,
    language
  });
}

/** Everything the context block shows, already read by the adapter. */

const u = (value, max) => (0, _untrustedText.asUntrusted)(value, max);
const list = (items, max, each) => items.length > 0 ? items.slice(0, max).map(i => `- ${u(i, each)}`).join('\n') : 'None';
function articleChatContext(c) {
  const article = [`Title: ${u(c.title, 160)}`];
  if (c.published) article.push(`Published: ${c.published}`);
  if (c.publication) article.push(`Publication: ${u(c.publication, 80)}`);
  if (c.description) article.push(`Description: ${u(c.description, 300)}`);
  if (c.category) article.push(`Category: ${u(c.category, 60)}`);
  if (c.entities?.length) article.push(`Names: ${c.entities.slice(0, 8).map(e => u(e, 60)).join(', ')}`);
  const blocks = [`Today: ${c.today}`, `Article:\n${article.join('\n')}`];
  blocks.push(c.relevance == null ? 'Not scored yet.' : `Relevance: ${Math.min(10, c.relevance * 10).toFixed(1)} out of 10.${c.note ? ` Note: ${u(c.note, 200)}` : ''}`);
  blocks.push(`Matched topics:\n${list(c.matchedTopics, 6, 80)}`);
  blocks.push(`Your facts behind them:\n${list(c.producingFacts, 6, 160)}`);
  if (c.relatedCoverage.length > 0) blocks.push(`Related coverage:\n${list(c.relatedCoverage, 5, 120)}`);
  if (c.alreadyFollowing) blocks.push('The user already follows this story, so do not offer options again.');
  if (c.verdict) blocks.push(c.verdict === 'like' ? 'The user liked this article.' : 'The user disliked this article.');
  if (c.pending) blocks.push(c.pending);
  if (c.answers?.length) blocks.push(`The user's feedback${c.screen ? ` on the ${u(c.screen, 40)} screen` : ''}:\n${list(c.answers, 6, 200)}`);
  if (c.mistakes?.length) blocks.push(`Recent mistakes the user reported:\n${list(c.mistakes, 3, 200)}`);
  return blocks.join('\n\n');
}
function buildArticleFeedbackPrompt(context, history, budgetTokens) {
  return (0, _shared.renderPrompt)(`Option rules: ${_prompt.TRACK_OPTION_RULES}\n\n${articleChatContext(context)}`, history, budgetTokens);
}