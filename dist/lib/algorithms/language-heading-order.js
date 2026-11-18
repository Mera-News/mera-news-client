"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.languageHeadingOrder = languageHeadingOrder;
/** The rotating "Choose your language" order: the phone's language first (or
 *  English when the app has no dictionary for it), then the rest as listed. */
function languageHeadingOrder(phone, codes) {
  const first = codes.includes(phone) ? phone : 'en';
  return [first, ...codes.filter(c => c !== first)];
}