#!/usr/bin/env python3
"""
Tanya from Hebrew Wikisource (CC BY-SA) — kept on the site instead of Sefaria's edition (Kehot, CC BY-NC,
which does not allow a site with ads).

The daily Tanya schedule (Sefaria's "Tanya Yomi") points to Sefaria's paragraph numbers, e.g.
"Tanya, Part IV; Iggeret HaKodesh 26:15". So that those numbers keep working, each Wikisource chapter is
cut at the same places as Sefaria's paragraphs: the two texts are compared word by word (letters only,
without vowels or punctuation) and the Wikisource text is split where Sefaria's paragraphs begin.
Only the paragraph boundaries are taken from Sefaria — the words shown are Wikisource's.
A chapter that does not match well enough is left out, and the page reads it from Sefaria as before.

Used by update_library.py (group "tanya").
"""
import difflib, html as htmlmod, re, urllib.parse

HEB_NUM = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט', 'י', 'יא', 'יב', 'יג', 'יד', 'טו', 'טז', 'יז', 'יח', 'יט', 'כ',
           'כא', 'כב', 'כג', 'כד', 'כה', 'כו', 'כז', 'כח', 'כט', 'ל', 'לא', 'לב', 'לג', 'לד', 'לה', 'לו', 'לז', 'לח', 'לט', 'מ',
           'מא', 'מב', 'מג', 'מד', 'מה', 'מו', 'מז', 'מח', 'מט', 'נ', 'נא', 'נב', 'נג']
# Sefaria title -> Wikisource page for chapter n (a book with one section: the page itself)
BOOKS = {
    "Tanya, Part I; Likkutei Amarim, Compiler's Foreword": lambda n: 'תניא חלק א הקדמה',
    'Tanya, Part I; Likkutei Amarim': lambda n: 'תניא חלק א ' + HEB_NUM[n],
    'Tanya, Part II; Shaar HaYichud VehaEmunah, Chinukh Katan': lambda n: 'תניא שער היחוד והאמונה חנוך לנער',
    'Tanya, Part II; Shaar HaYichud VehaEmunah': lambda n: 'תניא שער היחוד והאמונה ' + HEB_NUM[n],
    'Tanya, Part III; Iggeret HaTeshuvah': lambda n: 'תניא אגרת התשובה ' + HEB_NUM[n],
    'Tanya, Part IV; Iggeret HaKodesh': lambda n: 'תניא חלק ד ' + HEB_NUM[n],
    'Tanya, Part V; Kuntres Acharon': lambda n: 'תניא קונטרס אחרון ' + HEB_NUM[n],
}
SINGLE = {"Tanya, Part I; Likkutei Amarim, Compiler's Foreword", 'Tanya, Part II; Shaar HaYichud VehaEmunah, Chinukh Katan'}
SOURCE = 'https://he.wikisource.org/wiki/%D7%A1%D7%A4%D7%A8_%D7%94%D7%AA%D7%A0%D7%99%D7%90'
MIN_MATCH = 0.6           # share of Sefaria's words found in the Wikisource chapter, in order

def key(w):
    """A word for comparing: letters only, no ו/י (spelling), final letters as regular ones."""
    w = re.sub('[֑-ׇ]', '', w)
    w = re.sub('[^א-ת]', '', w)
    w = w.translate(str.maketrans('ךםןףץ', 'כמנפצ'))
    return re.sub('[וי]', '', w)

def page_text(html):
    """Paragraphs of a Wikisource chapter page (navigation, headings, notes and edit links removed)."""
    h = re.sub(r'<div style="[^"]*border: 1px solid #aaaaaa.*?</div>', ' ', html, flags=re.S)   # the navigation bars
    for stop in ('<div class="advanced"', '<div class="mw-heading', '<ol class="references"'):   # notes, links …
        i = h.find(stop)
        if i > 0: h = h[:i]
    h = re.sub(r'<(style|script|sup|table)\b.*?</\1>', ' ', h, flags=re.S)
    h = re.sub(r'<span class="mw-editsection">.*?</span></span>', ' ', h, flags=re.S)
    h = re.sub(r'<div class="mw-heading.*?</div>', ' ', h, flags=re.S)
    h = re.sub(r'<(ol|ul) class="references".*?</\1>', ' ', h, flags=re.S)
    paras = []
    for m in re.finditer(r'<(p|dd|li)\b[^>]*>(.*?)</\1>', h, flags=re.S):
        t = re.sub(r'<br\s*/?>', ' ', m.group(2))
        t = htmlmod.unescape(re.sub(r'<[^>]+>', '', t))
        t = re.sub(r'\s+', ' ', t).strip()
        if t and re.search('[א-ת]', t): paras.append(t)
    return paras

