// Confirmed via a real Piper->Vosk round trip: speaking a callsign as a whole number ("1409")
// gets synthesized as "fourteen-oh-nine"/"one thousand four hundred nine" and mis-transcribes
// badly. Digit-by-digit ("one four zero nine") round-trips cleanly both ways. Use this for any
// callsign inserted into text that will be spoken by Piper.
const DIGIT_NAMES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

export function formatCallsignForSpeech(callsign: string): string {
  return callsign
    .split("")
    .map((d) => DIGIT_NAMES[Number(d)] ?? d)
    .join(" ");
}

// For any value that might be a digit string (callsign, postal code) OR a fallback word
// ("unknown", a username) — digit strings get spoken digit-by-digit, anything else is spoken
// as-is (formatCallsignForSpeech would otherwise spell non-digit words out letter by letter).
export function formatForSpeech(value: string): string {
  return /^\d+$/.test(value) ? formatCallsignForSpeech(value) : value;
}

// NATO phonetic alphabet, per request — use for any plate spoken aloud.
const NATO_ALPHABET: Record<string, string> = {
  A: "Alpha",
  B: "Bravo",
  C: "Charlie",
  D: "Delta",
  E: "Echo",
  F: "Foxtrot",
  G: "Golf",
  H: "Hotel",
  I: "India",
  J: "Juliett",
  K: "Kilo",
  L: "Lima",
  M: "Mike",
  N: "November",
  O: "Oscar",
  P: "Papa",
  Q: "Quebec",
  R: "Romeo",
  S: "Sierra",
  T: "Tango",
  U: "Uniform",
  V: "Victor",
  W: "Whiskey",
  X: "X-ray",
  Y: "Yankee",
  Z: "Zulu",
};

// Letters -> NATO phonetic words, digits -> spoken digit words, everything else (dashes,
// spaces) dropped. "ABC123" -> "Alpha Bravo Charlie one two three".
export function formatPlateForSpeech(plate: string): string {
  return plate
    .toUpperCase()
    .split("")
    .map((ch) => {
      if (NATO_ALPHABET[ch]) return NATO_ALPHABET[ch];
      if (/\d/.test(ch)) return DIGIT_NAMES[Number(ch)];
      return null;
    })
    .filter((word): word is string => word !== null)
    .join(" ");
}
