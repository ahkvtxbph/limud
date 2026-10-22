#!/usr/bin/env python3
"""
More texts kept on the site (besides Tehillim, Birkat HaMazon and the Shulchan Arukh, which are
handled in update_sources.py). Called from update_sources.py — not meant to be run on its own.

Only editions whose license also allows a site WITH advertisements are used: public domain,
CC0, CC-BY, CC-BY-SA. If Sefaria's default edition of a text has another license (for example
CC-BY-NC), the best allowed edition is taken instead, and the site asks Sefaria for that same
edition whenever it has to fall back to it.

Files (all created and kept up to date by the automation — nothing here is uploaded by hand):
  _includes/src-manifest.json   + data-manifest.json      which book is in which file, versions
  _includes/src-<name>.json     + data-<name>.json        the texts, ~1 MB per file
The data-*.json files in the main folder are tiny Jekyll wrappers that publish the _includes file.
"""
import hashlib, json, os, re

ALLOWED_NOTE = 'נחלת הכלל / CC0 / CC-BY / CC-BY-SA'
TARGET_BYTES = 1_100_000          # size of one published data file (before compression)

MISHNAH_TRACTATES = ["Berakhot", "Peah", "Demai", "Kilayim", "Sheviit", "Terumot", "Maasrot", "Maaser Sheni", "Challah", "Orlah", "Bikkurim", "Shabbat", "Eruvin", "Pesachim", "Shekalim", "Yoma", "Sukkah", "Beitzah", "Rosh Hashanah", "Taanit", "Megillah", "Moed Katan", "Chagigah", "Yevamot", "Ketubot", "Nedarim", "Nazir", "Sotah", "Gittin", "Kiddushin", "Bava Kamma", "Bava Metzia", "Bava Batra", "Sanhedrin", "Makkot", "Shevuot", "Eduyot", "Avodah Zarah", "Avot", "Horayot", "Zevachim", "Menachot", "Chullin", "Bekhorot", "Arakhin", "Temurah", "Keritot", "Meilah", "Tamid", "Middot", "Kinnim", "Kelim", "Oholot", "Negaim", "Parah", "Tahorot", "Mikvaot", "Niddah", "Makhshirin", "Zavim", "Tevul Yom", "Yadayim", "Oktzin"]
TANAKH_BOOKS = ["Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua", "Judges", "I Samuel", "II Samuel", "I Kings", "II Kings", "Isaiah", "Jeremiah", "Ezekiel", "Hosea", "Joel", "Amos", "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk", "Zephaniah", "Haggai", "Zechariah", "Malachi", "Psalms", "Proverbs", "Job", "Song of Songs", "Ruth", "Lamentations", "Ecclesiastes", "Esther", "Daniel", "Ezra", "Nehemiah", "I Chronicles", "II Chronicles"]
RAMBAM_BOOKS = [
    ("Introduction", "Mishneh Torah, Negative Mitzvot"),
    ("Introduction", "Mishneh Torah, Overview of Mishneh Torah Contents"),
    ("Introduction", "Mishneh Torah, Positive Mitzvot"),
    ("Introduction", "Mishneh Torah, Transmission of the Oral Law"),
    ("Sefer Madda", "Mishneh Torah, Foreign Worship and Customs of the Nations"),
    ("Sefer Madda", "Mishneh Torah, Foundations of the Torah"),
    ("Sefer Madda", "Mishneh Torah, Human Dispositions"),
    ("Sefer Madda", "Mishneh Torah, Repentance"),
    ("Sefer Madda", "Mishneh Torah, Torah Study"),
    ("Sefer Ahavah", "Mishneh Torah, Blessings"),
    ("Sefer Ahavah", "Mishneh Torah, Circumcision"),
    ("Sefer Ahavah", "Mishneh Torah, Fringes"),
    ("Sefer Ahavah", "Mishneh Torah, Prayer and the Priestly Blessing"),
    ("Sefer Ahavah", "Mishneh Torah, Reading the Shema"),
    ("Sefer Ahavah", "Mishneh Torah, Tefillin, Mezuzah and the Torah Scroll"),
    ("Sefer Ahavah", "Mishneh Torah, The Order of Prayer"),
    ("Sefer Zemanim", "Mishneh Torah, Eruvin"),
    ("Sefer Zemanim", "Mishneh Torah, Fasts"),
    ("Sefer Zemanim", "Mishneh Torah, Leavened and Unleavened Bread"),
    ("Sefer Zemanim", "Mishneh Torah, Rest on a Holiday"),
    ("Sefer Zemanim", "Mishneh Torah, Rest on the Tenth of Tishrei"),
    ("Sefer Zemanim", "Mishneh Torah, Sabbath"),
    ("Sefer Zemanim", "Mishneh Torah, Sanctification of the New Month"),
    ("Sefer Zemanim", "Mishneh Torah, Scroll of Esther and Hanukkah"),
    ("Sefer Zemanim", "Mishneh Torah, Sheqel Dues"),
    ("Sefer Zemanim", "Mishneh Torah, Shofar, Sukkah and Lulav"),
    ("Sefer Nashim", "Mishneh Torah, Divorce"),
    ("Sefer Nashim", "Mishneh Torah, Levirate Marriage and Release"),
    ("Sefer Nashim", "Mishneh Torah, Marriage"),
    ("Sefer Nashim", "Mishneh Torah, Virgin Maiden"),
    ("Sefer Nashim", "Mishneh Torah, Woman Suspected of Infidelity"),
    ("Sefer Kedushah", "Mishneh Torah, Forbidden Foods"),
    ("Sefer Kedushah", "Mishneh Torah, Forbidden Intercourse"),
    ("Sefer Kedushah", "Mishneh Torah, Ritual Slaughter"),
    ("Sefer Haflaah", "Mishneh Torah, Appraisals and Devoted Property"),
    ("Sefer Haflaah", "Mishneh Torah, Nazariteship"),
    ("Sefer Haflaah", "Mishneh Torah, Oaths"),
    ("Sefer Haflaah", "Mishneh Torah, Vows"),
    ("Sefer Zeraim", "Mishneh Torah, Diverse Species"),
    ("Sefer Zeraim", "Mishneh Torah, First Fruits and other Gifts to Priests Outside the Sanctuary"),
    ("Sefer Zeraim", "Mishneh Torah, Gifts to the Poor"),
    ("Sefer Zeraim", "Mishneh Torah, Heave Offerings"),
    ("Sefer Zeraim", "Mishneh Torah, Sabbatical Year and the Jubilee"),
    ("Sefer Zeraim", "Mishneh Torah, Second Tithes and Fourth Year's Fruit"),
    ("Sefer Zeraim", "Mishneh Torah, Tithes"),
    ("Sefer Avodah", "Mishneh Torah, Admission into the Sanctuary"),
    ("Sefer Avodah", "Mishneh Torah, Daily Offerings and Additional Offerings"),
    ("Sefer Avodah", "Mishneh Torah, Sacrifices Rendered Unfit"),
    ("Sefer Avodah", "Mishneh Torah, Sacrificial Procedure"),
    ("Sefer Avodah", "Mishneh Torah, Service on the Day of Atonement"),
    ("Sefer Avodah", "Mishneh Torah, The Chosen Temple"),
    ("Sefer Avodah", "Mishneh Torah, Things Forbidden on the Altar"),
    ("Sefer Avodah", "Mishneh Torah, Trespass"),
    ("Sefer Avodah", "Mishneh Torah, Vessels of the Sanctuary and Those who Serve Therein"),
    ("Sefer Korbanot", "Mishneh Torah, Festival Offering"),
    ("Sefer Korbanot", "Mishneh Torah, Firstlings"),
    ("Sefer Korbanot", "Mishneh Torah, Offerings for Those with Incomplete Atonement"),
    ("Sefer Korbanot", "Mishneh Torah, Offerings for Unintentional Transgressions"),
    ("Sefer Korbanot", "Mishneh Torah, Paschal Offering"),
    ("Sefer Korbanot", "Mishneh Torah, Substitution"),
    ("Sefer Taharah", "Mishneh Torah, Defilement by Leprosy"),
    ("Sefer Taharah", "Mishneh Torah, Defilement by a Corpse"),
    ("Sefer Taharah", "Mishneh Torah, Defilement of Foods"),
    ("Sefer Taharah", "Mishneh Torah, Immersion Pools"),
    ("Sefer Taharah", "Mishneh Torah, Other Sources of Defilement"),
    ("Sefer Taharah", "Mishneh Torah, Red Heifer"),
    ("Sefer Taharah", "Mishneh Torah, Those Who Defile Bed or Seat"),
    ("Sefer Taharah", "Mishneh Torah, Vessels"),
    ("Sefer Nezikim", "Mishneh Torah, Damages to Property"),
    ("Sefer Nezikim", "Mishneh Torah, Murderer and the Preservation of Life"),
    ("Sefer Nezikim", "Mishneh Torah, One Who Injures a Person or Property"),
    ("Sefer Nezikim", "Mishneh Torah, Robbery and Lost Property"),
    ("Sefer Nezikim", "Mishneh Torah, Theft"),
    ("Sefer Kinyan", "Mishneh Torah, Agents and Partners"),
    ("Sefer Kinyan", "Mishneh Torah, Neighbors"),
    ("Sefer Kinyan", "Mishneh Torah, Ownerless Property and Gifts"),
    ("Sefer Kinyan", "Mishneh Torah, Sales"),
    ("Sefer Kinyan", "Mishneh Torah, Slaves"),
    ("Sefer Mishpatim", "Mishneh Torah, Borrowing and Deposit"),
    ("Sefer Mishpatim", "Mishneh Torah, Creditor and Debtor"),
    ("Sefer Mishpatim", "Mishneh Torah, Hiring"),
    ("Sefer Mishpatim", "Mishneh Torah, Inheritances"),
    ("Sefer Mishpatim", "Mishneh Torah, Plaintiff and Defendant"),
    ("Sefer Shoftim", "Mishneh Torah, Kings and Wars"),
    ("Sefer Shoftim", "Mishneh Torah, Mourning"),
    ("Sefer Shoftim", "Mishneh Torah, Rebels"),
    ("Sefer Shoftim", "Mishneh Torah, Testimony"),
    ("Sefer Shoftim", "Mishneh Torah, The Sanhedrin and the Penalties within their Jurisdiction"),
]
ARUKH_PARTS = ["Arukh HaShulchan, Orach Chaim", "Arukh HaShulchan, Yoreh De'ah", "Arukh HaShulchan, Even HaEzer", "Arukh HaShulchan, Choshen Mishpat"]

