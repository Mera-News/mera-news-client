"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.assertPersonaOwner = assertPersonaOwner;
exports.clearUserPersona = clearUserPersona;
exports.loadUserPersona = loadUserPersona;
exports.persistUserPersona = persistUserPersona;
var _watermelondb = require("@nozbe/watermelondb");
var _index = _interopRequireDefault(require("../index"));
var _graphqlTypes = require("../../generated/graphql-types");
var _logger = _interopRequireDefault(require("../../logger"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// User Persona Service — persists/hydrates UserPersona (without topics).

const personasCol = _index.default.get('user_personas');

// --- Persist ---

async function persistUserPersona(userId, persona) {
  await _index.default.write(async () => {
    // Wipe ALL personas — only one user's data should ever live on-device at a
    // time. This prevents orphaned persona data from accumulating when the
    // server-side user ID changes.
    const existingPersonas = await personasCol.query().fetch();
    const deleteOps = existingPersonas.map(p => p.prepareDestroyPermanently());
    if (deleteOps.length > 0) {
      await _index.default.batch(deleteOps);
    }
    await _index.default.batch([personasCol.prepareCreate(r => {
      r.serverId = persona._id;
      r.userId = userId;
      r.processingMode = persona.processingMode;
      r.onboardingStage = persona.onboardingStage;
      r.blockedByLlm = persona.blockedByLlm;
      r.blockedByLlmReason = persona.blockedByLlmReason ?? null;
      r.llmWarningCount = persona.llmWarningCount;
      r.notificationsEnabled = persona.notificationsEnabled ?? false;
      r.preferredNotificationWindow = persona.preferredNotificationWindow;
      r.languageCodes = persona.language_codes ?? null;
      r.createdAt = new Date(toTimestamp(persona.createdAt));
      r.updatedAt = new Date(toTimestamp(persona.updatedAt));
    })]);
  });
}

// --- Hydrate ---

async function loadUserPersona(userId) {
  const personas = await personasCol.query(_watermelondb.Q.where('user_id', userId)).fetch();
  if (personas.length === 0) return null;
  const persona = personas[0];
  return {
    _id: persona.serverId,
    userId: persona.userId,
    processingMode: toProcessingMode(persona.processingMode),
    onboardingStage: toOnboardingStage(persona.onboardingStage),
    blockedByLlm: persona.blockedByLlm,
    blockedByLlmReason: persona.blockedByLlmReason,
    llmWarningCount: persona.llmWarningCount,
    notificationsEnabled: persona.notificationsEnabled,
    preferredNotificationWindow: persona.preferredNotificationWindow,
    language_codes: persona.languageCodes,
    createdAt: persona.createdAt.toISOString(),
    updatedAt: persona.updatedAt.toISOString()
  };
}

// --- Clear ---

async function clearUserPersona() {
  await _index.default.write(async () => {
    const allPersonas = await personasCol.query().fetch();
    if (allPersonas.length > 0) {
      await _index.default.batch(allPersonas.map(p => p.prepareDestroyPermanently()));
    }
  });
}

// --- Ownership alarm ---

/**
 * Does a persona row on this device belong to somebody OTHER than `ownerId`?
 *
 * A cheap second opinion on the question `cached_user_id` normally answers.
 * `user_personas` is the only one of the six user-data tables with a `user_id`
 * column, and it is indexed, so this is one query — but it is positive evidence
 * of contamination even when `cached_user_id` was lost or overwritten, which is
 * exactly the failure the cross-user leak was made of.
 *
 * IT CAN ONLY EVER CONFIRM, NEVER CLEAR. `persistUserPersona` is called
 * fire-and-forget from the user store, so a perfectly clean device can hold
 * zero persona rows — "no mismatch found" therefore proves nothing at all.
 * Treat `true` as a reason to force a wipe; never treat `false` as permission
 * to skip one, and never make this the gate. `hasAnyFacts()` plus a correct,
 * fail-closed wipe remains the gate.
 *
 * Returns `false` on any read failure, for the same reason: an unanswerable
 * question is not evidence.
 */
async function assertPersonaOwner(ownerId) {
  if (!ownerId) return false;
  try {
    const foreign = await personasCol.query(_watermelondb.Q.where('user_id', _watermelondb.Q.notEq(ownerId))).fetchCount();
    if (foreign > 0) {
      _logger.default.captureMessage('Persona rows on this device belong to a different user', {
        level: 'error',
        tags: {
          source: 'user-persona-service'
        },
        extra: {
          foreignRowCount: foreign
        }
      });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// --- Helpers ---

function toProcessingMode(value) {
  return value === _graphqlTypes.ProcessingMode.OnDevice ? _graphqlTypes.ProcessingMode.OnDevice : _graphqlTypes.ProcessingMode.Cloud;
}
function toOnboardingStage(value) {
  switch (value) {
    case _graphqlTypes.OnboardingStage.Finished:
      return _graphqlTypes.OnboardingStage.Finished;
    case _graphqlTypes.OnboardingStage.ProcessingMode:
      return _graphqlTypes.OnboardingStage.ProcessingMode;
    case _graphqlTypes.OnboardingStage.PersonaChat:
      return _graphqlTypes.OnboardingStage.PersonaChat;
    default:
      return _graphqlTypes.OnboardingStage.Notifications;
  }
}
function toTimestamp(value) {
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const parsed = new Date(value).getTime();
    return isNaN(parsed) ? Date.now() : parsed;
  }
  return Date.now();
}