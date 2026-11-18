"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ON_DEVICE_CHAT_ROUTE = void 0;
// Per-flow route for the on-device chat flows: 'kev' (Kev decides, the
// built-in model writes) or 'single' (one built-in model call, as before).
// Article chat and follow-story go back to 'single' if the harness shows 'kev'
// below AFM alone on that flow's test metrics; persona chat stays on 'kev'.
// Test split (AFM, 3 repeats): 'kev' was
// at or above AFM alone on every metric of both flows with no user-visible errors.

const ON_DEVICE_CHAT_ROUTE = exports.ON_DEVICE_CHAT_ROUTE = {
  persona: 'kev',
  article: 'kev',
  follow: 'kev'
};