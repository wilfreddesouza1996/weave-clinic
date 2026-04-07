// Kundly — SK-XXXX code generator
// Produces short, pronounceable pseudonymous identifiers for each seeker.
// This is client-side display only — the canonical SK code will be assigned
// by Supabase on submit (Track B).

(function(global){
  // Crockford base32 minus ambiguous chars (I, L, O, U)
  var ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
  var STORAGE_KEY = 'kundly_sk_code_v1';

  function generateSkCode(){
    var bytes = new Uint8Array(4);
    if (global.crypto && global.crypto.getRandomValues) {
      global.crypto.getRandomValues(bytes);
    } else {
      for (var i = 0; i < 4; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    var out = '';
    for (var j = 0; j < 4; j++) {
      out += ALPHABET[bytes[j] % ALPHABET.length];
    }
    return 'SK-' + out;
  }

  function getOrCreateSkCode(){
    try {
      var existing = localStorage.getItem(STORAGE_KEY);
      if (existing) return existing;
      var fresh = generateSkCode();
      localStorage.setItem(STORAGE_KEY, fresh);
      return fresh;
    } catch (e) {
      return generateSkCode();
    }
  }

  global.KundlySkCode = {
    generate: generateSkCode,
    getOrCreate: getOrCreateSkCode,
    STORAGE_KEY: STORAGE_KEY
  };
})(window);
