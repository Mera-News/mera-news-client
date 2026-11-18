"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.followStoryTurn = followStoryTurn;
exports.proposeTrackCalls = proposeTrackCalls;
exports.trackOptions = trackOptions;
var _shared = require("../shared");
var _readerPhrase = require("./reader-phrase");
var _schema = require("./schema");
/** The reader's turn, for the exact phrase on the card. An article follow passes none. */

const capped = o => ({
  label: (0, _shared.capWords)((0, _shared.text)(o?.label), _schema.MAX_OPTION_LABEL_WORDS),
  search: (0, _shared.capWords)((0, _shared.text)(o?.search), _schema.MAX_TRACK_SEARCH_WORDS)
});

/**
 * The options as `proposeTrack` input, word caps applied. The executor
 * (decideProposeTrack) trims, dedupes and caps the count itself.
 */
function trackOptions(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(capped).filter(o => o.label.length > 0);
}

/** A `proposeTrack` call staging the options, or none when there are none. The phrase rows skip the word caps. */
function proposeTrackCalls(raw, reader) {
  const card = reader ? (0, _readerPhrase.withReaderPhrase)(raw, reader.message, reader.appIsEnglish) : null;
  if (card) {
    const options = card.options.map(o => card.hints.phraseRoles[(0, _readerPhrase.phraseKey)(o.label)] ? o : capped(o));
    return [{
      name: 'proposeTrack',
      input: {
        options,
        phraseCard: card.hints
      }
    }];
  }
  const options = trackOptions(raw);
  return options.length > 0 ? [{
    name: 'proposeTrack',
    input: {
      options
    }
  }] : [];
}
function followStoryTurn(value, reader) {
  return {
    reply: (0, _shared.text)(value.reply),
    calls: proposeTrackCalls(value.options, reader)
  };
}