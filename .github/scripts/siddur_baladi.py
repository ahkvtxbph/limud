#!/usr/bin/env python3
"""
The Yemenite (Baladi) siddur, from Hebrew Wikisource (CC BY-SA), for the site's siddur page.

Wikisource writes the day-dependent parts as instructions inside the text ("בחורף:", "בר"ח וחוה"מ
מוסיף:", "בחנוכה אומר במקום זאת:" …). This turns each page into "leaves" (sections) of HTML
segments in which every such part is marked explicitly:

    <span class="sd-i">…</span>                    an instruction (shown as a label, never said)
    <span data-w="rc chm">…</span>                 said only when one of these holds
    <span data-w="chanukah purim" data-n="1">…</span>   said only when none of these holds

so the site does not have to guess (siddur.js, sdRenderExplicit). Nested spans = all must hold.

    python3 .github/scripts/siddur_baladi.py <folder with page .html files>   # convert saved pages
Used by update_sources.py (update_siddur_baladi) once a week.
"""
import html as htmlmod, json, re, sys, os
from html.parser import HTMLParser

PAGES = [   # (Wikisource page, prayer key, Hebrew name)
    ('סידור/נוסח תימן בלדי/שחרית לחול', 'shacharit', 'שחרית'),
    ('סידור/נוסח תימן בלדי/מנחה לחול', 'mincha', 'מנחה'),
    ('סידור/נוסח תימן בלדי/ערבית לחול', 'maariv', 'ערבית'),
    ('סידור/נוסח תימן בלדי/קריאת שמע שעל המיטה', 'bedtime', 'קריאת שמע על המיטה'),
]
# pages with no headings of their own: a block that matches starts a new section
ANCHORS = {
    'mincha': [
        (r'^אתה הוא', 'פטום הקטורת'),
        (r'^ומתפללים תשע עשרה|^אדני שפתי תפתח', 'תפילת העמידה'),
        (r'^ונופלים על פניהם', 'נפילת אפים'),
        (r'^יתגדל ויתקדש', 'קדיש ומזמורי תהלים'),
    ],
    'maariv': [
        (r'^והוא רחום', 'ברכו · קריאת שמע וברכותיה'),
        (r'^תפילת שמונה עשרה$|^תפלת שמונה עשרה$|^תפילת עמידה$', 'תפילת העמידה'),
        (r'^למנצח על הגתית', 'מזמורים · עלינו לשבח'),
    ],
}
DROP_BLOCK = re.compile(r'^(תפילת שמונה עשרה|תפלת שמונה עשרה|תפילת עמידה)$')

NIKUD = re.compile('[ְ-ׇּׁׂ]')
HEB = re.compile('[א-ת]')

def plain(s):
    s = re.sub('[֑-ׇ]', '', s.replace('־', ' '))
    s = s.replace('ﬣ', 'ה')    # "יְהֹוָﬣ" (wide he)
    return re.sub(r'\s+', ' ', re.sub('[^א-ת\\s]', ' ', s)).strip()

# ---------------------------------------------------------------- a small HTML tree
class Node:
    __slots__ = ('tag', 'attrs', 'kids', 'text', 'parent')
    def __init__(self, tag, attrs=None, text=None, parent=None):
        self.tag, self.attrs, self.kids, self.text, self.parent = tag, dict(attrs or []), [], text, parent
    def cls(self): return self.attrs.get('class') or ''
    def style(self): return (self.attrs.get('style') or '').replace(' ', '').lower()

