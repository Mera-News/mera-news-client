"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.SUPPRESSION_KINDS = void 0;
// news-harness — canonical shared types for the AI-flow system.
//
// This is the single home for the types that used to live scattered across
// lib/llm/types.ts, lib/llm/cloudComplete.ts, the article-suggestion service,
// and the scoring service. Old sites now re-export from here so no importer
// changes.

// ---------------------------------------------------------------------------
// Batch completion primitives (moved from lib/llm/types.ts + cloudComplete.ts)
// ---------------------------------------------------------------------------

/** One entry in a batched LLM completion request. */

/** OpenAI JSON-Schema tool definition (sent to the cloud backend). */

/** One decoded result of a batched completion. */

// ---------------------------------------------------------------------------
// Scoring pipeline types (moved from article-suggestion-service + scoring-service)
// ---------------------------------------------------------------------------

/** The persona-v3 scorer-input metadata columns of an article_suggestion row,
 *  as raw (still-JSON) strings. Plain/self-contained — buildStageCandidateInput
 *  (in the RN service) parses these into a ScoredCandidateInput. Populated by
 *  the persona-v3 hydration path; absent/null on old rows → backstop routing. */

/** A single article_suggestion joined with its linked facts — the input to
 *  relevance scoring. WMDB row id == server `_id`. */

/** Output of a single scoring pass for one candidate. */

/** A bundle of BatchCalls plus the lookups needed to decode their results
 *  back into per-candidate maps. */

/** Per-candidate maps decoded from a BatchCompletionResult[]. */

// ---------------------------------------------------------------------------
// News API shape — mirrors the `articlesForTopicsByIds` GraphQL selection set
// (ArticleWithClusters in lib/generated/graphql-types.ts).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Agent proposal types (moved from lib/llm/types.ts — the article-feedback
// agent's portable brain lives in the harness as of Phase 3A). lib/llm/types.ts
// re-exports these so no importer changes.
// ---------------------------------------------------------------------------

/**
 * What a "not interested" filter matches against. RUNTIME mirror of
 * `SUPPRESSION_KINDS` in `lib/database/models/PersonaSuppression` (duplicated so
 * the harness stays RN-free / DB-free), and of the type-only mirror
 * `SuppressionKind` in `lib/news-harness/scoring-engine/persona-context.ts`.
 * ORDER IS LOAD-BEARING — the agent tool schemas expose this array verbatim as a
 * JSON-Schema `enum` and their tests assert it with an order-sensitive toEqual.
 *
 * `keyword` matches as a normalized SUBSTRING over title + description +
 * entities. Every other kind is an EXACT normalized equality test against one
 * article field (category / eventType / entities[] / publicationName / geoTags /
 * matched topic text) — so an invented value silently never fires. An absent
 * kind reads as `keyword`.
 */
const SUPPRESSION_KINDS = exports.SUPPRESSION_KINDS = ['keyword', 'category', 'event_type', 'entity', 'publication', 'place', 'topic'];

/** One ACTIVE "not interested" filter as the chat agents see it — the minimal
 *  plain projection of a `persona_suppressions` row (no WatermelonDB model).
 *  Rendered into <context> so the agent can offer to REMOVE one, and used to
 *  validate a `retire_suppression` proposal's `suppressionId`. */

/** A single deterministic change the proposal executor can apply to the persona.
 *
 *  The first group is the legacy fact/topic-CRUD set (applied directly against
 *  fact-service). The second group is the rails-backed set — routed
 *  through `applyPersonaAction` so each mints an invertible persona_change_log
 *  row. These reference topics by TEXT and publications by NAME (the feedback
 *  context only exposes those, never ids); the RN executor resolves text→id. */

/** Serializable origin snapshot for a `track_story` action — the minimal subset
 *  of the RN `FeedbackSubject` that trackStoryWithProposal needs. Kept here (not
 *  imported from components/) so the harness stays RN-free; structurally
 *  assignable from a full FeedbackSubject. */

/** Serializable article snapshot for a `fact_check_claim` action — the minimal
 *  subset the on-device fact-check runner needs, with field names that map 1:1
 *  onto `enqueueFactCheck`'s parameters so the executor forwards it unchanged.
 *
 *  Deliberately NOT reused from `TrackFeedbackSubject`: that one carries `title`
 *  where this carries `articleTitle`, and two structurally-similar shapes with
 *  different consumers would typecheck into a call with an empty title. */

/** A proposal staged by the LLM and awaiting user confirmation. */

/** Result of an agent tool execution — a plain result map plus optional
 *  side effects the chat hook interprets (block, stage a proposal, resolve one). */

// ---------------------------------------------------------------------------
// Article-feedback context types — the plain inputs buildFeedbackContext is
// re-signed over (no store/DB/RN dependency).
// ---------------------------------------------------------------------------

/** Plain suggestion snapshot the feedback context is built from. Mirrors the
 *  fields the agent reads off the WatermelonDB `ForYouSuggestion` row. */

/** A suggestion joined with its matched topics and producing facts — the
 *  article-feedback equivalent of getSuggestionFeedbackContext's return.
 *
 *  `matchedTopicTexts` and `linkedFacts[].statement` are deliberately NOT
 *  branded, and that is not an unfinished job. `asUntrusted` is specifically the
 *  PUBLISHER boundary: these two are the user's OWN topics and persona facts,
 *  written on this device, so branding them would assert something false about
 *  where they came from and would hide the one distinction the brand exists to
 *  make. Everything on this type that IS publisher-derived is branded. */

/** Plain inputs to buildFeedbackContext — everything the agent has already
 *  read from the DB / stores. */

/** What the feedback sheet hands the chat (`ChatContext.feedbackAnswers`).
 *  `question` and `answer` are the localized labels the reader saw. */

/** One on-device "Mera's mistake" (`getRecentSystemMistakes`). */