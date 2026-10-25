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

BOOKS = [   # key (as in siddur.js), Sefaria title, Hebrew name, options
    ('sefard', 'Siddur Sefard', 'סידור נוסח ספרד', {}),
    ('edot', 'Siddur Edot HaMizrach', 'סידור עדות המזרח', {}),
    # Sefaria's main Hebrew edition (Torat Emet) has no stated licence: the Metsudah siddur (CC-BY) instead
    ('ashkenaz', 'Siddur Ashkenaz', 'סידור נוסח אשכנז', {'prefer': [
        'The Metsudah siddur, 1981',
        'The Metsudah siddur: a new linear siddur with English translation by Avrohom Davis, 1981',
        'Daat Siddur Ashkenaz']}),
    # Sefaria's edition is the Hebrew Wikisource text (סידור תורה אור) — Wikisource is CC-BY-SA
    ('chabad', 'Weekday Siddur Chabad', 'סידור נוסח חב״ד', {'licenses': {'Wikisource': 'CC-BY-SA'}}),
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

def U_retry(e, a):
    from update_sources import retry_wait
    return retry_wait(e, a)

def get_json(url, tries=6):
    import urllib.request, urllib.error
    for a in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'limood.org.il source updater (https://limood.org.il)'})
            with urllib.request.urlopen(req, timeout=60) as r: return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 404: return None
            if a == tries - 1: raise
            time.sleep(min(U_retry(e, a), 300)); continue
        except Exception as e:
            if a == tries - 1: raise
        time.sleep(3 + a * 5)

def leaf_text(U, ref, opts=None, version=None):
    opts = opts or {}
    q = 'hebrew' if version is None else 'hebrew|' + version
    d = get_json('https://www.sefaria.org/api/v3/texts/' + urllib.parse.quote(ref) + '?version=' + urllib.parse.quote(q)) or {}
    v = (d.get('versions') or [None])[0]
    time.sleep(0.25)
    segs = flatten(v.get('text')) if v else []
    m = {'versionTitle': v.get('versionTitle'), 'license': v.get('license')} if v else None
    if m and m['versionTitle'] in (opts.get('licenses') or {}): m['license'] = opts['licenses'][m['versionTitle']]
    if version is None and (not m or not segs or not license_ok(m['license'])):
        for alt in opts.get('prefer') or []:          # a free edition of the same piece
            s2, m2 = leaf_text(U, ref, opts, alt)
            if m2 and s2 and license_ok(m2['license']): return s2, m2
    if not m: return None, None
    return segs, m

def update_book(U, key, book, he, opts=None):
    leaves = leaves_of(U, book)
    if not leaves: raise RuntimeError('no table of contents')
    texts, meta, remote = {}, None, []
    for i, l in enumerate(leaves):
        segs, m = leaf_text(U, l['r'], opts)
        if m is None or (not segs and not license_ok(m['license'])): continue   # a heading with no text of its own
        if not license_ok(m['license']):
            remote.append({'r': l['r'], 'v': m['versionTitle']})    # no free edition: the page reads it from Sefaria
            if len(remote) > max(3, len(leaves) // 10):
                return f'נשאר בטעינה מספריא — המהדורה "{m["versionTitle"]}" ברישיון {m["license"] or "לא ידוע"}'
            continue
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
             'alsoVersions': sorted(meta.get('others') or []),      # pieces from another (free) edition
             'note': 'נוצר אוטומטית מספריא — לא לערוך ידנית',
             'remote': remote,        # pieces with no free edition — still read from Sefaria by the page
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
    if remote and (not old or [x['r'] for x in old.get('remote') or []] != [x['r'] for x in remote]):
        line += f'\n  - {len(remote)} קטעים בלי מהדורה חופשית נשארים בטעינה מספריא: ' + ', '.join(x['r'].split(', ', 1)[-1] for x in remote)
    if old and changed:
        line += '\n  - לדוגמה: ' + ', '.join(sorted(changed)[:6])
    U.report.append(line)
    return None

def update(U):
    for key, book, he, opts in BOOKS:
        try:
            skipped = update_book(U, key, book, he, opts)
            if skipped:
                print(he, skipped)
                if U.read_json(f'src-siddur-{key}.json'):
                    U.problems.append(f'**{he}**: {skipped}. העותק שבאתר לא עודכן — כדאי להחליט אם להסיר אותו.')
        except Exception as e:
            U.problems.append(f'**{he}**: העדכון מספריא נכשל ({e}) — האתר ממשיך עם הקבצים הקיימים / ספריא.')
