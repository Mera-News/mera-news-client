"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.createAgentForContext = createAgentForContext;
var _ArticleFeedbackAgent = require("../../llm/agents/ArticleFeedbackAgent");
var _FollowStoryAgent = require("../../llm/agents/FollowStoryAgent");
var _PersonaUpdateAgent = require("../../llm/agents/PersonaUpdateAgent");
var _TutorialHelpAgent = require("../../llm/agents/TutorialHelpAgent");
var _ArticleFeedbackOnDeviceAgent = require("../../llm/agents/on-device/ArticleFeedbackOnDeviceAgent");
var _FollowStoryOnDeviceAgent = require("../../llm/agents/on-device/FollowStoryOnDeviceAgent");
var _PersonaOnDeviceAgent = require("../../llm/agents/on-device/PersonaOnDeviceAgent");
var _TutorialHelpOnDeviceAgent = require("../../llm/agents/on-device/TutorialHelpOnDeviceAgent");
// Agent registry — maps a floating-chat ChatContext to the IAgent that should
// power the session. This is the single seam for adding context-aware agents
// (article discussion, generic route help) without touching the session
// container or the inference hooks.

/** The agent for a chat context on the given engine. On-device has its own
 *  agents (prompts, schemas); the cloud ones are cloud-only. */

function createAgentForContext(context, userId, surface, kind = 'cloud') {
  if (kind === 'local') return createOnDeviceAgent(context, userId, surface);
  switch (context.kind) {
    case 'article-suggestion':
      // Also the FACT-CHECK surface. `proposeFactCheck` moved onto
      // this agent because the `Quick fact check` chip and the article tick both
      // send into the EXISTING article thread; the standalone FactCheckAgent and
      // its `fact-check` ChatContext kind are gone with it.
      return new _ArticleFeedbackAgent.ArticleFeedbackAgent(userId, {
        articleId: context.articleId,
        suggestionId: context.suggestionId
      }, context.trackSubject ?? null);
    case 'follow-story':
      // Article-less "follow a story" chat (Followed-stories FAB). Falling
      // through to the persona agent would be silently wrong: it has no
      // proposeTrack tool, so the user would be asked what to follow by the
      // seeded turn and then get persona edits instead of a scope card.
      return new _FollowStoryAgent.FollowStoryAgent(userId);
    case 'generic':
      // Route-aware product help — today, the "Ask Mera" button on a tutorial
      // slide (`tutorials/<chapter>/<slide>`).
      //
      // This used to fall through to the persona agent, and that was silently
      // wrong in the worst way: PersonaUpdateAgent's prompt tells it to redirect
      // off-profile questions AND mandates at least one `saveExtractedFacts`
      // call per turn, so "what is the Explore tab for?" got deflected AND wrote
      // to the user's profile. The popover morphed and a reply streamed, so it
      // looked like it worked. TutorialHelpAgent has NO tools at all.
      return new _TutorialHelpAgent.TutorialHelpAgent(userId, context.route);
    case 'persona':
    default:
      return new _PersonaUpdateAgent.PersonaUpdateAgent(userId, surface);
  }
}
function createOnDeviceAgent(context, userId, surface) {
  switch (context.kind) {
    case 'article-suggestion':
      return new _ArticleFeedbackOnDeviceAgent.ArticleFeedbackOnDeviceAgent(userId, {
        articleId: context.articleId,
        suggestionId: context.suggestionId
      }, context.trackSubject ?? null);
    case 'follow-story':
      return new _FollowStoryOnDeviceAgent.FollowStoryOnDeviceAgent(userId);
    case 'generic':
      return new _TutorialHelpOnDeviceAgent.TutorialHelpOnDeviceAgent(userId, context.route);
    case 'persona':
    default:
      return new _PersonaOnDeviceAgent.PersonaOnDeviceAgent(userId, surface);
  }
}