def sefaria_words(segs):
    out = []
    for s in segs:
        s = re.sub(r'<i data-overlay[^>]*></i>', ' ', s or '')
        s = htmlmod.unescape(re.sub(r'<[^>]+>', ' ', s))
        out.append([k for k in (key(w) for w in s.split()) if k])
    return out

def split_like(ws_paras, sef_segs):
    """Cut the Wikisource text where Sefaria's paragraphs begin. -> (segments, match ratio)"""
    tokens = ' '.join(ws_paras).split()
    sw0 = sefaria_words(sef_segs[:1])
    if len(tokens) > 2 and tokens[0] == 'פרק' and (not sw0 or not sw0[0] or sw0[0][0] != key('פרק')):
        tokens = tokens[2:]                                   # the chapter title ("פרק א")
    tkeys = [key(t) for t in tokens]
    idx = [i for i, k in enumerate(tkeys) if k]            # tokens that have letters
    wk = [tkeys[i] for i in idx]
    sw = sefaria_words(sef_segs)
    flat = [k for seg in sw for k in seg]
    if not flat or not wk: return None, 0
    sm = difflib.SequenceMatcher(None, flat, wk, autojunk=False)
    blocks = sm.get_matching_blocks()
    ratio = sum(b.size for b in blocks) / len(flat)
    # Sefaria word position -> Wikisource word position
    def to_ws(p):
        prev = None
        for b in blocks:
            if b.a <= p < b.a + b.size: return b.b + (p - b.a)
            if b.a > p:
                # in a gap (e.g. Sefaria spells out an abbreviation): a paragraph that starts right where the
                # gap starts, starts at the same place in Wikisource too; otherwise at the next matching word
                if prev is not None and p == prev.a + prev.size: return prev.b + prev.size
                return b.b
            prev = b
        return len(wk)
    starts, pos = [], 0
    for seg in sw:
        starts.append(pos); pos += len(seg)
    cut = [0] + [idx[to_ws(p)] if to_ws(p) < len(idx) else len(tokens) for p in starts[1:]] + [len(tokens)]
    for k in range(1, len(cut)): cut[k] = max(cut[k], cut[k - 1])
    segs = [' '.join(tokens[cut[k]:cut[k + 1]]) for k in range(len(sw))]
    return segs, ratio

def build(lib, title):
    """The book in the library's shape: list of sections (each a list of segments). Missing chapters: []."""
    import siddur_baladi
    u = lib.u
    d = u.http_json(f"{u.API}/shape/{urllib.parse.quote(title)}")
    node = next((x for x in d if isinstance(x, dict) and x.get('title') == title), d[0]) if isinstance(d, list) else d
    chapters = node.get('chapters')
    single = title in SINGLE or isinstance(chapters, int)
    n = 1 if single else len(chapters)
    sections, weak = [], []
    for c in range(1, n + 1):
        ref = title if single else f'{title} {c}'
        try:
            v = (lib.fetch(ref).get('versions') or [{}])[0]
            sef = v.get('text') or []
            if isinstance(sef, str): sef = [sef]
            html, _ = siddur_baladi.fetch_page(BOOKS[title](c))
            u.time.sleep(1)
            segs, ratio = split_like(page_text(html), sef)
        except Exception as e:
            segs, ratio = None, 0
        if not segs or ratio < MIN_MATCH:
            weak.append(f'{c} ({round(ratio * 100)}%)')
            segs = []
        if single:
            return {'text': [[s] for s in segs], 'weak': weak}
        sections.append(segs)
    return {'text': sections, 'weak': weak}
