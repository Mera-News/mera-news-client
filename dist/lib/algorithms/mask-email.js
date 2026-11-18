"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.maskEmail = maskEmail;
/**
 * An email with the first half of its local part shown and the rest dotted,
 * "anna@example.com" -> "an••@example.com". The ONE masking rule: Settings and
 * the sign-in gate show the same address the same way. An address with no
 * local part is returned as is.
 */
function maskEmail(email) {
  const at = email.lastIndexOf('@');
  if (at <= 0) return email;
  const local = email.slice(0, at);
  const visible = Math.ceil(local.length / 2);
  return local.slice(0, visible) + '•'.repeat(local.length - visible) + email.slice(at);
}