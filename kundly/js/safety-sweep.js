// Kundly — hard-flag keyword sweep
// Minimal client-side sweep for active crisis language.
// Patterns adapted from references/safety-screen.md hard-flag table.
// Intentionally small — the real sweep runs server-side on submit.
// Over-inclusive by design: false positives are cheap, false negatives are not.

(function(global){
  var HARD_FLAG_PATTERNS = [
    { name: 'active_si_intent',    regex: /\b(i want to die|i wanna die|i want to end (my life|it all)|kill(ing)? myself|end my life|won'?t be here (tomorrow|much longer)|final goodbye)\b/i },
    { name: 'tonight_plan',        regex: /\b(tonight i('| wi)?ll|i have the pills|i'?ve decided to (die|go))\b/i },
    { name: 'plan_to_harm',        regex: /\b(plan(ning)? to (hurt|kill|harm) (myself|me))\b/i },
    { name: 'active_psychosis',    regex: /\b(voices (are )?telling me|people reading my mind|thought insertion|cameras in my room)\b/i },
    { name: 'active_self_harm',    regex: /\b(cut(ting)? myself (this week|today|yesterday)|burn(ed|ing) myself (today|yesterday))\b/i }
  ];

  function sweepForHardFlags(text){
    if (!text || typeof text !== 'string') return false;
    for (var i = 0; i < HARD_FLAG_PATTERNS.length; i++) {
      if (HARD_FLAG_PATTERNS[i].regex.test(text)) return true;
    }
    return false;
  }

  function matchedFlags(text){
    var matches = [];
    if (!text || typeof text !== 'string') return matches;
    for (var i = 0; i < HARD_FLAG_PATTERNS.length; i++) {
      if (HARD_FLAG_PATTERNS[i].regex.test(text)) matches.push(HARD_FLAG_PATTERNS[i].name);
    }
    return matches;
  }

  global.KundlySafetySweep = {
    sweepForHardFlags: sweepForHardFlags,
    matchedFlags: matchedFlags
  };
})(window);
