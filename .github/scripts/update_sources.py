#!/usr/bin/env python3
"""
Refreshes the texts the site keeps locally (in _includes/) from Sefaria.

  Tehillim ............. _includes/tehillim-text.json
  Birkat HaMazon ....... _includes/birkat-ashkenaz.json, birkat-sefard.json, birkat-edot.json
  Halacha Yomit ........ _includes/halacha-text-oc.json / -yd / -eh / -cm / -kitzur.json
                         _includes/halacha-manifest.json  (simanim, se'if counts, topics, versions)
                         _includes/halacha-schedule.json  (which halacha is learned on which date)
  Arukh HaShulchan, Mishnah + Bartenura, Rambam, Tanakh + Rashi + Onkelos
                         _includes/src-*.json + data-*.json (see update_library.py)
                         _includes/src-schedule.json       (daily-learning dates for those pages)

A file is rewritten only when its TEXT really changed, so an unchanged source leaves no diff.
Run by .github/workflows/update-sources.yml (weekly); can also be run by hand:
    python3 .github/scripts/update_sources.py               # from the Sefaria API
    python3 .github/scripts/update_sources.py --schedule-only
Writes a short Hebrew report (for the pull request) to $REPORT_FILE (default: update-report.md).
"""
import hashlib, json, os, re, sys, time, urllib.parse, urllib.request
from datetime import date, timedelta

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
INC = os.path.join(ROOT, '_includes')
API = 'https://www.sefaria.org/api'
TODAY = date.today().isoformat()

BIRKAT = [
    ('ashkenaz', 'Siddur Ashkenaz, Berachot, Birkat HaMazon', 'נוסח אשכנז'),
    ('sefard',   'Siddur Sefard, Birchat HaMazon, Birchat HaMazon', 'נוסח ספרד'),
    ('edot',     'Siddur Edot HaMizrach, Post Meal Blessing', 'נוסח עדות המזרח'),
]
# key, Sefaria title, Hebrew name, published file (root wrapper)
BOOKS = [
    ('oc',     'Shulchan Arukh, Orach Chayim',   'שולחן ערוך — אורח חיים'),
    ('yd',     "Shulchan Arukh, Yoreh De'ah",    'שולחן ערוך — יורה דעה'),
    ('eh',     'Shulchan Arukh, Even HaEzer',    'שולחן ערוך — אבן העזר'),
    ('cm',     'Shulchan Arukh, Choshen Mishpat','שולחן ערוך — חושן משפט'),
    ('kitzur', 'Kitzur Shulchan Arukh',          'קיצור שולחן ערוך'),
]
CALENDAR_ITEMS = ['Halakhah Yomit']                      # -> _includes/halacha-schedule.json
OTHER_CALENDAR_ITEMS = ['Arukh HaShulchan Yomi', 'Daily Mishnah', 'Daily Rambam', 'Daily Rambam (3 Chapters)',
                        'Tanakh Yomi', '929']              # -> _includes/src-schedule.json (+ data-schedule.json)
SCHEDULE_DAYS_BACK, SCHEDULE_DAYS_AHEAD = 7, 120

report = []          # lines for the pull-request description
problems = []        # anything that needs a human look

# ---------------------------------------------------------------- helpers
def http_json(url, tries=4):
    for a in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'limood.org.il source updater'})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except Exception as e:
            if a == tries - 1: raise
            time.sleep(3 + a * 5)

def texts_api(ref):
    """Same request the site makes: primary Hebrew version, text only."""
    url = f"{API}/v3/texts/{urllib.parse.quote(ref)}?version=hebrew&return_format=text_only"
    d = http_json(url)
    v = (d.get('versions') or [None])[0]
    if not v: raise RuntimeError('no Hebrew version for ' + ref)
    time.sleep(0.3)
    return v

def clean(s):
    """What the API's text_only gives for raw export HTML: <br> -> space, tags removed, trimmed."""
    if not isinstance(s, str): return s
    s = re.sub(r'<br\s*/?>', ' ', s)
    s = re.sub(r'<[^>]+>', '', s)
    return s.strip()