# group (file name prefix), Hebrew label, list of (title, preferred editions or None)
def library():
    torah = TANAKH_BOOKS[:5]
    return [
        ('arukh',     'ערוך השולחן',     [(t, None) for t in ARUKH_PARTS]),
        ('mishnah',   'משנה',            [('Mishnah ' + t, None) for t in MISHNAH_TRACTATES]),
        ('bartenura', 'ברטנורא',          [('Bartenura on Mishnah ' + t, ['On Your Way']) for t in MISHNAH_TRACTATES]),
        ('rambam',    'רמב"ם',            [(t, None) for _, t in RAMBAM_BOOKS]),
        ('tanakh',    'תנ"ך',             [(t, None) for t in TANAKH_BOOKS]),
        ('rashi',     'רש"י על התנ"ך',    [('Rashi on ' + t, None if t in torah else ['On Your Way', 'On Your Way -- new']) for t in TANAKH_BOOKS]),
        ('onkelos',   'אונקלוס',          [('Onkelos ' + t, ['Targum Onkelos, vocalized according to the Yemenite Taj']) for t in torah]),
    ]
TOPIC_INDEXES = ['Arukh HaShulchan']
CHUNK = 20                         # sections per API request

def license_ok(lic):
    l = (lic or '').strip().upper().replace(' ', '-')
    if l in ('PUBLIC-DOMAIN', 'PD', 'CC0'): return True
    return l.startswith('CC-BY') and 'NC' not in l and 'ND' not in l

