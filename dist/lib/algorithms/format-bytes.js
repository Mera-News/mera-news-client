"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.gbText = void 0;
exports.sizeText = sizeText;
// format-bytes: storage sizes in decimal units, the way phones report them.

/** The GB figure alone, one decimal: 1234000000 -> "1.2". Plain digits with no
 *  locale; `toLocaleString` with none would follow the phone, not the app. */
const gbText = (bytes, locale) => locale ? (bytes / 1e9).toLocaleString(locale, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1
}) : (bytes / 1e9).toFixed(1);

/** A size with its unit: "412 MB", "38.2 GB". */
exports.gbText = gbText;
function sizeText(bytes, locale) {
  if (bytes >= 1e9) return `${gbText(bytes, locale)} GB`;
  const mb = Math.round(bytes / 1e6);
  return `${locale ? mb.toLocaleString(locale) : mb} MB`;
}