def flat(n, out=None):
    out = [] if out is None else out
    if isinstance(n, list):
        for x in n: flat(x, out)
    elif n is not None:
        out.append(n)
    return out

def dumps(obj):
    # one item per line, so a change shows up in GitHub as a change of just that line
    s = json.dumps(obj, ensure_ascii=False, indent=0, separators=(',', ':'))
    # the files are pulled into pages by Jekyll: Liquid tags or a closing </script> would break them
    if '{{' in s or '{%' in s or '</' in s:
        raise RuntimeError('text contains characters that would break the page ({{, {% or </)')
    return s

def read_json(name):
    p = os.path.join(INC, name)
    if not os.path.exists(p): return None
    with open(p, encoding='utf-8') as f: return json.load(f)

def write_json(name, obj):
    with open(os.path.join(INC, name), 'w', encoding='utf-8') as f: f.write(dumps(obj))

def count_changes(old, new):
    a, b = flat(old or []), flat(new or [])
    n = sum(1 for x, y in zip(a, b) if x != y) + abs(len(a) - len(b))
    return n, len(a), len(b)

def first_diff(old, new):
    """(where, before, after) for the first changed piece, or None."""
    old, new = old or [], new or []
    nested = any(isinstance(x, list) for x in old + new)
    pairs = []
    if nested:   # simanim -> se'ifim
        for si in range(max(len(old), len(new))):
            a = old[si] if si < len(old) else []
            b = new[si] if si < len(new) else []
            for k in range(max(len(a), len(b))):
                pairs.append((f'סימן {si + 1} סעיף {k + 1}', a[k] if k < len(a) else '(אין)', b[k] if k < len(b) else '(אין)'))
    else:
        for k in range(max(len(old), len(new))):
            pairs.append((f'קטע {k + 1}', old[k] if k < len(old) else '(אין)', new[k] if k < len(new) else '(אין)'))
    return next((p for p in pairs if p[1] != p[2]), None)

