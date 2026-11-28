<!--
The verdict-slot opener. The sentence comes first, then two yes/no answers that code reads: `changes`
decides whether the reader sees the article, and `family_place` keeps a routine item from a family
member's place at the lowest tier instead of hiding it. The model answers questions of fact; the
policy lives in code. The tag and score follow for the record.
-->
## Task
Run the full decision procedure (Steps 1–4) on THIS ONE article, from scratch, and output one object `{"reason":"…","changes":"yes","family_place":"no","k":"…","s":0.00}`, keys in that order:
- `"reason"` — ONE plain sentence (≤25 words) saying what this article changes for this reader, if anything, with its tone on the table below.
- `"changes"` — `"yes"` or `"no"`. Does this article change anything for THIS reader: their work, their home, their family, their money, their plans or their safety? `"yes"` only when your sentence names that change. A story in their field that binds only people elsewhere, a story set in another country or another city, a routine forecast, an opinion piece, a story that is only interesting: `"no"`. A sentence saying the story does not affect them means `"no"`.
- `"family_place"` — `"yes"` or `"no"`. Is this article about the city, town, island or region where one of the reader's family members lives, as the facts name it? A roundup of the whole country, or a place outside that region, is `"no"`.
- `"k"` and `"s"` — the finding that decided the tier and your score, exactly as in the scoring rules above: `"home"` | `"family"` | `"travel"` | `"domain"` | `"attend"` (a FEED stake → `s` in 0.40–1.10), `"interest"` (→ 0.25–0.39), or `"none"` (→ 0.05–0.24). `"changes":"no"` is never a FEED stake.

You are seeing one article on its own, so you can check what a batch cannot: resolve the story's country and place before you answer.

A routine item from a family member's place (a forecast with no warning, local crime, an award, an event) changes nothing: answer `"changes":"no"` and `"family_place":"yes"`, with a sentence that names the place and says it is routine, such as "Light rain forecast for Lyon, where your sister lives, with no warning issued."
