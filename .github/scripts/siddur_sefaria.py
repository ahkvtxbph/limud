#!/usr/bin/env python3
"""
Local copies of the siddurim the site takes from Sefaria — only where Sefaria's Hebrew edition has a
licence that also allows a site with ads (Public Domain / CC0 / CC-BY / CC-BY-SA). Otherwise the
page keeps loading that siddur from Sefaria, as before.

  _includes/src-siddur-<key>.json        the table of contents: [{r: Sefaria ref, p: path, h: Hebrew, c: chunk}]
  _includes/src-siddur-<key>-<n>.json    the texts: {texts: {ref: [segment html, …]}}
  data-siddur-<key>*.json                 published copies (Jekyll wrappers)

Exactly the same requests the page itself makes (siddur.js: sdLoadLeaves / sdFetchLeaf), so the page
reads the same text, just from the site. Used by update_sources.py once a week (goes through the PR).
"""
import json, os, re, time, urllib.parse

BOOKS = [   # key (as in siddur.js), Sefaria title, Hebrew name
    ('sefard', 'Siddur Sefard', 'סידור נוסח ספרד'),
    ('edot', 'Siddur Edot HaMizrach', 'סידור עדות המזרח'),
    ('ashkenaz', 'Siddur Ashkenaz', 'סידור נוסח אשכנז'),
    ('chabad', 'Weekday Siddur Chabad', 'סידור נוסח חב״ד'),
]
OK_LICENSES = ('public domain', 'cc0', 'cc-by', 'cc-by-sa')
CHUNK_BYTES = 1_100_000

def license_ok(lic):
    l = (lic or '').strip().lower()
    return l in OK_LICENSES or l.startswith('cc-by-sa') or (l.startswith('cc-by') and 'nc' not in l and 'nd' not in l)

def leaves_of(U, book):
    """The pieces of the book, in order — as sdLoadLeaves in siddur.js."""
    out = []
    try:
        data = U.http_json('https://www.sefaria.org/api/shape/' + urllib.parse.quote(book))
        def walk(node):
            if isinstance(node, list):
                for x in node: walk(x)
                return
            if not isinstance(node, dict): return
            ch = node.get('chapters')
            nested = isinstance(ch, list) and any(isinstance(x, dict) for x in ch)
            if isinstance(node.get('title'), str) and node['title'] != book and not nested:
                out.append({'r': node['title'], 'h': node.get('heTitle') or ''}); return
            if nested: walk(ch)
        walk(data)
    except Exception:
        out = []
    if not out:
        data = U.http_json('https://www.sefaria.org/api/v2/raw/index/' + urllib.parse.quote(book))
        def title(node, lang):
            t = [x for x in node.get('titles') or [] if x.get('lang') == lang]
            p = next((x for x in t if x.get('primary')), t[0] if t else None)
            return p['text'] if p else (node.get('key', '') if lang == 'en' else '')
        def walk(node, en, he):
            dflt = node.get('default') or node.get('key') == 'default'
            my_en = en if dflt else (en + ', ' if en else '') + title(node, 'en')
            my_he = he if dflt else (he + ', ' if he else '') + title(node, 'he')
            if node.get('nodes'):
                for n in node['nodes']: walk(n, my_en, my_he)
            else:
                out.append({'r': book + ', ' + my_en, 'h': my_he})
        walk(data.get('schema') or {}, '', '')
    pre = book + ', '
    for l in out: l['p'] = l['r'][len(pre):] if l['r'].startswith(pre) else l['r']
    return out

def flatten(t, out=None):
    out = [] if out is None else out
    if isinstance(t, list):
        for x in t: flatten(x, out)
    elif t is not None and t != '':
        out.append(str(t))
    return out

def get_json(url, tries=4):
    import urllib.request, urllib.error
    for a in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'limood.org.il source updater (https://limood.org.il)'})
            with urllib.request.urlopen(req, timeout=60) as r: return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 404: return None
            if a == tries - 1: raise
        except Exception:
            if a == tries - 1: raise
        time.sleep(3 + a * 5)

def leaf_text(U, ref):
    d = get_json('https://www.sefaria.org/api/v3/texts/' + urllib.parse.quote(ref) + '?version=hebrew') or {}
    v = (d.get('versions') or [None])[0]
    time.sleep(0.25)
    if not v: return None, None
    return flatten(v.get('text')), {'versionTitle': v.get('versionTitle'), 'license': v.get('license')}

