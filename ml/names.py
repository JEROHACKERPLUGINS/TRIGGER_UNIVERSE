#!/usr/bin/env python3
"""TRIGGER UNIVERSE · name analysis -> training labels.

Reads every path in the library list, breaks file and folder names into words,
groups the words that mean the same thing (spellings, plurals, abbreviations,
glued words, Spanish: "Kick", "kicks", "kik", "kck", "BassDrum", "bombo", "BD"
all land in the Kick group) and labels each file with the drum type its name
says. The words that look alike but are not in any group are reported, so the
dictionary can grow.

Label of a file (first rule that applies):
  1. its file name names exactly one type        -> that type   (source 'f')
  2. the nearest folder that names exactly one    -> that type   (source 'd')
  3. names a loop / instrument / vocal            -> excluded    ('x')
  4. nothing or contradictory                     -> unlabeled   ('-')

  python3 names.py wavs.tsv(.gz) labels.tsv report.md
"""
import collections
import gzip
import re
import sys
from difflib import SequenceMatcher

CLASSES = ["Kick", "Snare", "Clap", "HHC", "HHO", "Cymbal", "Tom", "Perc", "FX"]  # = EDrumClass

# Seed words per group. Short ones (<= 3 letters) only match as a whole word;
# longer ones also match spelling variants, plurals and glued words.
SEEDS = {
    "Kick":   ["kick", "kik", "kck", "kickdrum", "bassdrum", "bombo", "bd", "kd", "bdrum", "808kick"],
    "Snare":  ["snare", "snr", "sn", "sd", "redoblante", "rimshot", "rim", "sidestick", "xstick", "crossstick", "caja"],
    "Clap":   ["clap", "clp", "palma", "palmas", "snap", "snaps", "fingersnap"],
    "HAT":    ["hat", "hihat", "hh", "hats", "charles", "hht"],          # open / closed decided below
    "OPEN":   ["open", "opn", "op", "ohh", "hho", "ophat", "openhat", "openhh", "ohat"],
    "CLOSED": ["closed", "close", "chh", "hhc", "pedal", "tight", "closedhat", "closedhh", "chat"],
    "Cymbal": ["cymbal", "crash", "ride", "china", "splash", "plato", "platillo", "bell", "stack", "cym", "crsh", "gong"],
    "Tom":    ["tom", "toms", "floortom", "rack", "floor", "timbal", "tm"],
    "Perc":   ["perc", "percussion", "shaker", "conga", "bongo", "cowbell", "tambourine", "tamb", "djembe", "cajon",
               "clave", "guiro", "agogo", "timbale", "woodblock", "block", "triangle", "maraca", "cabasa", "udu",
               "tabla", "darbuka", "darabuka", "surdo", "candombe", "tambo", "tambos", "cencerro", "chimes", "wood", "stick",
               "sticks", "tamborim", "tambora", "tamborine", "pandeiro", "click", "clicks", "timpani", "whip", "slap",
               "kendang", "sabar", "kidi", "castanet", "castanets", "vibraslap", "metal"],
    "FX":     ["fx", "sfx", "riser", "rise", "sweep", "impact", "downlifter", "uplifter", "swell", "whoosh", "noise",
               "reverse", "rev", "transition", "zap", "glitch", "foley", "explosion", "laser", "lazers", "gun", "coin",
               "door", "rain", "wind", "crowd", "audience", "scratch", "atmos", "athmos", "ambience", "bomb", "blip"],
    "EXCLUDE": ["loop", "loops", "bpm", "groove", "grooves", "break", "breaks", "breakbeat", "fill", "fills", "beat",
                "vocal", "vox", "voice", "phrase", "phrases", "words", "acapella", "chant", "bass", "synth", "guitar",
                "piano", "keys", "chord", "chords", "melody", "strings", "pad", "lead", "arp", "riff", "riffs",
                "brass", "flute", "organ", "pluck", "stem", "song", "midi", "tops", "sax", "alto", "soprano", "vibraphone",
                "bagpipe", "orchestral", "steelpan", "kalimba", "saw", "pwm", "acid", "lick", "sub", "instrument", "marimba", "xylophone"],
}
# words that look like a seed but are not one
STOP = {"ts", "vec", "veh", "vee", "vve", "vdub", "vmh", "vfx", "vfh", "vub", "rm", "jr", "sdd", "nat", "omega",
        "cymatics", "galbanum", "kshmr", "one", "shot", "shots", "oneshot", "oneshots", "dry", "wet", "big", "hard",
        "soft", "drum", "drums", "kit", "kits", "short", "long", "samples", "sample", "sound", "sounds", "the", "and",
        "processed", "vintage", "room", "rooms", "close", "mic", "overhead", "overheads", "oh"}
