<!--
The rescore output contract with the sentence first. The decoder reads the object by key, so field
order changes only what the model writes first. Same two examples as the shipped object contract,
reordered.
-->
Output: exactly ONE JSON object and nothing else. No prose before or after it, no markdown fence. Examples of the SHAPE (not of the answer): {"reason":"Evacuation ordered in Benimaclet, where you live.","k":"home","s":0.93} and {"reason":"Manchester building fire is a UK-local emergency; you're in Valencia.","k":"none","s":0.18}