def update_book(U, key, book, he):
    leaves = leaves_of(U, book)
    if not leaves: raise RuntimeError('no table of contents')
    texts, meta = {}, None
    for i, l in enumerate(leaves):
        segs, m = leaf_text(U, l['r'])
        if m is None: continue                     # a heading with no text of its own
        if not license_ok(m['license']):
            return f'נשאר בטעינה מספריא — המהדורה "{m["versionTitle"]}" ברישיון {m["license"] or "לא ידוע"}'
        if meta is None: meta = m
        elif m['versionTitle'] != meta['versionTitle']:
            meta.setdefault('others', set()).add(m['versionTitle'])
        if segs: texts[l['r']] = segs
    if not texts: raise RuntimeError('no text')
    # chunks of ~1MB, in book order
    chunks, cur, size = [], {}, 0
    for l in leaves:
        if l['r'] not in texts: continue
        b = len(json.dumps(texts[l['r']], ensure_ascii=False).encode())
        if cur and size + b > CHUNK_BYTES: chunks.append(cur); cur, size = {}, 0
        cur[l['r']] = texts[l['r']]; size += b
        l['c'] = len(chunks)
    if cur: chunks.append(cur)
    index = {'book': book, 'versionTitle': meta['versionTitle'], 'license': meta['license'],
             'alsoVersions': sorted(meta.get('others') or []),      # a few pieces come from another (free) edition
             'note': 'נוצר אוטומטית מספריא — לא לערוך ידנית',
             'leaves': [{k: l[k] for k in ('r', 'p', 'h', 'c') if k in l} for l in leaves]}
    old = U.read_json(f'src-siddur-{key}.json')
    old_texts = {}
    if old:
        for n in range(1 + max([x.get('c', 0) for x in old.get('leaves', [])] or [0])):
            o = U.read_json(f'src-siddur-{key}-{n}.json')
            if o: old_texts.update(o.get('texts') or {})
    changed = [r for r in set(texts) | set(old_texts) if texts.get(r) != old_texts.get(r)]
    same_index = old and {k: v for k, v in old.items() if k != 'downloaded'} == index
    if same_index and not changed:
        for n in range(len(chunks)): U.wrapper(f'data-siddur-{key}-{n}.json', f'src-siddur-{key}-{n}.json')
        U.wrapper(f'data-siddur-{key}.json', f'src-siddur-{key}.json')
        return None
    index['downloaded'] = U.TODAY
    U.write_if_changed(f'src-siddur-{key}.json', index)
    U.wrapper(f'data-siddur-{key}.json', f'src-siddur-{key}.json')
    for n, ch in enumerate(chunks):
        U.write_if_changed(f'src-siddur-{key}-{n}.json', {'book': book, 'versionTitle': meta['versionTitle'], 'texts': ch})
        U.wrapper(f'data-siddur-{key}-{n}.json', f'src-siddur-{key}-{n}.json')
    # leftovers from a longer earlier version
    for f in os.listdir(U.INC):
        m = re.fullmatch(rf'src-siddur-{key}-(\d+)\.json', f)
        if m and int(m.group(1)) >= len(chunks):
            os.remove(os.path.join(U.INC, f))
            w = os.path.join(U.ROOT, f'data-siddur-{key}-{m.group(1)}.json')
            if os.path.exists(w): os.remove(w)
    line = f'- **{he}** (`_includes/src-siddur-{key}*.json`): ' + (f'{len(changed)} קטעים השתנו' if old else f'נוסף לאתר ({len(texts)} קטעים, {len(chunks)} קבצים)')
    if old and changed:
        line += '\n  - לדוגמה: ' + ', '.join(sorted(changed)[:6])
    U.report.append(line)
    return None

def update(U):
    for key, book, he in BOOKS:
        try:
            skipped = update_book(U, key, book, he)
            if skipped:
                print(he, skipped)
                if U.read_json(f'src-siddur-{key}.json'):
                    U.problems.append(f'**{he}**: {skipped}. העותק שבאתר לא עודכן — כדאי להחליט אם להסיר אותו.')
        except Exception as e:
            U.problems.append(f'**{he}**: העדכון מספריא נכשל ({e}) — האתר ממשיך עם הקבצים הקיימים / ספריא.')