# 'oh' (overhead mic in multi-mic kits) and 'close' are only read in the hat context below.
SHORT_OK = {"oh"}

HAT_SELF = {"ohh", "hho", "ophat", "openhat", "openhh", "ohat", "chh", "hhc", "closedhat", "closedhh"}

SPLIT = re.compile(r"[^a-z]+")


def words(s):
    s = re.sub(r"\.(wav|aif+|flac)$", "", s, flags=re.I)
    s = re.sub(r"(?<![A-Za-z])[Tt]([1-5])(?![0-9])", r" tom ", s)   # T1, T2: toms in multitrack kits
    s = re.sub(r"(?<![A-Za-z])(FT|ft)(?![A-Za-z])", r" floortom ", s)
    s = re.sub(r"([a-z])([A-Z])", r"\1 \2", s)          # camelCase
    s = re.sub(r"([A-Za-z])(\d)", r"\1 \2", s)          # Kick01
    return [w for w in SPLIT.split(s.lower()) if w]


# Seeds that may appear glued to other words ("lofikick", "hihats", "bassdrums"),
# only at the start or the end of the word. Short or common seeds are left out
# on purpose: 'rack' would catch "crack", 'hats' "whats", 'wood' "hollywood".
GLUE = {"kick", "snare", "clap", "hihat", "openhat", "closedhat", "rimshot", "cymbal", "crash", "splash", "ride",
        "shaker", "conga", "bongo", "cowbell", "tambourine", "timbale", "djembe", "bassdrum", "kickdrum",
        "sidestick", "perc", "percussion", "riser", "sweep", "impact", "downlifter", "glitch", "reverse",
        "loop", "groove", "breakbeat", "synth", "guitar", "piano", "vocal", "snares", "kicks", "claps"}
FUZZY_MIN = 5  # misspellings only for words and seeds of 5+ letters


def build_lexicon(vocab):
    """word -> group, for every word in the library: exact seeds, plurals,
    small misspellings and glued words that start or end with a drum word."""
    lex = {}
    seeds = [(g, s) for g, ws in SEEDS.items() for s in ws]
    for g, s in seeds:
        lex[s] = g
    glue = sorted([(g, s) for g, s in seeds if s in GLUE], key=lambda t: -len(t[1]))
    fuzzy = [(g, s) for g, s in seeds if len(s) >= FUZZY_MIN]
    merged = collections.defaultdict(list)  # group -> [(word, how, count)]
    for w, n in vocab.items():
        if w in lex or w in STOP or len(w) < 4:
            continue
        g = None
        stem = re.sub(r"(s|z+)$", "", w)
        for st in (stem, re.sub(r"es$", "", w)):
            if g is None and st in lex and len(st) >= 3:
                g, how = lex[st], "plural"
        if g is None:
            for gg, s in glue:
                if len(w) - len(s) >= 2 and (w.startswith(s) or w.endswith(s) or stem.endswith(s)):
                    g, how = gg, "pegada:" + s
                    break
        if g is None and len(w) >= FUZZY_MIN:
            best = (0., None, None)
            for gg, s in fuzzy:
                if s[0] != w[0] or abs(len(s) - len(w)) > 2:
                    continue
                r = SequenceMatcher(None, w, s).ratio()
                if r > best[0]:
                    best = (r, gg, s)
            if best[0] >= .84:
                g, how = best[1], "parecida:" + best[2]
        if g:
            lex[w] = g
            merged[g].append((w, how, n))
    return lex, merged


def join_pairs(ws, lex):
    """'bass drum' -> 'bassdrum', 'hi hat' -> 'hihat', 'side stick' -> 'sidestick'."""
    out, i = [], 0
    while i < len(ws):
        if i + 1 < len(ws) and (ws[i] + ws[i + 1]) in lex:
            out.append(ws[i] + ws[i + 1]); i += 2
        else:
            out.append(ws[i]); i += 1
    return out


