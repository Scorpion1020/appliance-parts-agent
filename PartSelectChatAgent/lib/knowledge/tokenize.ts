const stopWords = new Set("a an the of to for with in on at is are was were be been being do does did can could would should will shall i my me we our you your it its this that these those and or but if as from by about how what when where why which not no has have had please tell give some".split(" "));
export function tokenize(text: string): string[] {
  return (text.normalize("NFKC").toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? [])
    .filter((term) => !stopWords.has(term))
    .map((term) => /\d/.test(term) ? term : term.length > 5 && term.endsWith("ing") ? term.slice(0, -3) : term.length > 4 && term.endsWith("s") ? term.slice(0, -1) : term);
}