VOID = {'br', 'img', 'hr', 'meta', 'link', 'input', 'wbr', 'source'}
class TreeBuilder(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node('#root'); self.cur = self.root
    def handle_starttag(self, tag, attrs):
        n = Node(tag, attrs, parent=self.cur); self.cur.kids.append(n)
        if tag not in VOID: self.cur = n
    def handle_startendtag(self, tag, attrs):
        self.cur.kids.append(Node(tag, attrs, parent=self.cur))
    def handle_endtag(self, tag):
        n = self.cur
        while n is not self.root and n.tag != tag: n = n.parent
        if n is not self.root: self.cur = n.parent
    def handle_data(self, data):
        self.cur.kids.append(Node('#text', text=data, parent=self.cur))

def parse(html):
    t = TreeBuilder(); t.feed(html); t.close(); return t.root

SKIP_TAGS = {'style', 'script', 'link', 'meta', 'sup', 'noscript'}
def skipped(n):
    if n.tag in SKIP_TAGS: return True
    c = n.cls()
    if re.search(r'mw-editsection|reference|toc|noprint|mw-empty-elt|catlinks|navbox', c): return True
    if n.attrs.get('id') == 'toc': return True
    if 'color:gray' in n.style(): return True              # the grey (source) citations
    return False

# ---------------------------------------------------------------- page -> blocks
def page_blocks(html):
    """[('h2'|'h3', title) | ('b', [word tokens], is_dd)] in reading order."""
    out = []
    def inline(n, fmt, toks):
        for k in n.kids:
            if k.tag == '#text':
                txt = k.text.replace('\xa0', ' ')
                txt = re.sub(r'\s*/\s*', ' / ', txt)                       # "הַחֹדֶשׁ/בחול" -> alternatives
                txt = re.sub(r':(?=[א-ת])', ': ', txt)          # "סוכות:חַג"
                txt = re.sub(r'(?<=[א-ת֑-ׇ])\(', ' (', txt)   # "ומתפללים(בעשי"ת"
                for part in re.split(r'(\s+)', txt):
                    if not part: continue
                    if part.isspace(): toks.append({'sp': True}); continue
                    toks.append({'w': part, **fmt})
                continue
            if skipped(k): continue
            if k.tag == 'br': toks.append({'br': True}); continue
            f = dict(fmt)
            st = k.style()
            if k.tag == 'small' or 'font-size:83%' in st or 'font-size:85%' in st: f['small'] = True
            if 'background-color:#f3f6fb' in st or 'narkisim' in st: f['ins'] = True
            if k.tag in ('b', 'strong'): f['bold'] = True
            inline(k, f, toks)
    INLINE = {'span', 'small', 'b', 'strong', 'font', 'i', 'a', 'big', 'u', 'em', 'br'}
    def blockwalk(n, in_dd=False):
        buf = []
        def flush():
            if not buf: return
            toks = []; fake = Node('#wrap'); fake.kids = buf[:]; inline(fake, {}, toks)
            if any('w' in t for t in toks): out.append(('b', toks, in_dd))
            buf.clear()
        for k in n.kids:
            if k.tag == '#text' or (k.tag in INLINE and not has_block_kids(k)):
                if k.tag == '#text' or not skipped(k): buf.append(k)
                continue
            if skipped(k): continue
            flush()
            if k.tag in ('h2', 'h3', 'h4'):
                t = re.sub(r'\s+', ' ', ''.join(x.text for x in iter_text(k))).strip()
                out.append(('h2' if k.tag == 'h2' else 'h3', t)); continue
            if k.tag == 'tr':                        # a table row (אנא בכח): its cells, as one line
                toks = []
                for cell in k.kids:
                    if cell.tag in ('td', 'th'): inline(cell, {}, toks); toks.append({'sp': True})
                if any('w' in t for t in toks): out.append(('b', toks, in_dd))
                continue
            if k.tag in ('p', 'li') or (k.tag == 'dd' and not has_block_kids(k)):
                toks = []; inline(k, {}, toks)
                if any('w' in t for t in toks): out.append(('b', toks, in_dd or k.tag == 'dd'))
                continue
            blockwalk(k, in_dd or k.tag in ('dd', 'dl'))
        flush()
    blockwalk(parse(html))
    return out

def iter_text(n):
    for k in n.kids:
        if k.tag == '#text': yield k
        elif not skipped(k): yield from iter_text(k)
def has_block_kids(n):
    return any(k.tag in ('p', 'div', 'dl', 'dd', 'ul', 'ol', 'li', 'h2', 'h3', 'h4', 'table') for k in n.kids)

# ---------------------------------------------------------------- instructions and conditions
COND_RULES = [   # (pattern on the normalised instruction, condition key)
    (r'חול המועד (?:של )?פסח', 'chmPesach'), (r'חול המועד (?:של )?סו?כות', 'chmSukkot'),
    (r'עשרת ימי תשובה|ימי תשובה', 'ayt'), (r'שמיני עצרת', 'shmini'), (r'ראש השנה', 'rh'),
    (r'יום ה?כי?פו?רים', 'yk'), (r'ראש ח(?:ו)?דש', 'rc'), (r'חול המועד', 'chm'), (r'יום טוב', 'yomtov'),
    (r'(?:^|\s)[ובלה]{0,2}פסח(?=\s|$)', 'pesach'), (r'(?:^|\s)[ובלה]{0,2}סו?כות(?=\s|$)', 'sukkot'),
    (r'שבועות', 'shavuot'), (r'חנוכה|חנכה', 'chanukah'), (r'פורים', 'purim'), (r'תשעה באב', 'av9'),
    (r'תענית|(?:^|\s)[ובלה]{0,2}צום(?=\s|$)', 'fast'), (r'חורף|ימות הגשמים', 'winter'), (r'קיץ|ימות החמה', 'summer'),
    (r'מוצאי שבת', 'motzash'), (r'ארץ ישראל', 'israel'), (r'חוץ לארץ', 'diaspora'),
    (r'שאין אומרים תחנון|שאין נופלים|שאומרים תחנון', 'tachanunDay'),
    (r'נוסח (?:עדות המזרח|ספרד|אשכנז|ספרדי)', 'other'),
]
ABBR = [(r'ר["״׳\']ח', 'ראש חודש'), (r'ראש חדש', 'ראש חודש'), (r'חוה["״׳\']?מ(["״׳\']?ע)?', 'חול המועד'),
        (r'עשי["״׳\']ת', 'עשרת ימי תשובה'), (r'יו["״׳\']ט', 'יום טוב'), (r'ש["״׳\']ץ', 'שליח ציבור'),
        (r'מוצ["״׳\']ש', 'מוצאי שבת'), (r'(?<![א-ת])(ב?)ת["״׳\'][צץ]', r'\1תענית ציבור'), (r'ט["״׳\']ב', 'תשעה באב'),
        (r'א["״׳\']י', 'ארץ ישראל'), (r'חו["״׳\']ל', 'חוץ לארץ'), (r'ר["״׳\']ה', 'ראש השנה')]
VERBS = r'אומר|אומרים|מוסיף|מוסיפים|מוסיפין|יאמר|עונים|עונה|ממשיך|ממשיכים|מתפללים|נופלים|פוסעים|מדלגים|בלחש|שליח ציבור|הקהל|הציבור|החזן'
NOTE_OPEN = r'^(ואם|אם יש|ועכשיו|נהגו|ונוהגים|נוהגים|יש נוהגים|ויש נוהגים|המנהג|ומנהג|ומתפללים|מכאן|ומיד|כשמסיים|לאחר|אחר כך|עד כאן) '
VERBS_BR = VERBS + r'|קדיש|אמן'      # in brackets: "(קדיש)", "[אמן]"

def norm_ins(s):
    t = re.sub('[֑-ׇ]', '', s.replace('־', ' '))
    for a, b in ABBR: t = re.sub(a, b, t)
    return re.sub(r'\s+', ' ', re.sub('[^א-ת\\s]', ' ', t)).strip()

def classify(text):
    n = norm_ins(text)
    conds = []
    t = ' ' + n + ' '
    for pat, key in COND_RULES:
        if re.search(pat, t):
            if key not in conds: conds.append(key)
            t = re.sub(pat, ' ', t)
    neg = bool(re.search(r'(אין|אינם|אינו|לא) (אומרים|אומר|יאמר|נוהגים|לומר)|מדלגים|מדלג', n))
    if 'tachanunDay' in conds:
        # "ביום שאין אומרים תחנון אין אומרים…" = said only on days with Tachanun
        rest = re.sub(r'שאין אומרים תחנון|שאין נופלים', ' ', n)
        neg = not re.search(r'(אין|לא) (אומרים|אומר)|מדלגים', rest)
        if 'שאומרים תחנון' in n: neg = False
    if 'other' in conds: conds, neg = ['other'], False
    repl = None
    m = re.search(r'במקום (\S+(?: \S+)?)', n)
    if m: repl = '' if m.group(1).startswith('זאת') or m.group(1).startswith('זה') else m.group(1)
    return {'conds': conds, 'neg': neg, 'repl': repl, 'norm': n}

# ---------------------------------------------------------------- one block -> runs
def word_kind(tok):
    w = tok['w']
    if not HEB.search(w.replace('ﬣ', 'ה')): return 'N'
    return 'T' if NIKUD.search(w) else 'U'

def block_runs(toks):
    """Mark each word as instruction (I) or prayer text (T); returns list of runs {k, toks}."""
    words = [t for t in toks if 'w' in t]
    heb = [t for t in words if word_kind(t) != 'N']
    voc = [t for t in heb if word_kind(t) == 'T']
    plain_mode = len(heb) >= 3 and len(voc) < 0.15 * len(heb)
    for t in toks:
        if 'w' not in t: continue
        k = word_kind(t)
        if k == 'N': t['k'] = 'N'
        elif t.get('ins'): t['k'] = 'I' if k == 'U' else 'T'
        elif plain_mode: t['k'] = 'T'
        else: t['k'] = 'I' if k == 'U' else 'T'
    seq = [t for t in toks if 'w' in t]
    if plain_mode:
        mark_plain_instructions(seq)
    # brackets: "[הקהל עונה אמן]", "(אמן)" — unvocalised words in brackets are instructions
    for i, t in enumerate(seq):
        if t['k'] == 'T' and word_kind(t) == 'U' and re.match(r'^[\[(]', t['w']):
            j = i
            while j < len(seq) and not re.search(r'[\])]', seq[j]['w']) and j - i < 6: j += 1
            if j < len(seq) and all(word_kind(x) != 'T' for x in seq[i:j + 1]):
                grp = ' '.join(x['w'] for x in seq[i:j + 1])
                if t['w'].startswith('[') or classify(grp)['conds'] or re.search(VERBS_BR, norm_ins(grp)) or re.match(r'^\([א-ת]{1,3}\)$', grp):
                    for x in seq[i:j + 1]: x['k'] = 'I'
    # runs
    runs = []
    for t in toks:
        if 'w' not in t or t['k'] == 'N':
            if runs: runs[-1]['toks'].append(t)
            else: runs.append({'k': 'T', 'toks': [t]})
            continue
        if not runs or runs[-1]['k'] != t['k']: runs.append({'k': t['k'], 'toks': []})
        runs[-1]['toks'].append(t)
    # a lone unvocalised word inside the prayer (an abbreviation…) is text, unless it reads as an instruction
    for r in runs:
        if r['k'] != 'I': continue
        ws = [t for t in r['toks'] if 'w' in t and t['k'] == 'I']
        txt = ' '.join(t['w'] for t in ws)
        c = classify(txt)
        marked = any(t.get('ins') or t.get('small') for t in ws) or re.search(r'[\[\(\)\]]', txt) or txt.rstrip().endswith(':')
        if (len(ws) == 1 or len(ws) >= 4) and not c['conds'] and not marked and not re.search(r'(^|\s)(' + VERBS + r')(\s|$)', c['norm']):
            # a lone unvocalised word, or a stretch of unvocalised prayer in a vocalised line
            r['k'] = 'T'
            for t in ws: t['k'] = 'T'
    merged = []
    for r in runs:
        if merged and merged[-1]['k'] == r['k']: merged[-1]['toks'] += r['toks']
        else: merged.append(r)
    for r in merged:
        if r['k'] == 'I':
            r['text'] = ' '.join(t['w'] for t in r['toks'] if 'w' in t)
            r['c'] = classify(r['text'])
    return merged

def mark_plain_instructions(seq):
    """Unvocalised blocks: only recognisable instructions become instructions."""
    n = len(seq)
    # bold / small print that reads as an instruction ('''בחורף:''')
    i = 0
    while i < n:
        if seq[i].get('bold') or seq[i].get('small'):
            j = i
            while j + 1 < n and (seq[j + 1].get('bold') or seq[j + 1].get('small')): j += 1
            grp = ' '.join(t['w'] for t in seq[i:j + 1])
            c = classify(grp)
            if c['conds'] or re.search(r'(^|\s)(' + VERBS + r')(\s|$)', c['norm']):
                for t in seq[i:j + 1]: t['k'] = 'I'
            i = j
        i += 1
    allnorm = norm_ins(' '.join(t['w'] for t in seq))
    inner_colon = any(':' in t['w'] for t in seq[:-1])
    if n <= 8 and not inner_colon and (classify(allnorm)['conds'] or re.search(r'(^|\s)(' + VERBS + r')(\s|$)', allnorm)) and not any(NIKUD.search(t['w']) for t in seq):
        for t in seq: t['k'] = 'I'
        return
    # a leading "…:" of up to 8 words, at the start or after a sentence end
    i = 0
    while i < n:
        if i == 0 or re.search(r'[.:]$', seq[i - 1]['w']):
            for j in range(i, min(n, i + 8)):
                if j > i and '(' in seq[j]['w']: break
                if seq[j]['w'].endswith(':'):
                    grp = ' '.join(t['w'] for t in seq[i:j + 1])
                    c = classify(grp)
                    if c['conds'] or re.search(r'(^|\s)(' + VERBS + r')(\s|$)', c['norm']):
                        for t in seq[i:j + 1]: t['k'] = 'I'
                    break
        i += 1
    # a sentence that is plainly a note ("ועכשיו נהגו…", "ואם עשה צרכיו…")
    i = 0
    while i < n:
        if (i == 0 or re.search(r'[.:]$', seq[i - 1]['w'])) and re.match(NOTE_OPEN, norm_ins(seq[i]['w']) + ' ' + norm_ins(seq[i + 1]['w'] if i + 1 < n else '')):
            j = i
            while j < n - 1 and not re.search(r'[.:]$', seq[j]['w']): j += 1
            for t in seq[i:j + 1]: t['k'] = 'I'
            i = j
        i += 1
    # "(בחורף)", "(בעשי"ת: …)" — parenthesised conditions
    for i, t in enumerate(seq):
        m = re.search(r'\((.*)$', t['w'])
        if not m: continue
        j = i
        while j < n and ')' not in seq[j]['w'][1 if j == i else 0:] and j - i < 8: j += 1
        grp = ' '.join(x['w'] for x in seq[i:min(j, n - 1) + 1])
        inner = re.sub(r'^.*?\(', '', grp)
        head = re.split(r':', inner)[0]
        cg = classify(inner)
        if cg['conds'] and ')' in grp and len(inner.split()) <= 8 and re.search(r'(^|\s)(' + VERBS + r')(\s|$)', cg['norm']):
            for k in range(i, min(j, n - 1) + 1): seq[k]['k'] = 'I'      # "(בעשי"ת אומר … וכו')"
        elif classify(head)['conds'] and len(head.split()) <= 3:
            k = i
            while k <= min(j, n - 1):
                seq[k]['k'] = 'I'
                if ':' in seq[k]['w']: break
                k += 1

# ---------------------------------------------------------------- block -> HTML with explicit conditions
def tok_html(t):
    if t.get('br'): return '<br>'
    if t.get('sp'): return ' '
    h = htmlmod.escape(t['w'], quote=False)
    if t.get('bold'): h = '<b>' + h + '</b>'
    if t.get('small') and t.get('k') == 'T': h = '<small>' + h + '</small>'
    return h

def cond_attrs(c, barech=False):
    keys = [k + ('B' if barech and k in ('winter', 'summer') else '') for k in c['conds']]
    return ' data-w="' + ' '.join(keys) + '"' + (' data-n="1"' if c['neg'] else '')

SUB = {'rc', 'chmPesach', 'chmSukkot', 'pesach', 'sukkot', 'shavuot', 'shmini', 'rh', 'yk', 'chm', 'yomtov'}
def specialises(a, l):
    return a == l or (l == 'chm' and a in ('chmPesach', 'chmSukkot')) or (l in ('rc', 'chm', 'yomtov') and a in SUB)

TERM = re.compile(r'[,.:;׃]$')
class Block:
    def __init__(self, runs, dd):
        self.runs, self.dd = runs, dd
        self.wrap = []          # conditions on the whole block (outermost first): (conds, neg)
        self.html = ''
        self.plain = plain(' '.join(t['w'] for r in runs if r['k'] == 'T' for t in r['toks'] if 'w' in t))
        self.conds_inside = [r['c'] for r in runs if r['k'] == 'I' and r['c']['conds']]
        self.only_ins = not self.plain

def build_block(b):
    runs = b.runs
    barech = bool(re.search(r'(^|\s)(ברכנו|ברך עלינו|מברך השנים)(\s|$)', b.plain))
    condidx = [i for i, r in enumerate(runs) if r['k'] == 'I' and r['c']['conds']]
    first_T = next((i for i, r in enumerate(runs) if r['k'] == 'T' and plain(' '.join(t.get('w', '') for t in r['toks']))), len(runs))
    lead = runs[condidx[0]]['c'] if condidx and condidx[0] < first_T else None
    if lead and len(condidx) > 1:
        inner = [k for i in condidx[1:] for k in runs[i]['c']['conds']]
        if not all(any(specialises(a, l) for l in lead['conds']) for a in inner):
            lead = None                      # "(בחורף) … (בקיץ) …": the first is one of the alternatives
    b.block_cond = lead                      # "בחורף: …" at the start governs the whole block
    alts = condidx[1:] if lead else condidx  # conditions inside the block: alternatives
    parts = []
    st = {'open': False, 'paren': False, 'terms': 0, 'prev_terms': 0, 'limit': None, 'slash': False}
    def close():
        if st['open']:
            parts.append('</span>'); st['open'] = False; st['prev_terms'] = st['terms']
    label = lambda txt: '<span class="sd-i">' + htmlmod.escape(txt, quote=False) + '</span> '
    last_tok = ''
    for ri, r in enumerate(runs):
        if r['k'] == 'I':
            txt = r['text']
            if ri in alts:
                close()
                if re.match(r'^ביום ב', txt):            # "ביום בראש חודש: …" — "ביום" is said in every case
                    nxt = next((t for t in (runs[ri + 1]['toks'] if ri + 1 < len(runs) else []) if 'w' in t), {})
                    parts.append('<small>בְּיוֹם</small> ' if nxt.get('small') else 'בְּיוֹם '); txt = txt[5:]
                st['paren'] = last_tok.endswith('(') or txt.count('(') > txt.count(')')
                st['terms'] = 0
                is_last = ri == alts[-1]
                st['limit'] = None if not is_last else (max(1, st['prev_terms']) if len(alts) >= 2 else 1)
                parts.append('<span' + cond_attrs(r['c'], barech) + '>' + label(txt))
                st['open'] = True
                if txt.strip().startswith('(') and txt.strip().endswith(')') and re.search(r'(^|\s)(' + VERBS + r')(\s|$)', r['c']['norm']):
                    close()                                  # "(בעשי"ת אומר … וכו')" — a note only
            else:
                if re.search(r'כל השאר|שאר הנוסחאות|לשאר', r['c']['norm']): close()   # "נוסח עדות המזרח: … כל השאר: …"
                parts.append(label(txt))
            last_tok = txt
            continue
        for t in r['toks']:
            if t.get('w') == '/' and st['open']:
                close(); st['slash'] = True; continue
            if st['open'] and st['slash'] and st['limit'] is not None and 'w' in t and plain(t['w']) == 'הזה' and TERM.search(t['w']):
                close()        # "…/חַג הַמַּצּוֹת הַזֶּה," — "הַזֶּה" belongs to every alternative
            parts.append(tok_html(t))
            if 'w' not in t: continue
            last_tok = t['w']
            if not st['open']: continue
            if TERM.search(t['w']): st['terms'] += 1
            if st['paren']:
                if ')' in t['w']: close()
            elif st['limit'] is not None and st['terms'] >= st['limit']:
                close()
    close()
    h = re.sub(r'\s+', ' ', ''.join(parts)).strip()
    h = re.sub(r'^(<br>\s*)+|(\s*<br>)+$', '', h).strip()
    if lead: h = '<span' + cond_attrs(lead, barech) + '>' + h + '</span>'
    b.html = h

def wrap_html(b):
    h = b.html
    for conds, neg in reversed(b.wrap):
        h = '<span data-w="' + ' '.join(conds) + '"' + (' data-n="1"' if neg else '') + '>' + h + '</span>'
    return h

def loose(words):
    """a regex for these words with any vowel marks"""
    return r'\s+'.join('[\u0591-\u05c7]*'.join(re.escape(ch) for ch in w) + '[\u0591-\u05c7]*' for w in words.split())
AYT_FIX = [   # the Ten Days endings, when the page leaves them out
    (loose('האל הקדוש'), 'הַמֶּלֶךְ הַקָּדוֹשׁ'),
    (loose('מלך אוהב צדקה ומשפט'), 'הַמֶּלֶךְ הַמִּשְׁפָּט'),
]
def ayt_fix(b, nxt):
    if any('ayt' in c['conds'] for c in b.conds_inside):
        for pat, rep in AYT_FIX:      # "… מֶלֶךְ אוֹהֵב צְדָקָה וּמִשְׁפָּט: (בעשי"ת: הַמֶּלֶךְ הַמִּשְׁפָּט)" — the everyday ending is replaced
            b.html = re.sub(r'(?<![>"])(' + pat + r')([\s.:׃,]*)(<span data-w="ayt">)', r'<span data-w="ayt" data-n="1">\1</span>\2\3', b.html, count=1)
            b.html = re.sub(r'(<span data-w="ayt"><span class="sd-i">\(?[^<]*</span>[^<]*</span>\s*)(' + pat + r')', r'\1<span data-w="ayt" data-n="1">\2</span>', b.html, count=1)
        return
    if nxt is not None and getattr(nxt, 'block_cond', None) and 'ayt' in nxt.block_cond['conds']: return
    for pat, rep in AYT_FIX:
        m = re.search(r'(בָּרוּךְ אַתָּה|ברוך אתה)[^<]{0,40}?\s(' + pat + r')([\s.:׃,]*)$', b.html)
        if m and not re.search(r'בעשרת|עשי', b.html[m.start():]):
            s = m.start(2)
            b.html = (b.html[:s] + '<span data-w="ayt" data-n="1">' + m.group(2) + '</span><span data-w="ayt">'
                      + '<span class="sd-i">(בעשרת ימי תשובה:</span> ' + rep + '<span class="sd-i">)</span></span>' + m.group(3))
            return

def convert_page(html, prayer, he):
    """-> list of leaves {p: path, h: Hebrew title, s: [segment html]}"""
    blocks_raw = page_blocks(html)
    leaves, h2, h3 = [], None, None
    cur = None
    anchors = ANCHORS.get(prayer, [])
    aptr = 0
    def new_leaf(title2, title3=None):
        nonlocal cur
        path = he + ', ' + title2 + ((', ' + title3) if title3 else '')
        cur = {'p': path, 'h': path, 'blocks': []}
        leaves.append(cur)
    for item in blocks_raw:
        if item[0] == 'h2':
            h2, h3 = item[1], None; new_leaf(h2); continue
        if item[0] == 'h3':
            h3 = item[1]; new_leaf(h2 or he, h3); continue
        runs = block_runs(item[1])
        b = Block(runs, item[2])
        pl = plain(' '.join(t['w'] for t in item[1] if 'w' in t))
        for ai in range(aptr, min(len(anchors), aptr + 2)):      # in order (one may be missing)
            pat, name = anchors[ai]
            if re.search(pat, pl):
                new_leaf(name); aptr = ai + 1; break
        if DROP_BLOCK.match(pl): continue
        if cur is None: new_leaf(he)
        cur['blocks'].append(b)
    for leaf in leaves:
        bl = leaf['blocks']
        for b in bl: build_block(b)
        cross_block(bl)
        for i, b in enumerate(bl): ayt_fix(b, bl[i + 1] if i + 1 < len(bl) else None)
        leaf['s'] = [wrap_html(b) for b in bl if b.html]
        del leaf['blocks']
    # merge empty heading-only leaves into nothing
    return [l for l in leaves if l['s']]

def first_words(s, n=3): return ' '.join(s.split()[:n])

def cross_block(bl):
    yaaleh = re.compile(r'(^|\s)יעלה ויבו?א')
    for i, b in enumerate(bl):
        c = b.block_cond
        # an instruction on a line of its own: governs the next line (the whole of יעלה ויבוא, if that follows)
        if b.only_ins and b.conds_inside:
            c0 = b.conds_inside[0]
            b.html = '<span' + cond_attrs(c0) + '>' + b.html + '</span>'
            j = i + 1
            if j < len(bl):
                end = j + 1
                if yaaleh.search(bl[j].plain):
                    while end < len(bl) and not re.match(r'^(ו?תרצנו|ו?תחזינה|ותחזנה|מודים)', bl[end].plain): end += 1
                for k in range(j, end): bl[k].wrap.append((c0['conds'], c0['neg']))
            continue
        # "… במקום זאת:" / "… במקום תשכון:" / the same text again with an addition: replaces a line
        if c and (c.get('repl') is not None or True) and not c['neg'] and 'other' not in c['conds']:
            target = None
            if c.get('repl'):
                want = plain(c['repl'])
                for k in list(range(i - 1, max(-1, i - 4), -1)) + list(range(i + 1, min(len(bl), i + 4))):
                    if not bl[k].block_cond and bl[k].plain.startswith(want): target = bl[k]; break
            else:
                prev = next((bl[k] for k in range(i - 1, max(-1, i - 5), -1) if not bl[k].block_cond and not bl[k].only_ins), None)
                if c.get('repl') == '' or (prev and len(b.plain) > 30 and first_words(prev.plain, 4) == first_words(b.plain, 4)):
                    target = prev
            if target is not None:
                target.wrap.append((c['conds'], True))
    # "בת"ץ אומרים ברכת כהנים:" — the lines about the Kohanim that follow belong to it
    for i, b in enumerate(bl):
        if b.block_cond and re.search(r'ברכת כהנים', b.block_cond['norm']):
            k = i + 1
            while k < len(bl) and not bl[k].block_cond and any(r['k'] == 'I' and re.search(r'כהנים|הכהנים', r['c']['norm']) for r in bl[k].runs[:2]):
                bl[k].wrap.append((b.block_cond['conds'], False)); k += 1
    # יעלה ויבוא: its condition (written or not) governs every line up to "ותחזינה" / "מודים"
    for i, b in enumerate(bl):
        if not yaaleh.search(b.plain) or b.only_ins: continue
        if b.block_cond: c = (b.block_cond['conds'], False)
        elif b.wrap: c = b.wrap[0]
        else:
            c = (['rc', 'chm', 'yomtov', 'rh'], False); b.wrap.append(c)
        k = i + 1
        while k < len(bl) and k - i < 14 and not re.match(r'^(ו?תרצנו|ו?תחזינה|ותחזנה|מודים)', bl[k].plain):
            if c not in bl[k].wrap: bl[k].wrap.insert(0, c)
            k += 1

def convert(pages):
    """pages: {prayer: html} -> data object"""
    out = {'leaves': []}
    for title, prayer, he in PAGES:
        if prayer in pages: out['leaves'] += convert_page(pages[prayer], prayer, he)
    return out

def signature(data):
    """What the site will vary by day — compared between updates (a change needs a look)."""
    sig = []
    for l in data['leaves']:
        for s in l['s']:
            for m in re.finditer(r'data-w="([^"]+)"( data-n="1")?', s):
                sig.append(l['p'].split(',')[0] + ':' + m.group(1) + ('!' if m.group(2) else ''))
    return sig

# ---------------------------------------------------------------- download + the weekly update
UA = 'limood.org.il siddur updater (https://limood.org.il)'
def fetch_page(title, tries=3):
    """The rendered HTML of a Wikisource page (templates and included pages expanded) and its revision."""
    import urllib.parse, urllib.request, time
    q = urllib.parse.quote(title)
    urls = [('https://he.wikisource.org/w/api.php?action=parse&page=' + q + '&prop=text|revid&disableeditsection=1&format=json', 'api'),
            ('https://he.wikisource.org/w/index.php?title=' + q + '&action=render', 'render')]
    last = None
    for url, kind in urls:
        for a in range(tries):
            try:
                req = urllib.request.Request(url, headers={'User-Agent': UA})
                with urllib.request.urlopen(req, timeout=60) as r:
                    body = r.read().decode('utf-8')
                if kind == 'api':
                    d = json.loads(body).get('parse') or {}
                    html = (d.get('text') or {}).get('*') or ''
                    if html: return html, d.get('revid')
                else:
                    if body: return body, None
            except Exception as e:
                last = e
                time.sleep(4 + a * 6)
    raise RuntimeError(f'{title}: {last}')

def tidy(data):
    for l in data['leaves']:
        l['s'] = [re.sub(r'</small>(\s*)<small>', r'\1', x) for x in l['s']]
    return data

def update(U):
    """Called by update_sources.py (U = that module: report, problems, write_if_changed, wrapper, read_json, TODAY)."""
    pages, revs = {}, {}
    for title, prayer, he in PAGES:
        try:
            html, rev = fetch_page(title)
        except Exception as e:
            U.problems.append(f'**סידור נוסח תימן**: לא ניתן היה להוריד את "{title}" מוויקיטקסט ({e}) — הקובץ לא עודכן.')
            return
        if len(html) < 3000:
            U.problems.append(f'**סידור נוסח תימן**: הדף "{title}" בוויקיטקסט קצר מדי — הקובץ לא עודכן.')
            return
        pages[prayer], revs[prayer] = html, rev
    data = tidy(convert(pages))
    old = U.read_json('src-siddur-baladi.json')
    # sanity: every prayer is there, and nothing big disappeared
    have = {l['p'].split(',')[0] for l in data['leaves']}
    missing = [he for _, _, he in PAGES if he not in have]
    size = lambda d: sum(len(x) for l in d['leaves'] for x in l['s'])
    if missing or (old and size(data) < 0.7 * size(old)):
        U.problems.append('**סידור נוסח תימן**: ' + (f'חסרים בנוסח החדש: {", ".join(missing)}' if missing else 'הנוסח החדש קצר בהרבה מהקודם')
                          + ' — הקובץ לא עודכן. כדאי לבדוק את הדפים בוויקיטקסט.')
        return
    obj = {'source': 'ויקיטקסט — סידור/נוסח תימן בלדי', 'license': 'CC-BY-SA',
           'pages': [{'title': t, 'revid': revs.get(pr)} for t, pr, _ in PAGES], 'leaves': data['leaves']}
    if old and old.get('leaves') == obj['leaves']:
        U.wrapper('data-siddur-baladi.json', 'src-siddur-baladi.json'); return
    obj['downloaded'] = U.TODAY
    line = '- **סידור נוסח תימן (בלדי)** (`_includes/src-siddur-baladi.json`): ' + ('הנוסח בוויקיטקסט עודכן' if old else 'נוסף לאתר')
    if old:
        a, b = signature(old), signature(obj)
        if a != b:
            U.problems.append('**סידור נוסח תימן**: השתנו החלקים שמשתנים לפי היום (' + str(len(a)) + ' → ' + str(len(b))
                              + ') — כדאי לפתוח את הדף עם "נוסח מלא" ולוודא שהתוספות (יעלה ויבוא, על הניסים, עננו, ברכנו…) מסומנות נכון לפני אישור.')
        changed = sorted({l['p'] for l in obj['leaves']} ^ {l['p'] for l in old['leaves']} |
                         {l['p'] for l in obj['leaves'] for m in old['leaves'] if m['p'] == l['p'] and m['s'] != l['s']})
        if changed: line += '\n  - קטעים שהשתנו: ' + ', '.join(changed[:12]) + (' …' if len(changed) > 12 else '')
    U.report.append(line)
    U.write_if_changed('src-siddur-baladi.json', obj)
    U.wrapper('data-siddur-baladi.json', 'src-siddur-baladi.json')

if __name__ == '__main__':
    folder = sys.argv[1]
    pages = {}
    for title, prayer, he in PAGES:
        p = os.path.join(folder, title.split('/')[-1] + '.html')
        if os.path.exists(p): pages[prayer] = open(p, encoding='utf-8').read()
    data = tidy(convert(pages))
    json.dump(data, sys.stdout, ensure_ascii=False, indent=0)