def around_change(a, b, n=70):
    """The two strings cut to a window around the first character where they differ."""
    a, b = str(a), str(b)
    i = next((k for k in range(min(len(a), len(b))) if a[k] != b[k]), min(len(a), len(b)))
    start = max(0, i - n // 2)
    cut = lambda s: ('…' if start else '') + s[start:start + n] + ('…' if len(s) > start + n else '')
    return cut(a), cut(b)

def save_if_changed(name, meta, text, label):
    old = read_json(name)
    if old is not None and old.get('text') == text and old.get('versionTitle') == meta.get('versionTitle'):
        return False
    if old is not None and old.get('versionTitle') and old.get('versionTitle') != meta.get('versionTitle'):
        problems.append(f"**{label}**: ספריא החליפה את המהדורה הראשית — מ־\"{old.get('versionTitle')}\" ל־\"{meta.get('versionTitle')}\" (רישיון: {meta.get('license')}). כדאי לבדוק לפני אישור.")
    n, a, b = count_changes(old.get('text') if old else None, text)
    line = f"- **{label}** (`_includes/{name}`): {n} קטעים השתנו" + (f" (היו {a}, עכשיו {b})" if a != b else '')
    d = first_diff(old.get('text') if old else None, text)
    if d:
        before, after = around_change(d[1], d[2])
        line += f"\n  - לדוגמה, {d[0]}:\n    - לפני: {before}\n    - אחרי: {after}"
    report.append(line)
    write_json(name, {**meta, 'downloaded': TODAY, 'text': text})
    return True

# ---------------------------------------------------------------- Tehillim + Birkat HaMazon
def update_tehillim():
    chapters, meta = [], None
    for c in range(1, 151):
        v = texts_api(f'Psalms.{c}')
        m = {'source': 'Sefaria — Psalms, "' + v.get('versionTitle', '') + '"', 'versionTitle': v.get('versionTitle'),
             'license': v.get('license'), 'versionSource': v.get('versionSource') or ''}
        meta = meta or m
        chapters.append([clean(x) if x is not None else '' for x in v.get('text') or []])
    if len(chapters) != 150 or len(chapters[118]) != 176:
        problems.append('**תהילים**: מבנה לא צפוי (מספר פרקים/פסוקים) — הקובץ לא עודכן.')
        return
    save_if_changed('tehillim-text.json', meta, chapters, 'תהילים')

def update_birkat():
    for key, ref, label in BIRKAT:
        v = texts_api(ref)
        segs = [clean(s) for s in flat(v.get('text'))]
        if len(segs) < 20:
            problems.append(f'**ברכת המזון — {label}**: התקבל טקסט קצר מדי ({len(segs)} קטעים) — הקובץ לא עודכן.')
            continue
        meta = {'source': f"Sefaria — {ref} ({(v.get('versionTitle') or '').strip()})", 'versionTitle': v.get('versionTitle'),
                'license': v.get('license'), 'versionSource': v.get('versionSource') or ''}
        save_if_changed(f'birkat-{key}.json', meta, segs, f'ברכת המזון — {label}')

# ---------------------------------------------------------------- Halacha
def shape_counts(title):
    d = http_json(f"{API}/shape/{urllib.parse.quote(title)}")
    node = next((x for x in d if isinstance(x, dict) and x.get('title') == title), d[0]) if isinstance(d, list) else d
    return [n if isinstance(n, int) else (len(n) if isinstance(n, list) else 0) for n in node.get('chapters', [])]

def topic_nodes(title):
    d = http_json(f"{API}/v2/raw/index/{urllib.parse.quote(title)}")
    return flatten_topics(((d.get('alt_structs') or {}).get('Topic') or {}).get('nodes') or [])

def flatten_topics(nodes):
    out = []
    def walk(lst):
        for n in lst:
            if n.get('nodes'): walk(n['nodes'])
            he = next((t.get('text') for t in n.get('titles', []) if t.get('lang') == 'he' and t.get('primary')), None) \
                 or next((t.get('text') for t in n.get('titles', []) if t.get('lang') == 'he'), None)
            if n.get('wholeRef') and he: out.append({'r': n['wholeRef'], 'he': he.strip()})
    walk(nodes)
    return out

def book_text_api(title, n):
    simanim, version, step = [], None, 25
    for a in range(1, n + 1, step):
        b = min(n, a + step - 1)
        v = texts_api(f'{title} {a}-{b}')
        chunk = v.get('text') or []
        if version is None: version = v
        elif v.get('versionTitle') != version.get('versionTitle'):
            raise RuntimeError(f'{title}: mixed versions in one book')
        if a == b: chunk = [chunk]
        if len(chunk) != b - a + 1:       # unexpected shape: fetch this range siman by siman
            chunk = [texts_api(f'{title} {k}').get('text') or [] for k in range(a, b + 1)]
        for s in chunk:
            simanim.append([clean(x) if isinstance(x, str) else '' for x in (s if isinstance(s, list) else [s])])
    return simanim, version

def update_halacha(manifest):
    books = manifest.setdefault('books', {})
    topics = manifest.setdefault('topics', {})
    for key, title, label in BOOKS:
        counts = shape_counts(title)
        text, v = book_text_api(title, len(counts))
        if sum(1 for s in text if any(s)) < len(text) * 0.8:
            problems.append(f'**{label}**: חסר טקסט בחלק גדול מהסימנים — הקובץ לא עודכן.')
            continue
        meta = {'source': f"Sefaria — {title} ({(v.get('versionTitle') or '').strip()})", 'title': title,
                'versionTitle': v.get('versionTitle'), 'license': v.get('license'), 'versionSource': v.get('versionSource') or ''}
        name = f'halacha-text-{key}.json'
        save_if_changed(name, meta, text, label)
        cur = read_json(name)
        entry = {'he': label, 'file': f'halacha-data-{key}.json', 'v': version_hash(cur['text']),
                 'counts': [len(s) for s in cur['text']], 'license': cur.get('license'), 'versionTitle': cur.get('versionTitle')}
        if books.get(title) != entry:
            if books.get(title) and books[title].get('counts') != entry['counts']:
                report.append(f"- **{label}**: מספר הסעיפים השתנה בחלק מהסימנים")
            books[title] = entry
        t = topic_nodes(title)
        if t and topics.get(title) != t:
            if topics.get(title): report.append(f'- **{label}**: רשימת הנושאים (הלכות …) עודכנה')
            topics[title] = t

def version_hash(text):
    return hashlib.sha1(dumps(text).encode('utf-8')).hexdigest()[:12]

def update_schedule():
    """One calendar request per day fills both schedule files. Returns True if either changed."""
    files = {'halacha-schedule.json': CALENDAR_ITEMS, 'src-schedule.json': OTHER_CALENDAR_ITEMS}
    old = {name: read_json(name) or {} for name in files}
    new = {name: {item: {k: v for k, v in (old[name].get(item) or {}).items()} for item in items} for name, items in files.items()}
    start, end = date.today() - timedelta(days=SCHEDULE_DAYS_BACK), date.today() + timedelta(days=SCHEDULE_DAYS_AHEAD)
    d = start
    while d <= end:
        k = d.isoformat()
        missing = any(k not in new[n][i] for n, items in files.items() for i in items)
        if missing or d >= date.today() - timedelta(days=1):      # refresh recent/future days too
            data = http_json(f"{API}/calendars?diaspora=0&year={d.year}&month={d.month}&day={d.day}")
            for name, items in files.items():
                for item in items:
                    it = next((i for i in data.get('calendar_items', []) if (i.get('title') or {}).get('en') == item), None)
                    if it and it.get('ref'):
                        new[name][item][k] = {'ref': it['ref'], 'he': (it.get('displayValue') or {}).get('he') or ''}
            time.sleep(0.2)
        d += timedelta(days=1)
    changed = False
    for name in files:
        for item in new[name]:
            new[name][item] = dict(sorted((k, v) for k, v in new[name][item].items() if k >= start.isoformat()))
        if new[name] != old[name]:
            write_json(name, new[name]); changed = True
    wrapper = "---\nlayout: null\npermalink: /data-schedule.json\n---\n{% include src-schedule.json %}"
    wp = os.path.join(ROOT, 'data-schedule.json')
    if not os.path.exists(wp) or open(wp, encoding='utf-8').read() != wrapper:
        with open(wp, 'w', encoding='utf-8') as f: f.write(wrapper)
        changed = True
    return changed

# ---------------------------------------------------------------- main
def main():
    os.chdir(ROOT)
    schedule_only = '--schedule-only' in sys.argv
    if schedule_only:
        print('schedule changed' if update_schedule() else 'schedule unchanged')
        return
    update_tehillim()
    update_birkat()
    manifest = read_json('halacha-manifest.json') or {}
    before = json.dumps(manifest, sort_keys=True, ensure_ascii=False)
    update_halacha(manifest)
    if json.dumps(manifest, sort_keys=True, ensure_ascii=False) != before:
        manifest['updated'] = TODAY
        write_json('halacha-manifest.json', manifest)
    # Arukh HaShulchan, Mishnah, Rambam, Tanakh … (update_library.py)
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from update_library import Library
    Library(sys.modules[__name__]).run()
    out = os.environ.get('REPORT_FILE', 'update-report.md')
    with open(out, 'w', encoding='utf-8') as f:
        if problems: f.write('### ⚠️ דורש בדיקה\n' + '\n'.join('- ' + p for p in problems) + '\n\n')
        f.write('### מה השתנה\n' + ('\n'.join(report) if report else 'לא נמצאו שינויים בטקסטים.') + '\n')
    print(open(out, encoding='utf-8').read())

if __name__ == '__main__':
    main()
