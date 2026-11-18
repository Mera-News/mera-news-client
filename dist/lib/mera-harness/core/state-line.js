"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.buildStateLine = buildStateLine;
exports.escapeUntrusted = escapeUntrusted;
// mera-harness/core — the one short state line the loop writes for itself.
// PURE, RN-free.
//
// This replaces chat history on every leg. It is BETTER than history for the
// purpose: it states what the loop actually established, rather than making the
// model re-derive it from a transcript that windowing may have truncated
// mid-pair. It also costs ~40 tokens against the 1,500 a history window took.

/** Escape-only, for values that came from the user or the model. Tool results
 *  are framed as "here is what the lookup returned", not "here is the article",
 *  so they take NO nonce fence -- only escaping. */
function escapeUntrusted(raw, maxLength = 200) {
  const truncated = (raw ?? '').slice(0, maxLength);
  return truncated.replace(/</g, '< ').replace(/>/g, ' >').replace(/\n+/g, ' ').trim();
}
function buildStateLine(input) {
  const parts = [];
  parts.push(input.routeKind ? `Handling: ${escapeUntrusted(input.routeKind, 60)}.` : 'Handling: not yet classified.');
  if (input.resolvedPlaces && input.resolvedPlaces.length > 0) {
    // Every interpolated value is escaped: the literal scaffolding is ours,
    // the values are not.
    const chain = p => [p.neighbourhood, p.userTerm ? `${p.userTerm} (${p.locality})` : p.locality, p.admin1, p.countryName, p.bloc].filter(Boolean).map(v => escapeUntrusted(String(v), 60)).join(', ');
    if (input.resolvedPlaces.length === 1) {
      parts.push(`Place resolved: ${chain(input.resolvedPlaces[0])}.`);
    } else {
      // The LABELS, quoted and separately from the chains.
      //
      // This used to render only the comma-joined chains, and on the ambiguous
      // fixture the model answered `ask_choice` with `options: []` in most
      // repeats even though the candidates reached it twice over (here and in
      // the tool result). Asking it to derive a <60-char chip label from
      // "Amsterdam, North Holland, Netherlands, EU" is a transformation it was
      // silently failing; handing it the exact strings removes the step.
      const labels = input.resolvedPlaces.map(p => `"${escapeUntrusted(p.neighbourhood || p.locality, 60)}"`).join(', ');
      parts.push(`Place is AMBIGUOUS, ${input.resolvedPlaces.length} candidates. ` + `Call ask_choice with exactly these options: ${labels}. ` + `Full chains: ${input.resolvedPlaces.map(chain).join(' | ')}.`);
    }
  }
  if (input.finerArea) {
    // The place service has no districts, so the lookup dropped these words.
    // Named back so the model keeps the user's granularity (canonical spelling
    // for an obvious typo) instead of asking about it.
    parts.push(`Finer area as the user wrote it: "${escapeUntrusted(input.finerArea, 60)}". ` + 'Keep it as the first rung, in its usual spelling; never ask about it.');
  }
  if (input.existingFacts && input.existingFacts.length > 0) {
    // LABELLED, because the unlabelled list read as material to work from and
    // the model echoed one back as its "new" fact, or narrated it as a
    // confirmation. On device it "confirmed" a Rotterdam fact the user had
    // replaced two turns earlier.
    const rows = input.existingFacts.map(f => `[${escapeUntrusted(f.factId, 40)}] "${escapeUntrusted(f.statement, 160)}"`).join('; ');
    parts.push(`EXISTING facts already on file, never re-propose these: ${rows}. ` + 'To change one, propose the NEW statement and set replaces to the matching id.');
  } else if (input.similarFactCount !== null) {
    parts.push('Similar facts: none.');
  }
  if (input.resolvedChoiceText) {
    parts.push(`They chose: ${escapeUntrusted(input.resolvedChoiceText, 80)}.`);
  }
  if (input.segmentScope) {
    const others = input.segmentScope.others.map(k => escapeUntrusted(k, 30)).join(', ');
    parts.push(`This message has several subjects. You handle only the ${escapeUntrusted(input.segmentScope.mine, 30)} part` + (others ? `; other guidelines handle ${others}. Offer nothing about those.` : '.'));
    if (input.segmentScope.questionPending) {
      parts.push('A question about another part is already waiting for the user. Ask nothing: if a reading ' + 'is uncertain, put the other readings in alternatives.');
    }
  }
  if (input.pendingCards && input.pendingCards.length > 0) {
    const rows = input.pendingCards.slice(0, 6).map(s => `"${escapeUntrusted(s, 120)}"`).join('; ');
    parts.push(`Cards already waiting for the user: ${rows}. Never offer these again, in any wording; ` + 'the user can still answer them.'
    // A FACT CARD APPLIES ONLY ON A TAP. Said only when no proposal card
    // waits (that branch carries its own rule) and no typed yes or no
    // resumes a question: "ok" beside a fact card got "All set", which
    // nothing on screen had done.
    + (input.pendingCard || input.cardThisTurn || input.answeredYesTo || input.answeredNoTo ? '' : ' Only a tap on a card applies it. If the message only agrees or acknowledges ("yes", "ok", ' + '"sure", "thanks", or the same in any language), call nothing and say "Tap the one you want on ' + 'the card above." Never say it is done or all set.'));
  }
  if (input.cardThisTurn) {
    parts.push(input.cardThisTurn === 'staged' ? 'You put a card on screen this turn. Do not stage another; say in one short sentence what it offers.' : input.cardThisTurn === 'applied' ? 'You applied the waiting card this turn. Say in one short sentence what changed.' : 'You dropped the waiting card this turn. Say in one short sentence that nothing changed.');
  } else if (input.pendingCard) {
    const card = `A card is waiting for the user: "${escapeUntrusted(input.pendingCard.summary, 300)}".`;
    // OWNER RULING: a card applies only on a tap or CLEAR agreement. Staging
    // measured "cool" applying it 4 of 5 and "ok" 5 of 5 when this line said
    // only "agrees to it". The two lists are the literal test.
    parts.push(input.pendingCard.multiSelect
    // A FOLLOW CARD WITH SEVERAL OPTIONS: only their ticks and the Follow
    // tap follow anything. The phrase matches the follow prompts.
    ? `${card} It offers stories to follow: the user must tap the ones they want on the card and then tap Follow. ` + 'If they agree, say "Tick the ones you want on the card above, then tap Follow." If they decline, call ' + 'cancelProposal. Never say anything is followed.' : input.pendingCard.appliable ? `${card} Clear agreement applies it: "yes", "do it", "go ahead", "sure", "please do", or the same in ` + 'any language. Then call applyProposal. "ok", "okay", "cool", "thanks", "nice", "great", "hmm" and the ' + 'same in any language only acknowledge: call nothing and say "Tap the card above, or say yes to do it." ' + 'A decline calls cancelProposal. Anything else leaves the card waiting; never say it is done.' : `${card} ${input.pendingCard.chooseOne ? 'It offers options, and only' : 'Only'} a tap on the card ` + 'applies it: if they agree, say "Tap the one you want on the card above." If it declines, call ' + 'cancelProposal. Never say it is done.');
  }
  if (input.answeredNoTo) {
    parts.push(`They answered no to your question: "${escapeUntrusted(input.answeredNoTo, 160)}". ` + 'Do not offer what it asked about. Acknowledge it in one short sentence.');
  }
  if (input.answeredYesTo) {
    parts.push(`They answered yes to your question: "${escapeUntrusted(input.answeredYesTo, 160)}". ` + 'Do what that question offered now, and say in one short sentence what you are offering. ' + 'A yes is never permission to delete anything.');
  }
  if (input.forcedProposal) {
    parts.push('You have not proposed anything yet. Propose the fact now or ask one choice question.');
  }

  // THE PREVIOUS QUESTION, and the answer-pending guard, as ONE block.
  //
  // They were two lines and the second asserted something the loop cannot know.
  // `answerPending` is true for any turn that is not a chip tap, so a typed
  // answer was announced to the model as "they did not answer", while the
  // question itself was never sent at all. Stating the question and leaving the
  // reading to the model is both true and the thing that was missing; the
  // do-not-repeat half of the guard is kept verbatim, because that half works.
  if (input.lastQuestion && !input.answeredYesTo && !input.answeredNoTo) {
    parts.push(`Your last turn asked: "${escapeUntrusted(input.lastQuestion, 160)}". ` + 'This message is most likely its answer, so read it that way if it can be. ' + 'Never ask that question again, and never say how you read the message.');
  } else if (input.answerPending) {
    parts.push('They did not answer your last question. Offer, do not ask again.');
  }
  return parts.join(' ');
}