def has_text(x):
    return any(has_text(y) for y in x) if isinstance(x, list) else bool(x and str(x).strip())

def is_hebrew(v):
    return v.get('language') == 'he' or v.get('actualLanguage') == 'he' or v.get('languageFamilyName') == 'hebrew'

class Library:
    def __init__(self, u):
        self.u = u            # the update_sources module (http, cleaning, report helpers)

    # ---------------------------------------------------------------- Sefaria
    def fetch(self, ref, version=None):
        q = 'hebrew|' + self.u.urllib.parse.quote(version) if version else 'hebrew'
        url = f"{self.u.API}/v3/texts/{self.u.urllib.parse.quote(ref)}?version={q}&return_format=text_only"
        d = self.u.http_json(url)
        self.u.time.sleep(0.3)
        return d

    def pick(self, title, prefer, probe=1):
        """Which edition to use for a book: (versionTitle or None for Sefaria's default, its license).
        probe: a section that has text (asking for an empty one can answer 404)."""
        d = self.fetch(f'{title} {probe}')
        v0 = (d.get('versions') or [{}])[0]
        avail = [v for v in (d.get('available_versions') or []) if is_hebrew(v)]
        if prefer:
            want = [p.strip() for p in prefer]
            for p in want:
                for v in avail:
                    if (v.get('versionTitle') or '').strip() == p and license_ok(v.get('license')):
                        return v.get('versionTitle'), v.get('license'), v.get('versionSource') or ''
        if license_ok(v0.get('license')):
            return None, v0.get('license'), v0.get('versionSource') or ''
        ok = sorted([v for v in avail if license_ok(v.get('license'))], key=lambda v: -(v.get('priority') or 0))
        if ok: return ok[0].get('versionTitle'), ok[0].get('license'), ok[0].get('versionSource') or ''
        return False, v0.get('license'), ''

    def book(self, title, prefer):
        """The whole book: list of sections (each a list of segments, or of lists for commentaries)."""
        u = self.u
        counts = []
        try:
            d = u.http_json(f"{u.API}/shape/{u.urllib.parse.quote(title)}")
            node = next((x for x in d if isinstance(x, dict) and x.get('title') == title), d[0]) if isinstance(d, list) else d
            counts = [c if isinstance(c, int) else (len(c) if isinstance(c, list) else 0) for c in (node.get('chapters') or [])]
        except Exception:
            pass
        n = len(counts)
        probe = next((k + 1 for k, c in enumerate(counts) if c), 1)
        version, lic, source = self.pick(title, prefer, probe)
        if not n:      # no shape (e.g. an alternative spelling of the title): ask for the whole book once
            whole = (self.fetch(title, version or None).get('versions') or [{}])[0].get('text') or []
            n = len(whole) if isinstance(whole, list) else 0
            if not n: raise RuntimeError('no text structure for ' + title)
        if version is False: raise RuntimeError(f'no edition with an allowed license ({lic})')
        sections, used = [], set()
        for a in range(1, n + 1, CHUNK):
            b = min(n, a + CHUNK - 1)
            ref = f'{title} {a}-{b}' if b > a else f'{title} {a}'
            if counts and not any(counts[a - 1:b]):          # nothing in Sefaria for these sections
                sections.extend([[] for _ in range(a, b + 1)]); continue
            try:
                r = self.fetch(ref, version)
            except Exception:                                 # e.g. 404 for a range with gaps: one by one
                for k in range(a, b + 1):
                    try: sections.append((self.fetch(f'{title} {k}', version).get('versions') or [{}])[0].get('text') or [])
                    except Exception: sections.append([])
                continue
            v = (r.get('versions') or [{}])[0]
            if not license_ok(v.get('license')):
                # Sefaria's default for this part has another license: take the best allowed edition that has it
                alts = sorted([x for x in (r.get('available_versions') or []) if is_hebrew(x) and license_ok(x.get('license'))],
                              key=lambda x: -(x.get('priority') or 0))
                for alt in alts:
                    r2 = self.fetch(ref, alt.get('versionTitle'))
                    v2 = (r2.get('versions') or [{}])[0]
                    if license_ok(v2.get('license')) and has_text(v2.get('text')):
                        v = v2; break
                else:
                    raise RuntimeError(f"{ref}: edition \"{v.get('versionTitle')}\" has license {v.get('license')}, and no allowed edition has this part")
            used.add((v.get('versionTitle') or '').strip())
            chunk = v.get('text') or []
            if b == a: chunk = [chunk]
            if len(chunk) != b - a + 1:
                chunk = []
                for k in range(a, b + 1):
                    try: chunk.append((self.fetch(f'{title} {k}', version).get('versions') or [{}])[0].get('text') or [])
                    except Exception: chunk.append([])
            sections.extend(chunk)
        def cl(x):
            if isinstance(x, list): return [cl(y) for y in x]
            return u.clean(x) if isinstance(x, str) else ''
        sections = [cl(s) if isinstance(s, list) else [cl(s)] for s in sections]
        if not has_text(sections): raise RuntimeError('no text at all for ' + title)
        return {'versionTitle': version or (' / '.join(sorted(used))), 'license': lic, 'versionSource': source,
                'pin': version or None, 'text': sections}

    # ---------------------------------------------------------------- files
    def read(self, name):
        p = os.path.join(self.u.INC, name)
        if not os.path.exists(p): return None
        with open(p, encoding='utf-8') as f: return json.load(f)

    def old_book(self, manifest, title):
        e = (manifest.get('books') or {}).get(title)
        if not e: return None
        text = []
        for part in e.get('parts', []):
            d = self.read('src-' + part['file'][len('data-'):]) if part['file'].startswith('data-') else None
            b = d and d.get('books', {}).get(title)
            if not b: return None
            text.extend(b['text'])
        return {**e, 'text': text}

    def run(self):
        u = self.u
        manifest = self.read('src-manifest.json') or {}
        old_files = {f for f in os.listdir(u.INC) if f.startswith('src-') and f not in ('src-manifest.json', 'src-schedule.json')}
        books, files, topics = {}, {}, {}
        added, added_count = {}, {}         # books that are new on the site, summed up per group
        for group, label, entries in library():
            bundle, bundle_size, part_no = [], 0, 0
            def flush():
                nonlocal bundle, bundle_size, part_no
                if not bundle: return
                part_no += 1
                name = f'{group}-{part_no}.json'
                files[name] = {'books': {t: dict(v) for t, v in bundle}}
                for t, v in bundle:
                    books.setdefault(t, {'parts': []})['parts'].append({'file': 'data-' + name, 'from': v['from'], 'to': v['to']})
                bundle, bundle_size = [], 0
            for title, prefer in entries:
                try:
                    b = self.book(title, prefer)
                except Exception as e:
                    old = self.old_book(manifest, title)
                    u.problems.append(f'**{label} — {title}**: לא ניתן היה להוריד ({e}) — ' + ('נשאר הטקסט הקודם.' if old else 'הספר ממשיך להיטען מספריא.'))
                    if not old: continue
                    b = old
                prev = self.old_book(manifest, title)
                if prev and prev.get('text') != b['text']:
                    n, x, y = u.count_changes(prev['text'], b['text'])
                    line = f'- **{label} — {title}**: {n} קטעים השתנו'
                    dd = u.first_diff(prev['text'], b['text'])
                    if dd:
                        bef, aft = u.around_change(dd[1], dd[2])
                        line += f'\n  - לדוגמה, {dd[0]}:\n    - לפני: {bef}\n    - אחרי: {aft}'
                    u.report.append(line)
                elif not prev:
                    added.setdefault(label, set()).add(f'{b["versionTitle"]} — {b["license"]}')
                    added_count[label] = added_count.get(label, 0) + 1
                books[title] = {'versionTitle': b['versionTitle'], 'license': b['license'], 'pin': b.get('pin'),
                                'counts': [len(s) if isinstance(s, list) else 1 for s in b['text']], 'parts': []}
                meta = {'versionTitle': b['versionTitle'], 'license': b['license'], 'versionSource': b.get('versionSource') or ''}
                # split one book into pieces of ~TARGET_BYTES, or put several small books together
                secs = b['text']
                start = 0
                while start < len(secs):
                    size, end = 0, start
                    while end < len(secs) and (end == start or size + len(u.dumps(secs[end]).encode('utf-8')) < TARGET_BYTES):
                        size += len(u.dumps(secs[end]).encode('utf-8')); end += 1
                    if bundle and bundle_size + size > TARGET_BYTES: flush()
                    bundle.append((title, {**meta, 'from': start + 1, 'to': end, 'text': secs[start:end]}))
                    bundle_size += size
                    if bundle_size >= TARGET_BYTES: flush()
                    start = end
            flush()
        for label, eds in added.items():
            u.report.append(f'- **{label}**: נוספו לאתר {added_count[label]} ספרים (מהדורות: ' + '; '.join(sorted(eds)) + ')')
        for idx in TOPIC_INDEXES:
            try:
                d = u.http_json(f"{u.API}/v2/raw/index/{u.urllib.parse.quote(idx)}")
                topics[idx] = u.flatten_topics(((d.get('alt_structs') or {}).get('Topic') or {}).get('nodes') or [])
            except Exception as e:
                topics[idx] = (manifest.get('topics') or {}).get(idx) or []
                u.problems.append(f'**נושאים ({idx})**: לא ניתן היה להוריד ({e}).')
        # write the data files (only those that changed) and their wrappers
        for name, content in files.items():
            s = u.dumps(content)
            for t in content['books']:
                for p in books[t]['parts']:
                    if p['file'] == 'data-' + name: p['v'] = hashlib.sha1(s.encode('utf-8')).hexdigest()[:12]
            self.write_if_changed('src-' + name, s)
            self.wrapper('data-' + name, 'src-' + name)
        for f in old_files - {'src-' + n for n in files}:      # a file no longer needed
            os.remove(os.path.join(u.INC, f))
            w = os.path.join(u.ROOT, 'data-' + f[len('src-'):])
            if os.path.exists(w): os.remove(w)
        new_manifest = {'note': 'נוצר אוטומטית — לא לערוך ידנית. רישיונות: ' + ALLOWED_NOTE, 'books': books, 'topics': topics}
        if {k: v for k, v in manifest.items() if k != 'updated'} != new_manifest:
            new_manifest['updated'] = u.TODAY
            self.write_if_changed('src-manifest.json', u.dumps(new_manifest))
        self.wrapper('data-manifest.json', 'src-manifest.json')

    def write_if_changed(self, name, s):
        p = os.path.join(self.u.INC, name)
        if os.path.exists(p):
            with open(p, encoding='utf-8') as f:
                if f.read() == s: return
        with open(p, 'w', encoding='utf-8') as f: f.write(s)

    def wrapper(self, published, include):
        s = f"---\nlayout: null\npermalink: /{published}\n---\n{{% include {include} %}}"
        p = os.path.join(self.u.ROOT, published)
        if os.path.exists(p):
            with open(p, encoding='utf-8') as f:
                if f.read() == s: return
        with open(p, 'w', encoding='utf-8') as f: f.write(s)
