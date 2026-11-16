#!/usr/bin/env python3
"""
Hebcal's location-dependent answers, kept on the site for the cities of the TV board (tv/common.js),
180 days ahead (Hebcal's own limit for one request) — refreshed weekly and committed directly.

  _includes/src-zmanim.json        index: {start, end, cities: [{name, lat, lon, n}]}
  _includes/src-zmanim-<n>.json    one city: {sun: {date: [sunrise, sunset]},      (Hebcal /zmanim, to the second)
                                              sets: {signature: {start, end, items}}} (Hebcal /hebcal, as the site asks)
  data-zmanim*.json                published copies (Jekyll wrappers)

The site answers the same requests from these files (shared.js — hebcalLocalAnswer / hebcalSunTimes)
when the place is one of these cities (or within a few km of one); otherwise it asks Hebcal as before.
Only sunrise and sunset are taken from /zmanim: every other time of day is derived from them by the
site's own rules (Yeshiva.org.il), which differ from Hebcal's for dawn, misheyakir, MGA and nightfall.
"""
import os, re, time
from datetime import date, timedelta

DAYS_BACK, DAYS = 4, 180          # Hebcal answers at most 180 days per request
TZID = 'Asia/Jerusalem'
JERUSALEM_MINUTES = 40            # shared.js: JERUSALEM_CANDLE_MINUTES / isJerusalemArea

def cities(root):
    """The places of tv/common.js: {name, lat, lon}."""
    s = open(os.path.join(root, 'tv', 'common.js'), encoding='utf-8').read()
    out = []
    for m in re.finditer(r"\{\s*name:\s*'([^']+)',\s*lat:\s*([\d.]+),\s*lon:\s*([\d.]+)\s*\}", s):
        out.append({'name': m.group(1), 'lat': float(m.group(2)), 'lon': float(m.group(3))})
    return out

def is_jerusalem(c):
    return 'ירושלים' in c['name'] or (31.73 <= c['lat'] <= 31.86 and 35.16 <= c['lon'] <= 35.25)

def signatures(c):
    """The location-dependent requests the site makes, without cfg/v/start/end/latitude/longitude/tzid
    (keys in alphabetical order, as shared.js builds them for the lookup)."""
    b = [('b', str(JERUSALEM_MINUTES))] if is_jerusalem(c) else []
    sets = [
        sorted([('c', 'on'), ('i', 'on'), ('maj', 'on')] + b),       # Shabbat / Yom Tov times: zmanim page, TV, Shabbat closing
        sorted([('c', 'on'), ('maj', 'on'), ('mf', 'on')]),         # the zmanim page: is today a fast?
    ]
    return ['&'.join(k + '=' + v for k, v in s) for s in sets]

def update(U):
    """-> True when a file changed."""
    start = date.today() - timedelta(days=DAYS_BACK)
    end = start + timedelta(days=DAYS)
    places = cities(U.ROOT)
    if not places: raise RuntimeError('no cities in tv/common.js')
    index, changed, failed = [], False, []
    for n, c in enumerate(places):
        loc = f"latitude={c['lat']}&longitude={c['lon']}&tzid={TZID}"
        try:
            z = U.http_json(f"{U.HEBCAL}/zmanim?cfg=json&sec=1&{loc}&start={start}&end={end}")
            t = z.get('times') or {}
            sr, ss = t.get('sunrise') or {}, t.get('sunset') or {}
            sun = {d: [sr[d], ss.get(d)] for d in sorted(sr) if ss.get(d)}
            if len(sun) < DAYS // 2: raise RuntimeError(f'Hebcal gave only {len(sun)} days of sunrise')
            time.sleep(0.4)
            sets = {}
            for sig in signatures(c):
                d = U.http_json(f"{U.HEBCAL}/hebcal?cfg=json&v=1&{sig}&{loc}&start={start}&end={end}")
                items = d.get('items') or []                               # exactly Hebcal's answer
                if not any(i.get('category') == 'candles' for i in items): raise RuntimeError('no candle-lighting times for ' + sig)
                sets[sig] = {'start': start.isoformat(), 'end': end.isoformat(), 'items': items}
                time.sleep(0.4)
        except Exception as e:
            failed.append(f"{c['name']} ({e})")
            old = U.read_json(f'src-zmanim-{n}.json')
            if not old or old.get('name') != c['name']: continue   # nothing kept for this city yet
            sun, sets = old.get('sun') or {}, old.get('sets') or {}  # keep last week's copy
        changed |= U.write_if_changed(f'src-zmanim-{n}.json', {'name': c['name'], 'lat': c['lat'], 'lon': c['lon'], 'tzid': TZID, 'sun': sun, 'sets': sets})
        changed |= U.wrapper(f'data-zmanim-{n}.json', f'src-zmanim-{n}.json')
        index.append({'name': c['name'], 'lat': c['lat'], 'lon': c['lon'], 'n': n})
    if not index: raise RuntimeError('Hebcal: ' + '; '.join(failed[:3]))
    changed |= U.write_if_changed('src-zmanim.json', {
        'note': 'נוצר אוטומטית מ־Hebcal.com (CC BY 4.0) — לא לערוך ידנית', 'source': 'https://www.hebcal.com',
        'start': start.isoformat(), 'end': end.isoformat(), 'tzid': TZID, 'cities': index})
    changed |= U.wrapper('data-zmanim.json', 'src-zmanim.json')
    if failed: print('Hebcal zmanim — kept the previous copy for:', '; '.join(failed))
    return changed
