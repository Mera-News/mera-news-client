"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.useUserStore = void 0;
var _zustand = require("zustand");
var _accountService = require("../account-service");
var _logger = _interopRequireDefault(require("../logger"));
var _userPersonaService = require("../database/services/user-persona-service");
var _settingService = require("../database/services/setting-service");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
const NEEDS_REAUTH_KEY = 'needs_reauth';

// Cache duration: 5 minutes (in milliseconds)
const CACHE_DURATION = 5 * 60 * 1000;

/**
 * Shared fetch/cache/dedupe/persist logic behind fetchUserPersona and
 * fetchUserPersonaOrThrow. Guard against empty/falsy ids — the server rejects
 * these as "Access denied: resource belongs to another user" and Apollo then
 * treats it as an auth failure. Callers are expected to wait until a real
 * userId is available, so an empty userId resolves to null rather than
 * throwing (it is not a fetch failure).
 *
 * On a genuine fetch failure this logs via logger.captureException, resets
 * isLoading, and RETHROWS — callers decide whether to swallow (fetchUserPersona)
 * or propagate (fetchUserPersonaOrThrow).
 */
async function fetchUserPersonaCore(set, get, userId, force) {
  if (!userId) {
    return null;
  }
  const state = get();

  // Return cached persona if still valid and not forced
  if (!force && state.userPersona && state.userId === userId && state.lastFetchedAt && Date.now() - state.lastFetchedAt < CACHE_DURATION) {
    return state.userPersona;
  }

  // Prevent duplicate fetches
  if (state.isLoading && state.userId === userId) {
    return state.userPersona;
  }
  try {
    set({
      isLoading: true,
      userId
    });
    const persona = await _accountService.AccountService.getUserPersona(userId);
    if (persona) {
      _logger.default.info(`[user-store] persona fetched: notificationsEnabled=${persona.notificationsEnabled} preferredNotificationWindow=${JSON.stringify(persona.preferredNotificationWindow)}`);
    }
    set({
      userPersona: persona,
      isLoading: false,
      lastFetchedAt: Date.now()
    });

    // Fire-and-forget persist
    if (persona) {
      (0, _userPersonaService.persistUserPersona)(userId, persona).catch(() => {});
    }
    return persona;
  } catch (error) {
    _logger.default.captureException(error, {
      tags: {
        store: 'userStore',
        method: 'fetchUserPersona'
      }
    });
    set({
      isLoading: false
    });
    throw error;
  }
}
const useUserStore = exports.useUserStore = (0, _zustand.create)()((set, get) => ({
  userId: null,
  userPersona: null,
  isLoading: false,
  lastFetchedAt: null,
  needsReauth: false,
  setUserId: id => {
    set({
      userId: id
    });
    if (id) {
      (0, _settingService.setSetting)('cached_user_id', id).catch(() => {});
    } else {
      (0, _settingService.deleteSetting)('cached_user_id').catch(() => {});
    }
  },
  /**
   * Adopt an owner that was read OFF DISK, without writing it back.
   *
   * Deliberately narrower than `setUserId`. The cold-start gate needs the
   * in-memory id populated for the screens downstream of it, but for a user
   * whose session has not resolved the only id available is the one
   * `cached_user_id` already holds — so re-stamping it is at best a no-op
   * write and at worst the thing that made a bad state STICKY: the gate used
   * to coalesce session ?? local and then write the result back, which
   * re-stamped the previous owner over an account switch it had just failed
   * to detect.
   *
   * `setUserId` stays the only writer. Absent a proven identity there is
   * nothing new to persist, and persisting a guess is how the guess survives
   * a relaunch.
   */
  adoptLocalUserId: id => {
    if (!id) return;
    set({
      userId: id
    });
  },
  setUserPersona: persona => {
    set({
      userPersona: persona,
      lastFetchedAt: Date.now()
    });
    // Fire-and-forget persist
    const userId = get().userId;
    if (userId && persona) {
      (0, _userPersonaService.persistUserPersona)(userId, persona).catch(() => {});
    }
  },
  // Idempotent: only touches state/DB when the value actually changes, so the
  // breaker and success paths can call it freely without chatty writes.
  setNeedsReauth: v => {
    if (get().needsReauth === v) return;
    set({
      needsReauth: v
    });
    if (v) {
      (0, _settingService.setSetting)(NEEDS_REAUTH_KEY, '1').catch(() => {});
    } else {
      (0, _settingService.deleteSetting)(NEEDS_REAUTH_KEY).catch(() => {});
    }
  },
  fetchUserPersona: async (userId, force = false) => {
    try {
      return await fetchUserPersonaCore(set, get, userId, force);
    } catch {
      return null;
    }
  },
  fetchUserPersonaOrThrow: async (userId, force = false) => {
    return fetchUserPersonaCore(set, get, userId, force);
  },
  clearUser: () => {
    set({
      userId: null,
      userPersona: null,
      isLoading: false,
      lastFetchedAt: null,
      needsReauth: false
    });
    (0, _userPersonaService.clearUserPersona)().catch(() => {});
    (0, _settingService.deleteSetting)('cached_user_id').catch(() => {});
    // Legacy: email sign-in wrote this row. Nothing writes it now; old devices still clear it.
    (0, _settingService.deleteSetting)('cached_user_email').catch(() => {});
    (0, _settingService.deleteSetting)(NEEDS_REAUTH_KEY).catch(() => {});
  },
  hydrateFromDb: async () => {
    try {
      const userId = await (0, _settingService.getSetting)('cached_user_id');
      if (!userId) return;

      // Restore the persisted re-auth flag alongside identity (only
      // meaningful when a user exists on-device).
      const needsReauth = (await (0, _settingService.getSetting)(NEEDS_REAUTH_KEY)) === '1';
      if (needsReauth) set({
        needsReauth: true
      });
      const persona = await (0, _userPersonaService.loadUserPersona)(userId);
      if (persona) {
        _logger.default.info(`[user-store] persona hydrated: notificationsEnabled=${persona.notificationsEnabled} preferredNotificationWindow=${JSON.stringify(persona.preferredNotificationWindow)}`);
        set({
          userId,
          userPersona: persona,
          lastFetchedAt: null // Force re-fetch on next access (DB cache has no TTL)
        });
      } else {
        set({
          userId
        });
      }
    } catch (err) {
      _logger.default.warn('[user-store] hydrateFromDb failed', {
        error: String(err)
      });
    }
  }
}));