def name_class(ws, lex):
    """Drum type a list of words names, 'EXCLUDE', None (nothing) or 'CONFLICT'."""
    ws = join_pairs(ws, lex)
    gs = {lex[w] for w in ws if w in lex}
    # 'oh' alone is the overhead mic in multi-mic kits ("Kick OH", "SD/OH ISO"): only
    # read as 'open' next to a hat word. Words like 'openhat' / 'chh' name the hat themselves.
    hat = "HAT" in gs or any(w in HAT_SELF for w in ws)
    if hat:
        is_open = "OPEN" in gs or "oh" in ws
        is_closed = "CLOSED" in gs
        gs -= {"HAT", "OPEN", "CLOSED", "Cymbal"}   # 'hat' wins over 'cymbal' words ('hh bell')
        gs.add("HHO" if is_open and not is_closed else "HHC")
    else:
        gs -= {"OPEN", "CLOSED"}
    if "EXCLUDE" in gs:
        return "EXCLUDE"
    if "Snare" in gs and "Clap" in gs:
        gs.discard("Snare")                        # 'snare clap' layers are claps
    if len(gs) > 1 and "FX" in gs:
        gs.discard("FX")                            # 'kick reverse', 'snare hit': the drum wins
    if len(gs) > 1 and "Perc" in gs:
        gs.discard("Perc")                          # 'snare stick', 'tom wood'
    if not gs:
        return None
    return gs.pop() if len(gs) == 1 else "CONFLICT"


def main(src, out_labels, out_report):
    op = gzip.open if src.endswith(".gz") else open
    rows = [l.rstrip("\n").split("\t", 1)[-1] for l in op(src, "rt", errors="replace")]
    vocab = collections.Counter()
    for p in rows:
        for part in p.split("/"):
            vocab.update(set(words(part)))
    lex, merged = build_lexicon(vocab)

    labels, by_word = [], collections.defaultdict(collections.Counter)
    for i, p in enumerate(rows):
        parts = p.split("/")
        lab, src_ = None, "-"
        c = name_class(words(parts[-1]), lex)
        # a file inside a loops / instruments / vocals folder is not a one-shot, whatever its name says
        if any(name_class(words(d), lex) == "EXCLUDE" for d in parts[:-1]):
            c = "EXCLUDE"
        if c in CLASSES:
            lab, src_ = c, "f"
        elif c == "EXCLUDE":
            src_ = "x"
        elif c is None:
            for d in reversed(parts[:-1]):
                cd = name_class(words(d), lex)
                if cd in CLASSES:
                    lab, src_ = cd, "d"
                    break
                if cd in ("EXCLUDE", "CONFLICT"):
                    src_ = "x" if cd == "EXCLUDE" else "-"
                    break
        labels.append((i, lab or "", src_, p))
        if lab:
            for w in words(parts[-1] if src_ == "f" else p):
                if w in lex:
                    by_word[lab][w] += 1

    with open(out_labels, "w") as f:
        f.write("id\tlabel\tsource\tpath\n")
        for i, lab, s, p in labels:
            f.write(f"{i}\t{lab}\t{s}\t{p}\n")

    cnt = collections.Counter((lab, s) for _, lab, s, _ in labels)
    tot = collections.Counter(lab for _, lab, _, _ in labels if lab)
    unl = [p for _, lab, s, p in labels if s == "-"]
    unmapped = collections.Counter()
    for p in unl:
        unmapped.update(w for w in set(words(p.split("/")[-1])) if w not in lex and w not in STOP and len(w) > 2)
    with open(out_report, "w") as f:
        f.write(f"# Análisis de nombres · {len(rows)} WAV\n\n")
        f.write("| Tipo | por nombre de archivo | por carpeta | total |\n|---|---:|---:|---:|\n")
        for c in CLASSES:
            f.write(f"| {c} | {cnt[(c, 'f')]} | {cnt[(c, 'd')]} | {tot[c]} |\n")
        f.write(f"\nExcluidos (loops, instrumentos, voces): {cnt[('', 'x')]}  \n")
        f.write(f"Sin etiqueta (nada o contradictorio): {cnt[('', '-')]}\n\n")
        f.write("## Grupos de palabras (variantes que se agruparon)\n\n")
        for g in list(SEEDS):
            vs = sorted(merged.get(g, []), key=lambda t: -t[2])
            seeds = ", ".join(s for s in SEEDS[g] if vocab[s])
            f.write(f"**{g}** · semillas: {seeds}\n\n")
            if vs:
                f.write("  agrupadas: " + ", ".join(f"`{w}` ({n}, {how})" for w, how, n in vs[:60]) + "\n\n")
        f.write("## Palabras más usadas en lo que quedó sin etiqueta (candidatas a sumar)\n\n")
        f.write(", ".join(f"`{w}` {n}" for w, n in unmapped.most_common(120)) + "\n")
    print(open(out_report).read()[:3000])


if __name__ == "__main__":
    main(*sys.argv[1:4])
