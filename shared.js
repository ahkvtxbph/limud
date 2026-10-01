/* shared.js — utilities reused across pages: Hebrew date/gematria, sunrise/sunset
   astronomy, location detection, Sefaria/Hebcal helpers, share buttons, date-picker
   wiring, and the Shabbat/Yom-Tov site-wide gating banner. */
function hebNum(n){
  if(n<=0) return String(n);
  let rem = n % 100;
  let hundredsValue = Math.floor(n/100)*100;
  let out = "";
  while(hundredsValue >= 400){ out += "ת"; hundredsValue -= 400; }
  if(hundredsValue === 300) out += "ש";
  else if(hundredsValue === 200) out += "ר";
  else if(hundredsValue === 100) out += "ק";
  if(rem===15) out += "טו";
  else if(rem===16) out += "טז";
  else {
    const tens = ["","י","כ","ל","מ","נ","ס","ע","פ","צ"];
    const ones = ["","א","ב","ג","ד","ה","ו","ז","ח","ט"];
    let t = Math.floor(rem/10), o = rem%10;
    out += tens[t] + ones[o];
  }
  if(out.length>1){
    out = out.slice(0,-1) + "״" + out.slice(-1);
  } else if(out.length===1){
    out = out + "׳";
  }
  return out;
}

function hebraizeYearInText(text){
  if(!text) return text;
  return text.replace(/\b(5[7-9]\d{2})\b/g, (match)=> hebNum(parseInt(match, 10) % 1000));
}

const WEEKDAY_NAMES = ["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"];

function getHebrewParts(date){
  const fmt = new Intl.DateTimeFormat('en-u-ca-hebrew', {day:'numeric', month:'long', year:'numeric'});
  const parts = fmt.formatToParts(date);
  const map = {};
  parts.forEach(p=> map[p.type]=p.value);
  return map;
}

function getHebrewDisplay(date, tzid){
  const opts = {day:'numeric', month:'long', year:'numeric'};
  if(tzid) opts.timeZone = tzid;
  const fmt = new Intl.DateTimeFormat('he-u-ca-hebrew', opts);
  const parts = fmt.formatToParts(date);
  let day, month, year;
  parts.forEach(p=>{
    if(p.type === 'day') day = parseInt(p.value, 10);
    if(p.type === 'month') month = p.value;
    if(p.type === 'year') year = parseInt(p.value, 10);
  });
  if(!day || !month || !year) return fmt.format(date);
  const dayLetters = hebNum(day);
  const yearLetters = hebNum(year % 1000);
  return `${dayLetters} ב${month} ${yearLetters}`;
}

function calcSunsetUTC(date, lat, lng){
  const rad = Math.PI/180;
  // Use the observer's LOCAL calendar date (not UTC) to pick which day's sunset to compute —
  // using UTC here would, for positive UTC offsets like Israel's, treat the first few hours
  // after local midnight as still "yesterday" and wrongly compute an already-past sunset.
  const start = Date.UTC(date.getFullYear(),0,1);
  const dayOfYear = Math.floor((Date.UTC(date.getFullYear(),date.getMonth(),date.getDate()) - start)/86400000) + 1;
  const zenith = 90.833;
  const lngHour = lng/15;
  const t = dayOfYear + ((18 - lngHour)/24);
  const M = (0.9856*t) - 3.289;
  let L = M + (1.916*Math.sin(rad*M)) + (0.020*Math.sin(2*rad*M)) + 282.634;
  L = (L+360)%360;
  let RA = (1/rad) * Math.atan(0.91764 * Math.tan(rad*L));
  RA = (RA+360)%360;
  const Lq = Math.floor(L/90)*90;
  const RAq = Math.floor(RA/90)*90;
  RA = (RA + (Lq-RAq))/15;
  const sinDec = 0.39782*Math.sin(rad*L);
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosH = (Math.cos(rad*zenith) - (sinDec*Math.sin(rad*lat))) / (cosDec*Math.cos(rad*lat));
  if(cosH > 1 || cosH < -1) return null;
  let H = (1/rad) * Math.acos(cosH);
  H = H/15;
  const T = H + RA - (0.06571*t) - 6.622;
  const UT = (T - lngHour + 24) % 24;
  // Anchor to the SAME local calendar date used above for dayOfYear — mixing local (for
  // dayOfYear) with UTC (here) would silently shift the result by up to the UTC offset.
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) + UT*3600000);
}

function getPositionOnce(timeoutMs){
  return new Promise((resolve, reject)=>{
    if(!('geolocation' in navigator)){ reject(new Error('no geolocation')); return; }
    const timer = setTimeout(()=> reject(new Error('timeout')), timeoutMs);
    navigator.geolocation.getCurrentPosition(
      pos => { clearTimeout(timer); resolve(pos); },
      err => { clearTimeout(timer); reject(err); },
      { enableHighAccuracy:false, timeout: timeoutMs, maximumAge: 21600000 }
    );
  });
}

async function updateHebrewDateDisplay(){
  const now = new Date();
  let effectiveDate = now;
  let mode = 'midnight';
  let isPastSunset = false;
  try{
    const pos = await getPositionOnce(4000);
    const sunset = calcSunsetUTC(now, pos.coords.latitude, pos.coords.longitude);
    if(sunset){
      mode = 'sunset';
      isPastSunset = now.getTime() >= sunset.getTime();
      effectiveDate = isPastSunset ? new Date(now.getTime() + 86400000) : now;
    }
  }catch(e){
    // no permission / unsupported / timeout — fall back to midnight-based date
  }
  // Once we're past sunset but before midnight, the Hebrew day has already turned over
  // even though it's not yet the next Gregorian day — traditionally phrased as "אור ל..."
  // (the night leading into that day), rather than stating the day outright.
  const weekdayName = WEEKDAY_NAMES[effectiveDate.getDay()];
  document.getElementById('today-weekday').textContent = isPastSunset
    ? `אור ליום ${weekdayName}`
    : `יום ${weekdayName}`;
  const gregLabel = now.toLocaleDateString('he-IL');
  try{
    const hebLabel = getHebrewDisplay(effectiveDate);
    document.getElementById('today-hebrew').textContent = isPastSunset
      ? `אור ל-${hebLabel} (${gregLabel})`
      : `${hebLabel} (${gregLabel})`;
  }catch(e){
    document.getElementById('today-hebrew').textContent = `לא זמין בדפדפן זה (${gregLabel})`;
  }
  const note = document.getElementById('hebrew-date-note');
  if(note){
    note.textContent = mode === 'sunset'
      ? 'התאריך מתעדכן לפי זמן שקיעה משוער לפי מיקומך (זמן משוער בלבד, לא מדויק לדקה).'
      : 'לא זוהה מיקום — התאריך מתעדכן בחצות הלילה (00:00) לפי שעון המכשיר, ולא לפי השקיעה.';
  }
}

function stripTags(s){
  return String(s).replace(/<[^>]+>/g,'');
}

const SHARE_ICONS = {
  whatsapp: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M17.5 14.4c-.3-.1-1.6-.8-1.9-.9-.2-.1-.4-.1-.6.1-.2.3-.7.9-.8 1-.2.2-.3.2-.5.1-.3-.1-1.2-.4-2.2-1.4-.8-.7-1.4-1.6-1.5-1.9-.2-.3 0-.4.1-.6l.4-.5c.1-.2.2-.3.2-.5.1-.2 0-.4 0-.5-.1-.1-.6-1.5-.8-2-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3-.3.3-1 1-1 2.4s1 2.8 1.2 3c.1.2 2 3.1 4.9 4.3.7.3 1.2.5 1.6.6.7.2 1.3.2 1.8.1.5-.1 1.6-.7 1.9-1.3.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.6-.3z"/><path d="M12 2C6.5 2 2 6.5 2 12c0 1.9.5 3.6 1.4 5.1L2 22l5-1.3c1.4.8 3.1 1.2 4.9 1.2 5.5 0 10-4.5 10-10S17.5 2 12 2zm0 18.3c-1.6 0-3.1-.4-4.4-1.2l-.3-.2-3 .8.8-2.9-.2-.3C4.1 15 3.6 13.5 3.6 12c0-4.6 3.8-8.4 8.4-8.4s8.4 3.8 8.4 8.4-3.8 8.3-8.4 8.3z"/></svg>',
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z"/></svg>'
};

function buildShareBar(url, text){
  const wrap = document.createElement('div');
  wrap.className = 'share-row';

  const wa = document.createElement('a');
  wa.className = 'share-btn whatsapp';
  wa.href = `https://wa.me/?text=${encodeURIComponent(text + ' ' + url)}`;
  wa.target = '_blank'; wa.rel = 'noopener';
  wa.setAttribute('aria-label', 'שיתוף בוואטסאפ');
  wa.innerHTML = SHARE_ICONS.whatsapp;
  wrap.appendChild(wa);

  const copy = document.createElement('button');
  copy.className = 'share-btn copy';
  copy.type = 'button';
  copy.setAttribute('aria-label', 'העתקת קישור');
  copy.innerHTML = SHARE_ICONS.copy;
  copy.addEventListener('click', async ()=>{
    try{
      await navigator.clipboard.writeText(url);
      copy.classList.add('copied');
      copy.setAttribute('aria-label', 'הקישור הועתק');
      setTimeout(()=>{ copy.classList.remove('copied'); copy.setAttribute('aria-label','העתקת קישור'); }, 1800);
    }catch(e){
      prompt('העתק/י את הקישור:', url);
    }
  });
  wrap.appendChild(copy);

  return wrap;
}

async function fetchRefText(ref){
  const url = `https://www.sefaria.org/api/v3/texts/${encodeURIComponent(ref)}?version=hebrew&return_format=text_only`;
  const res = await fetch(url);
  if(!res.ok) throw new Error('fetch failed: ' + ref);
  const data = await res.json();
  let text = null, resolvedRef = ref;
  if(data && data.versions && data.versions.length){
    text = data.versions[0].text;
  }
  if(data && data.ref) resolvedRef = data.ref;
  return { text, ref: resolvedRef };
}

async function fetchCommentary(baseRef){
  try{
    const { text } = await fetchRefText('Bartenura on Mishnah ' + baseRef);
    if(!text) return null;
    const flat = Array.isArray(text) ? text.flat(Infinity) : [text];
    const clean = flat.map(stripTags).filter(Boolean).join(' ');
    return clean || null;
  }catch(e){
    return null;
  }
}

function parseTrailingLocation(ref){
  const m = ref.match(/(\d+):(\d+)(?:-(\d+))?\s*$/);
  if(!m) return null;
  return { perek: parseInt(m[1],10), fromMishnah: parseInt(m[2],10), toMishnah: m[3] ? parseInt(m[3],10) : parseInt(m[2],10) };
}

function dateInputValueFromDate(date){
  const y = date.getFullYear();
  const m = String(date.getMonth()+1).padStart(2,'0');
  const d = String(date.getDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
}

function wireDatePicker(inputId, todayBtnId, prevBtnId, nextBtnId, getDate, setDate, rerender){
  const input = document.getElementById(inputId);
  const todayBtn = document.getElementById(todayBtnId);
  if(!input || !todayBtn) return;
  input.value = todayDateInputValue();
  input.addEventListener('change', ()=>{
    if(input.value){
      setDate(parseZmanimDateInput(input.value));
      rerender();
    }
  });
  todayBtn.addEventListener('click', ()=>{
    setDate(null);
    input.value = todayDateInputValue();
    rerender();
  });
  function shiftDay(delta){
    const base = getDate() || new Date();
    const y = base.getFullYear(), m = base.getMonth(), d = base.getDate();
    // Anchor at noon UTC (matches parseZmanimDateInput's convention) so plain
    // integer day arithmetic can't be thrown off by DST transitions.
    const shifted = new Date(Date.UTC(y, m, d + delta, 12));
    setDate(shifted);
    input.value = dateInputValueFromDate(shifted);
    rerender();
  }
  const prevBtn = document.getElementById(prevBtnId);
  const nextBtn = document.getElementById(nextBtnId);
  if(prevBtn) prevBtn.addEventListener('click', ()=> shiftDay(-1));
  if(nextBtn) nextBtn.addEventListener('click', ()=> shiftDay(1));
}

function calcSunEventUTC(date, lat, lng, zenith, isSunrise){
  const rad = Math.PI/180;
  // Use the observer's LOCAL calendar date (not UTC) — see calcSunsetUTC for why.
  const start = Date.UTC(date.getFullYear(),0,1);
  const dayOfYear = Math.floor((Date.UTC(date.getFullYear(),date.getMonth(),date.getDate()) - start)/86400000) + 1;
  const lngHour = lng/15;
  const t = isSunrise ? dayOfYear + ((6 - lngHour)/24) : dayOfYear + ((18 - lngHour)/24);
  const M = (0.9856*t) - 3.289;
  let L = M + (1.916*Math.sin(rad*M)) + (0.020*Math.sin(2*rad*M)) + 282.634;
  L = (L+360)%360;
  let RA = (1/rad) * Math.atan(0.91764 * Math.tan(rad*L));
  RA = (RA+360)%360;
  const Lq = Math.floor(L/90)*90;
  const RAq = Math.floor(RA/90)*90;
  RA = (RA + (Lq-RAq))/15;
  const sinDec = 0.39782*Math.sin(rad*L);
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosH = (Math.cos(rad*zenith) - (sinDec*Math.sin(rad*lat))) / (cosDec*Math.cos(rad*lat));
  if(cosH > 1 || cosH < -1) return null; // sun doesn't reach this position today at this location
  let H = isSunrise ? 360 - (1/rad)*Math.acos(cosH) : (1/rad)*Math.acos(cosH);
  H = H/15;
  const T = H + RA - (0.06571*t) - 6.622;
  const UT = (T - lngHour + 24) % 24;
  // Anchor to the SAME local calendar date used above for dayOfYear — mixing local (for
  // dayOfYear) with UTC (here) would silently shift the result by up to the UTC offset.
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) + UT*3600000);
}

function fmtZmanTime(date, tzid){
  if(!date) return '—';
  const opts = {hour:'2-digit', minute:'2-digit'};
  if(tzid) opts.timeZone = tzid;
  return date.toLocaleTimeString('he-IL', opts);
}

async function fetchTimezoneForCoords(lat, lon){
  try{
    const res = await fetch(`https://timeapi.io/api/TimeZone/coordinate?latitude=${lat}&longitude=${lon}`);
    if(!res.ok) throw new Error('fetch failed');
    const data = await res.json();
    return (data && data.timeZone) || null;
  }catch(e){
    return null;
  }
}

function parseZmanimDateInput(value){
  // value format: "YYYY-MM-DD" from <input type="date">.
  // Anchor at noon UTC so it reads as the same calendar day both for the
  // UTC-based sun-position math and for local-timezone display formatting.
  const [y, m, d] = value.split('-').map(Number);
  return new Date(Date.UTC(y, m-1, d, 12));
}

function todayDateInputValue(){
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

function roundToMinute(date, direction){
  const minuteMs = 60000;
  const ms = date.getTime();
  if(direction === 'up') return new Date(Math.ceil(ms / minuteMs) * minuteMs);
  if(direction === 'down') return new Date(Math.floor(ms / minuteMs) * minuteMs);
  return new Date(Math.round(ms / minuteMs) * minuteMs);
}

function isLikelyIsrael(lat, lon){
  return lat >= 29.4 && lat <= 33.4 && lon >= 34.2 && lon <= 35.9;
}

async function detectGatingLocation(){
  try{
    const pos = await getPositionOnce(4000);
    const lat = pos.coords.latitude, lon = pos.coords.longitude;
    return { lat, lon, source: 'gps', isIsrael: isLikelyIsrael(lat, lon) };
  }catch(e){}
  try{
    const res = await fetch('https://ipwho.is/');
    if(res.ok){
      const data = await res.json();
      if(data && data.success !== false && data.latitude && data.longitude){
        const isIsrael = data.country_code ? (data.country_code === 'IL') : isLikelyIsrael(data.latitude, data.longitude);
        return { lat: data.latitude, lon: data.longitude, source: 'ip', isIsrael };
      }
    }
  }catch(e){}
  return { lat: 31.7683, lon: 35.2137, source: 'default-israel', isIsrael: true }; // Jerusalem
}

let gatingIntervals = [];

// Resolves the Yom Tov name(s) a candle-lighting event is actually for, restricted to real Yom
// Tov days (yomtov:true) — this deliberately excludes same-category-but-minor "holiday" items such
// as Hoshana Rabbah, which otherwise look like the closest match simply because they share the
// Erev's own calendar date (the candle-lighting evening). When two Yom Tov names land on the very
// same day — e.g. Shmini Atzeret + Simchat Torah combined into one day in Israel — both are
// combined into one label ("שמיני עצרת ושמחת תורה") instead of arbitrarily picking just one; in the
// Diaspora, where they fall on separate days, each evening correctly resolves to its own single name.
function resolveNearbyYomTovLabel(items, candleDate, fallbackLabel, isIsrael){
  const candidates = items.filter(h =>
    h.category === 'holiday' &&
    h.yomtov === true &&
    !/^Erev\s+/i.test(h.title || '') &&
    Math.abs(new Date(h.date) - candleDate) < 1.5*86400000
  );
  if(!candidates.length) return fallbackLabel;
  // keep only the item(s) on the single closest calendar date, in case a second Yom Tov also
  // happens to fall just inside the window (e.g. the edge of a two-day Rosh Hashana)
  let closest = null;
  candidates.forEach(h=>{
    const diff = Math.abs(new Date(h.date) - candleDate);
    const day = new Date(h.date).toISOString().slice(0,10);
    if(!closest || diff < closest.diff) closest = { day, diff };
  });
  const sameDay = candidates.filter(h => new Date(h.date).toISOString().slice(0,10) === closest.day);
  // In Israel, Hebcal sends only ONE event ("Shmini Atzeret") for the combined day — there is no
  // separate same-day "Simchat Torah" entry to pick up here, since the two are the same calendar
  // day only in Israel (in the Diaspora they're genuinely two separate days, each its own event).
  // So this is a named special case, not something general same-day combining can discover on its own.
  if(isIsrael && sameDay.length === 1 && sameDay[0].title === 'Shmini Atzeret'){
    return hebraizeYearInText(sameDay[0].hebrew || 'שמיני עצרת') + ' ושמחת תורה';
  }
  const names = [...new Set(sameDay.map(h => hebraizeYearInText(h.hebrew || h.title || fallbackLabel)))];
  return names.join(' ו');
}

async function fetchGatingSchedule(loc){
  const tzid = (Intl.DateTimeFormat().resolvedOptions().timeZone) || 'Asia/Jerusalem';
  const now = new Date();
  // Start the fetch window well BEFORE today, not from today itself — otherwise, if the
  // site is opened while already mid-Shabbat/Yom-Tov (e.g. on Saturday, or on day 2 of a
  // multi-day Yom-Tov+Shabbat combination), the candle-lighting event that began it falls
  // outside the fetched range, so no interval gets built for the currently-active period
  // and the block never triggers. 4 days covers even the longest realistic combinations
  // (e.g. two-day Rosh Hashana running straight into Shabbat).
  const start = new Date(now.getTime() - 4*86400000).toISOString().slice(0,10);
  const end = new Date(now.getTime() + 10*86400000).toISOString().slice(0,10);
  const url = `https://www.hebcal.com/hebcal?cfg=json&v=1&c=on&maj=on&start=${start}&end=${end}&latitude=${loc.lat}&longitude=${loc.lon}&tzid=${encodeURIComponent(tzid)}${loc.isIsrael ? '&i=on' : ''}`;
  try{
    const res = await fetch(url);
    if(!res.ok) throw new Error('hebcal fetch failed');
    const data = await res.json();
    const items = data.items || [];
    const events = items
      .filter(i => i.category === 'candles' || i.category === 'havdalah')
      .map(i => ({ type: i.category, date: new Date(i.date), title: i.title }));
    events.sort((a,b)=> a.date - b.date);
    const intervals = [];
    for(let i=0; i<events.length; i++){
      if(events[i].type === 'candles'){
        const next = events.slice(i+1).find(e => e.type === 'havdalah');
        if(next){
          const label = resolveNearbyYomTovLabel(items, events[i].date, 'שבת', loc.isIsrael);
          intervals.push({ start: events[i].date, end: next.date, label });
        }
      }
    }
    return intervals;
  }catch(e){
    return [];
  }
}

// Look of the Shabbat / Yom Tov block, for pages that don't carry the banner markup and shared.css themselves
// (e.g. the accessibility statement): same rules as in shared.css, with fallbacks for the colours.
const SHABBAT_BANNER_CSS =
  '.shabbat-banner{display:none;position:fixed;top:0;right:0;bottom:0;left:0;z-index:9999;background:var(--ink,#1B2A4A);color:var(--paper,#F7F3E9);align-items:center;justify-content:center;text-align:center;padding:2rem 1.6rem;overflow-y:auto;}' +
  '.shabbat-banner.visible{display:flex;}' +
  '.shabbat-banner .shabbat-inner{max-width:32em;}' +
  ".shabbat-banner h2{font-family:'Frank Ruhl Libre',serif;font-size:1.7rem;margin:0 0 .8rem;color:var(--paper,#F7F3E9);}" +
  ".shabbat-banner p{font-family:'Noto Serif Hebrew',serif;font-size:1.02rem;color:var(--gold-light,#D9BF89);margin:0;line-height:1.9;}";
// Builds the banner (and its styles) when the page has none. Called only when a block is really due,
// so every page that loads shared.js and runs initGating() is blocked on Shabbat — even one written later.
function ensureShabbatBanner(){
  if(document.getElementById('shabbat-banner')) return;
  if(!document.getElementById('shabbat-banner-style')){
    const st = document.createElement('style');
    st.id = 'shabbat-banner-style';
    st.textContent = SHABBAT_BANNER_CSS;
    (document.head || document.documentElement).appendChild(st);
  }
  const banner = document.createElement('div');
  banner.id = 'shabbat-banner';
  banner.className = 'shabbat-banner';
  banner.setAttribute('role', 'status');
  const inner = document.createElement('div');
  inner.className = 'shabbat-inner';
  const title = document.createElement('h2');
  title.id = 'shabbat-banner-title';
  const text = document.createElement('p');
  text.id = 'shabbat-banner-text';
  inner.appendChild(title);
  inner.appendChild(text);
  banner.appendChild(inner);
  document.body.appendChild(banner);
}

function checkGating(){
  const now = new Date();
  const active = gatingIntervals.find(iv => now >= iv.start && now < iv.end);
  let banner = document.getElementById('shabbat-banner');
  if(!banner && active){ ensureShabbatBanner(); banner = document.getElementById('shabbat-banner'); }
  if(!banner) return;
  if(active){
    banner.classList.add('visible');
    document.body.style.overflow = 'hidden';
    document.getElementById('shabbat-banner-title').textContent = `${active.label} שלום!`;
    document.getElementById('shabbat-banner-text').textContent =
      `האתר מושבת לכבוד ${active.label}. יחזור לפעילות בצאת ${active.label === 'שבת' ? 'השבת' : active.label} בשעה ${active.end.toLocaleTimeString('he-IL',{hour:'2-digit', minute:'2-digit'})}.`;
  } else {
    banner.classList.remove('visible');
    document.body.style.overflow = '';
  }
}

async function fetchRegularHolidayLabel(){
  try{
    const tzid = (Intl.DateTimeFormat().resolvedOptions().timeZone) || 'Asia/Jerusalem';
    const now = new Date();
    const startStr = now.toISOString().slice(0,10);
    const end = new Date(now.getTime() + 86400000);
    const endStr = end.toISOString().slice(0,10);
    const url = `https://www.hebcal.com/hebcal?cfg=json&v=1&maj=on&min=on&mod=on&nx=on&mf=on&start=${startStr}&end=${endStr}&tzid=${encodeURIComponent(tzid)}`;
    const res = await fetch(url);
    if(!res.ok) throw new Error('fetch failed');
    const data = await res.json();
    const items = data.items || [];
    // "Regular" holidays: has a holiday/roshchodesh category but is NOT a full Yom Tov
    // (those are already covered by the Shabbat/Yom-Tov gating & the line above).
    // Major Yom Tov names (and their "Erev"/multi-day variants) are entirely handled by the
    // Shabbat/Yom-Tov gating system elsewhere — never show them (or their Erev) on this line.
    const MAJOR_YOMTOV_KEYWORDS = [
      'Rosh Hashana', 'Yom Kippur', 'Sukkot', 'Shmini Atzeret', 'Simchat Torah', 'Pesach', 'Shavuot'
    ];
    function isMajorYomTovRelated(item){
      if(!item || !item.title) return false;
      const bare = item.title.replace(/^Erev\s+/i, '');
      return MAJOR_YOMTOV_KEYWORDS.some(kw => bare.indexOf(kw) === 0 || bare === kw);
    }
    const regularItems = items.filter(i =>
      (i.category === 'holiday' || i.category === 'roshchodesh') && !i.yomtov && !isMajorYomTovRelated(i)
    );
    const todayItem = regularItems.find(i => i.date && i.date.slice(0,10) === startStr);
    const tomorrowItem = regularItems.find(i => i.date && i.date.slice(0,10) === endStr);

    // --- Purim: distinguish Purim d'Prazim (14 Adar) from Shushan Purim / d'Mukafin (15 Adar) ---
    function purimLabel(item, isErev){
      if(!item || !item.title) return null;
      let label = null;
      if(item.title === 'Purim') label = 'פורים (פורים דפרזים)';
      else if(item.title === 'Shushan Purim') label = 'שושן פורים (פורים דמוקפין — ירושלים)';
      if(label) return isErev ? 'ערב ' + label : label;
      return null;
    }
    const purimToday = purimLabel(todayItem, false);
    if(purimToday) return purimToday;
    const purimTomorrow = purimLabel(tomorrowItem, true);
    if(purimTomorrow) return purimTomorrow;

    // --- Chanukah: show which candle is already lit (from last night) and which is lit tonight.
    // Verified against Hebcal's own calendar: the "N Candles" label attached to a Gregorian date
    // is the candle lit THAT evening (i.e. "tonight"); the candle already burning since last night is N-1.
    function parseChanukah(item){
      if(!item || !item.title) return null;
      const mCandles = item.title.match(/Chanukah:\s*(\d+)\s*Candles?/i);
      if(mCandles) return { tonight: parseInt(mCandles[1], 10) };
      const mLastDay = item.title.match(/Chanukah:\s*8th Day/i);
      if(mLastDay) return { lastDay: true };
      return null;
    }
    const chanToday = parseChanukah(todayItem);
    if(chanToday){
      if(chanToday.lastDay){
        return `חנוכה — היום נר ${hebNum(8)} (היום האחרון, אין הדלקה הערב)`;
      }
      const tonight = chanToday.tonight;
      if(tonight === 1){
        return `חנוכה — הערב מדליקים נר ${hebNum(1)} (הנר הראשון)`;
      }
      return `חנוכה — היום דולק נר ${hebNum(tonight-1)}, הערב מדליקים נר ${hebNum(tonight)}`;
    }
    const chanTomorrow = parseChanukah(tomorrowItem);
    if(chanTomorrow && !chanTomorrow.lastDay && chanTomorrow.tonight === 1){
      return 'ערב חנוכה';
    }

    if(todayItem && todayItem.hebrew) return hebraizeYearInText(todayItem.hebrew);
    if(tomorrowItem && tomorrowItem.hebrew) return hebraizeYearInText('ערב ' + tomorrowItem.hebrew);
    return null;
  }catch(e){
    return null;
  }
}

async function updateRegularHolidayNote(){
  const el = document.getElementById('regular-holiday-note');
  if(!el) return;
  const label = await fetchRegularHolidayLabel();
  if(label){
    el.textContent = label;
    el.style.display = '';
  } else {
    el.textContent = '';
    el.style.display = 'none';
  }
}

async function updateUpcomingShabbatNote(){
  const noteEl = document.getElementById('upcoming-shabbat-note');
  if(!noteEl) return;
  let parashaText = '';
  try{
    // Explicitly tell Sefaria the user's own LOCAL calendar date, instead of relying on
    // its default server-side "today" resolution — otherwise, in the early-morning hours
    // (local midnight to a few hours after, depending on timezone offset), Sefaria may
    // still think it's "yesterday" and return the Shabbat that just ended, not the next one.
    const now = new Date();
    const dateParams = `&year=${now.getFullYear()}&month=${now.getMonth()+1}&day=${now.getDate()}`;
    const [resIL, resDiaspora] = await Promise.all([
      fetch(`https://www.sefaria.org/api/calendars?diaspora=0${dateParams}`),
      fetch(`https://www.sefaria.org/api/calendars?diaspora=1${dateParams}`)
    ]);
    function extractParasha(res, data){
      if(!res.ok || !data) return null;
      const items = (data && data.calendar_items) || [];
      const parasha = items.find(i => i.title && i.title.en === 'Parashat Hashavua');
      return (parasha && parasha.displayValue && parasha.displayValue.he) || null;
    }
    const dataIL = resIL.ok ? await resIL.json() : null;
    const dataDiaspora = resDiaspora.ok ? await resDiaspora.json() : null;
    const parashaIL = extractParasha(resIL, dataIL);
    const parashaDiaspora = extractParasha(resDiaspora, dataDiaspora);

    if(parashaIL && parashaDiaspora){
      if(parashaIL === parashaDiaspora){
        parashaText = `פרשת השבוע: ${parashaIL}`;
      } else {
        // Reading differs between Israel and the Diaspora this Shabbat (can happen for a
        // few weeks after Pesach/Sukkot, since Israel keeps one day of Yom Tov and the
        // Diaspora keeps two) — show both explicitly rather than picking just one.
        parashaText = `פרשת השבוע — יש הבדל: בארץ ישראל: ${parashaIL} · בחו"ל: ${parashaDiaspora}`;
      }
    } else if(parashaIL || parashaDiaspora){
      parashaText = `פרשת השבוע: ${parashaIL || parashaDiaspora}`;
    }
  }catch(e){ /* best-effort, ignore */ }

  let nextEntranceText = '';
  const now = new Date();
  const upcoming = gatingIntervals
    .filter(iv => iv.end > now)
    .sort((a,b)=> a.start - b.start)[0];
  if(upcoming && upcoming.label !== 'שבת'){
    // Show the upcoming Yom Tov starting from the Sunday of the week it falls in.
    // Special case: if the chag itself falls on a Sunday, show it from the Sunday before
    // (a full week of advance notice), rather than the same day.
    function startOfLocalDay(d){ const r = new Date(d); r.setHours(0,0,0,0); return r; }
    const chagDay = startOfLocalDay(upcoming.start);
    const dow = chagDay.getDay(); // 0 = Sunday
    const daysBack = (dow === 0) ? 7 : dow;
    const displayFrom = new Date(chagDay.getTime() - daysBack*86400000);
    if(startOfLocalDay(now) >= displayFrom){
      nextEntranceText = `החג הקרוב: ${upcoming.label}`;
    }
  }

  const parts = [parashaText, nextEntranceText].filter(Boolean);
  noteEl.textContent = parts.join(' · ');
}

async function initGating(){
  const loc = await detectGatingLocation();
  gatingIntervals = await fetchGatingSchedule(loc);
  checkGating();
  updateUpcomingShabbatNote();
  updateRegularHolidayNote();
}

/* =====================================================================
   TANAKH (Hebrew Bible) — generic book list, text/commentary fetching, and
   chapter-card rendering, reusable by any page that wants a Tanakh reader
   (daily-cycle mode, manual book+chapter selection, or anything else).
   ===================================================================== */
const TANAKH_BOOKS = [
  { he:'בראשית', en:'Genesis', cat:'תורה' },
  { he:'שמות', en:'Exodus', cat:'תורה' },
  { he:'ויקרא', en:'Leviticus', cat:'תורה' },
  { he:'במדבר', en:'Numbers', cat:'תורה' },
  { he:'דברים', en:'Deuteronomy', cat:'תורה' },
  { he:'יהושע', en:'Joshua', cat:'נביאים' },
  { he:'שופטים', en:'Judges', cat:'נביאים' },
  { he:'שמואל א', en:'I Samuel', cat:'נביאים' },
  { he:'שמואל ב', en:'II Samuel', cat:'נביאים' },
  { he:'מלכים א', en:'I Kings', cat:'נביאים' },
  { he:'מלכים ב', en:'II Kings', cat:'נביאים' },
  { he:'ישעיהו', en:'Isaiah', cat:'נביאים' },
  { he:'ירמיהו', en:'Jeremiah', cat:'נביאים' },
  { he:'יחזקאל', en:'Ezekiel', cat:'נביאים' },
  { he:'הושע', en:'Hosea', cat:'נביאים' },
  { he:'יואל', en:'Joel', cat:'נביאים' },
  { he:'עמוס', en:'Amos', cat:'נביאים' },
  { he:'עובדיה', en:'Obadiah', cat:'נביאים' },
  { he:'יונה', en:'Jonah', cat:'נביאים' },
  { he:'מיכה', en:'Micah', cat:'נביאים' },
  { he:'נחום', en:'Nahum', cat:'נביאים' },
  { he:'חבקוק', en:'Habakkuk', cat:'נביאים' },
  { he:'צפניה', en:'Zephaniah', cat:'נביאים' },
  { he:'חגי', en:'Haggai', cat:'נביאים' },
  { he:'זכריה', en:'Zechariah', cat:'נביאים' },
  { he:'מלאכי', en:'Malachi', cat:'נביאים' },
  { he:'תהלים', en:'Psalms', cat:'כתובים' },
  { he:'משלי', en:'Proverbs', cat:'כתובים' },
  { he:'איוב', en:'Job', cat:'כתובים' },
  { he:'שיר השירים', en:'Song of Songs', cat:'כתובים' },
  { he:'רות', en:'Ruth', cat:'כתובים' },
  { he:'איכה', en:'Lamentations', cat:'כתובים' },
  { he:'קהלת', en:'Ecclesiastes', cat:'כתובים' },
  { he:'אסתר', en:'Esther', cat:'כתובים' },
  { he:'דניאל', en:'Daniel', cat:'כתובים' },
  { he:'עזרא', en:'Ezra', cat:'כתובים' },
  { he:'נחמיה', en:'Nehemiah', cat:'כתובים' },
  { he:'דברי הימים א', en:'I Chronicles', cat:'כתובים' },
  { he:'דברי הימים ב', en:'II Chronicles', cat:'כתובים' }
];
function findTanakhBookHe(en){
  const b = TANAKH_BOOKS.find(b => b.en === en);
  return b ? b.he : en;
}

const tanakhBookCache = {};
async function fetchWholeTanakhBook(bookEn){
  if(tanakhBookCache[bookEn]) return tanakhBookCache[bookEn];
  const { text } = await fetchRefText(bookEn);
  if(!text || !Array.isArray(text)) throw new Error('no data for ' + bookEn);
  const cleaned = text.map(ch => Array.isArray(ch) ? ch.map(stripTags) : [stripTags(ch)]);
  tanakhBookCache[bookEn] = cleaned;
  return cleaned;
}

// Fetches Rashi for a whole chapter in one request; returns an array (one entry
// per verse) of commentary strings, or null per-verse when unavailable.
async function fetchTanakhChapterCommentary(bookEn, chapter, verseCount){
  const fallback = new Array(verseCount).fill(null);
  try{
    const { text } = await fetchRefText(`Rashi on ${bookEn} ${chapter}`);
    if(!text) return fallback;
    const perVerse = Array.isArray(text) ? text : [text];
    return perVerse.map(v=>{
      const flat = Array.isArray(v) ? v.flat(Infinity) : [v];
      const clean = flat.map(stripTags).filter(Boolean).join(' ');
      return clean || null;
    });
  }catch(e){
    return fallback;
  }
}

// Parses a Sefaria-style ref like "Genesis 1:1-31" or "I Samuel 3" into its
// book/chapter/verse-range parts, matching against the known TANAKH_BOOKS list
// (checked longest-name-first so e.g. "I Samuel" isn't mistaken for "Samuel").
function parseTanakhRef(ref){
  const sorted = [...TANAKH_BOOKS].sort((a,b)=> b.en.length - a.en.length);
  for(const book of sorted){
    if(ref.indexOf(book.en + ' ') === 0){
      const rest = ref.slice(book.en.length + 1);
      let m = rest.match(/^(\d+):(\d+)(?:-(\d+))?/);
      if(m) return { book, chapter: parseInt(m[1],10), fromVerse: parseInt(m[2],10), toVerse: m[3] ? parseInt(m[3],10) : parseInt(m[2],10) };
      m = rest.match(/^(\d+)/);
      if(m) return { book, chapter: parseInt(m[1],10), fromVerse: 1, toVerse: null };
    }
  }
  return null;
}

// Builds (but does not insert) a chapter-card element with numbered verses and,
// once fetched, Rashi commentary under each verse — mirroring the Mishnayot
// per-item verse+commentary layout. Caller appends/inserts it wherever needed.
function buildTanakhChapterCard(bookHe, bookEn, chapter, verses, fromVerse){
  const card = document.createElement('article');
  card.className = 'chapter-card';
  card.innerHTML = `
    <div class="chapter-head">
      <h2>${bookHe} פרק ${hebNum(chapter)}</h2>
      <div class="share-row"></div>
      <span class="gem">${bookEn} ${chapter}</span>
    </div>
    <div class="chapter-loading">טוען פרק…</div>
  `;
  const shareSlot = card.querySelector('.chapter-head .share-row');
  const url = location.href.split('#')[0];
  shareSlot.replaceWith(buildShareBar(url, `${bookHe} פרק ${hebNum(chapter)} — לימוד תנ"ך:`));

  const body = card.querySelector('.chapter-loading');
  const wrap = document.createElement('div');
  const startVerse = fromVerse || 1;
  verses.forEach((text, i)=>{
    const verseNum = startVerse + i;
    const versesDiv = document.createElement('div');
    versesDiv.className = 'verses';
    versesDiv.innerHTML = `<span class="v-num">${hebNum(verseNum)}</span> ${text}`;
    wrap.appendChild(versesDiv);

    const commentaryDiv = document.createElement('div');
    commentaryDiv.className = 'commentary';
    commentaryDiv.innerHTML = `<div class="c-label">פירוש (רש״י)</div><div class="c-text">טוען פירוש…</div>`;
    wrap.appendChild(commentaryDiv);
    commentaryDiv.dataset.verseIndex = i;
  });
  body.replaceWith(wrap);

  // Fetch commentary for the whole chapter in one request, then fill in each
  // verse's block (skipping ahead to the right slice if only a partial range
  // of the chapter is being shown).
  fetchTanakhChapterCommentary(bookEn, chapter, startVerse - 1 + verses.length).then(commentaryList=>{
    const commentaryDivs = wrap.querySelectorAll('.commentary');
    commentaryDivs.forEach(div=>{
      const i = parseInt(div.dataset.verseIndex, 10);
      const absoluteIdx = startVerse - 1 + i;
      const txt = commentaryList[absoluteIdx];
      const cText = div.querySelector('.c-text');
      if(txt){
        cText.textContent = txt;
      } else if(cText){
        cText.outerHTML = `<div class="c-unavailable">פירוש רש״י לא נמצא עבור פסוק זה.</div>`;
      }
    });
  });

  return card;
}

// Wires "previous"/"next" buttons that step a <select> through its options by one,
// automatically disabling at the first/last option (and while the select itself is
// disabled, e.g. still loading). Calls onStep() after each successful step, and
// returns an "update" function the caller can re-invoke whenever the select's own
// options change (repopulated, enabled/disabled) so button state stays in sync.
// Reusable for any select-driven prev/next navigation (chapter pickers, etc.).
function wireSelectNav(selectId, prevBtnId, nextBtnId, onStep){
  const select = document.getElementById(selectId);
  const prevBtn = document.getElementById(prevBtnId);
  const nextBtn = document.getElementById(nextBtnId);
  if(!select || !prevBtn || !nextBtn) return function(){};

  // Uses selectedIndex (always a true 0-based option POSITION on a real <select>)
  // rather than parsing .value — works correctly regardless of what the option
  // values themselves are (0-indexed, 1-indexed, or any other numbering scheme).
  function update(){
    if(select.disabled || select.options.length === 0){
      prevBtn.disabled = true;
      nextBtn.disabled = true;
      return;
    }
    const idx = select.selectedIndex;
    const lastIdx = select.options.length - 1;
    prevBtn.disabled = idx <= 0;
    nextBtn.disabled = idx >= lastIdx;
  }

  select.addEventListener('change', update);

  prevBtn.addEventListener('click', ()=>{
    if(select.selectedIndex <= 0) return;
    select.selectedIndex -= 1;
    update();
    if(onStep) onStep();
  });
  nextBtn.addEventListener('click', ()=>{
    const lastIdx = select.options.length - 1;
    if(select.selectedIndex >= lastIdx) return;
    select.selectedIndex += 1;
    update();
    if(onStep) onStep();
  });

  return update;
}

/* =====================================================================
   Generic Sefaria "daily calendar item" renderers — reusable for any
   date-driven daily-learning cycle (Halacha Yomit, Tanya Yomi, Daf Yomi,
   Yerushalmi Yomi, Tanakh Yomi, 929, Daily Rambam, etc).
   ===================================================================== */

// Plain-paragraph style (no verse numbers, no commentary) — for texts that
// aren't naturally verse-structured (halacha, tanya, gemara pages, etc).
async function renderDailyCalendarSection(titleEn, readerId, headingHe, selectedDate){
  const reader = document.getElementById(readerId);
  reader.innerHTML = '';
  const targetDate = selectedDate || new Date();
  let hebLabel;
  try{ hebLabel = getHebrewDisplay(targetDate); }catch(e){ hebLabel = null; }
  const gregLabel = targetDate.toLocaleDateString('he-IL');
  const dateLabel = hebLabel ? `${hebLabel} (${gregLabel})` : gregLabel;
  const card = document.createElement('article');
  card.className = 'chapter-card';
  card.innerHTML = `
    <div class="chapter-head">
      <h2>${headingHe}</h2>
      <div class="share-row"></div>
      <span class="gem" id="${readerId}-ref-label">${titleEn}</span>
    </div>
    <p class="learning-date-label" id="${readerId}-date-label">${dateLabel}<span class="sub">הלימוד המוצג הוא לתאריך זה — לא בהכרח לתאריך של היום</span></p>
    <div class="chapter-loading">טוען…</div>
  `;
  const shareSlot = card.querySelector('.chapter-head .share-row');
  shareSlot.replaceWith(buildShareBar(location.href.split('#')[0], `${headingHe} — לימוד יומי:`));
  reader.appendChild(card);
  const body = card.querySelector('.chapter-loading');
  try{
    // Always pass an explicit date to Sefaria (the selected date, or today's LOCAL date) —
    // relying on Sefaria's own default "today" can lag behind the user's local calendar date
    // by several hours right after local midnight, showing yesterday's daily-learning portion.
    const dfc1 = selectedDate || new Date();
    const calendarUrl = selectedDate
      ? `https://www.sefaria.org/api/calendars?diaspora=0&year=${dfc1.getUTCFullYear()}&month=${dfc1.getUTCMonth()+1}&day=${dfc1.getUTCDate()}`
      : `https://www.sefaria.org/api/calendars?diaspora=0&year=${dfc1.getFullYear()}&month=${dfc1.getMonth()+1}&day=${dfc1.getDate()}`;
    const res = await fetch(calendarUrl);
    if(!res.ok) throw new Error('calendar fetch failed');
    const data = await res.json();
    const items = (data && data.calendar_items) || [];
    const item = items.find(i => i.title && i.title.en === titleEn);
    if(!item || !item.ref) throw new Error('no item: ' + titleEn);
    const { text, ref: resolvedRef } = await fetchRefText(item.ref);
    if(!text) throw new Error('empty text');
    const flat = Array.isArray(text) ? text.flat(Infinity) : [text];
    const paragraphs = flat.map(stripTags).filter(Boolean);
    if(!paragraphs.length) throw new Error('no paragraphs');
    card.querySelector('.chapter-head h2').textContent = (item.displayValue && (item.displayValue.he || (item.title && item.title.he))) || headingHe;
    const refLabel = document.getElementById(readerId+'-ref-label');
    if(refLabel) refLabel.textContent = resolvedRef || item.ref;
    const versesDiv = document.createElement('div');
    versesDiv.className = 'verses';
    versesDiv.innerHTML = paragraphs.map(p => `<p>${p}</p>`).join('');
    body.replaceWith(versesDiv);
  }catch(e){
    body.className = 'chapter-error';
    body.innerHTML = `לא ניתן היה לטעון את התוכן כרגע. אפשר לראות אותו ישירות ב<a href="https://www.sefaria.org/calendars" target="_blank" rel="noopener">ספריא</a>.`;
  }
}

// Verse-numbered style with Rashi commentary, for daily cycles whose ref points
// into the Tanakh (book + chapter) — e.g. "Tanakh Yomi" or "929".
async function renderTanakhStyleDailyCalendar(titleEn, readerId, headingHe, selectedDate){
  const reader = document.getElementById(readerId);
  reader.innerHTML = '';
  const loadingEl = document.createElement('p');
  loadingEl.className = 'chapter-loading';
  loadingEl.textContent = `טוען ${headingHe}…`;
  reader.appendChild(loadingEl);
  try{
    const targetDate = selectedDate || new Date();
    const calendarUrl = selectedDate
      ? `https://www.sefaria.org/api/calendars?diaspora=0&year=${targetDate.getUTCFullYear()}&month=${targetDate.getUTCMonth()+1}&day=${targetDate.getUTCDate()}`
      : `https://www.sefaria.org/api/calendars?diaspora=0&year=${targetDate.getFullYear()}&month=${targetDate.getMonth()+1}&day=${targetDate.getDate()}`;
    const res = await fetch(calendarUrl);
    if(!res.ok) throw new Error('calendar fetch failed');
    const data = await res.json();
    const items = (data && data.calendar_items) || [];
    const item = items.find(i => i.title && i.title.en === titleEn);
    if(!item || !item.ref) throw new Error('no item: ' + titleEn);
    const loc = parseTanakhRef(item.ref);
    if(!loc) throw new Error('could not parse ref: ' + item.ref);
    const chapters = await fetchWholeTanakhBook(loc.book.en);
    const chapterArr = chapters[loc.chapter - 1];
    if(!chapterArr) throw new Error('chapter not found');
    const toVerse = loc.toVerse || chapterArr.length;
    const verses = chapterArr.slice(loc.fromVerse - 1, toVerse);
    if(!verses.length) throw new Error('no verses found');
    reader.innerHTML = '';
    const card = buildTanakhChapterCard(loc.book.he, loc.book.en, loc.chapter, verses, loc.fromVerse);
    card.querySelector('.chapter-head h2').textContent = `${headingHe} — ${loc.book.he} פרק ${hebNum(loc.chapter)}`;
    reader.appendChild(card);
  }catch(e){
    reader.innerHTML = `<p class="chapter-error">לא ניתן היה לטעון את התוכן כרגע. אפשר לראות אותו ישירות ב<a href="https://www.sefaria.org/calendars" target="_blank" rel="noopener">ספריא</a>.</p>`;
  }
}

/* =====================================================================
   PWA — registers the service worker (sw.js) so the site can be
   "installed" (Add to Home Screen) and keeps working, in a limited way,
   when the device is briefly offline. No-ops silently in browsers/contexts
   that don't support service workers.
   ===================================================================== */
function registerServiceWorker(){
  if(!('serviceWorker' in navigator)) return;
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('sw.js').catch(()=>{
      // Fails silently (e.g. running from file://, or the browser blocked it) —
      // the site still works normally online, it just won't be installable/offline.
    });
  });
}
registerServiceWorker();

/* =====================================================================
   "Daf" style daily calendar renderer — sequential text segments (not
   verse-numbered) each followed by up to several named commentaries
   (e.g. Rashi + Tosafot for Daf Yomi). Reusable for any daily cycle whose
   base text is Talmud-style continuous prose rather than verses.
   ===================================================================== */

// Fetches one commentator's text for a base ref, in one request; returns an
// array (one entry per base-text segment) of commentary strings, or null
// per-segment when unavailable.
async function fetchDafCommentary(commentatorName, baseRef){
  try{
    const { text } = await fetchRefText(`${commentatorName} on ${baseRef}`);
    if(!text) return null;
    const perSegment = Array.isArray(text) ? text : [text];
    return perSegment.map(seg=>{
      const flat = Array.isArray(seg) ? seg.flat(Infinity) : [seg];
      const clean = flat.map(stripTags).filter(Boolean).join(' ');
      return clean || null;
    });
  }catch(e){
    return null;
  }
}

// commentators: array of { name: 'Rashi', labelHe: 'רש״י' } — one block per
// text segment, per commentator, fetched in parallel and filled in once ready.
async function renderDafStyleDailyCalendar(titleEn, readerId, headingHe, selectedDate, commentators){
  const reader = document.getElementById(readerId);
  reader.innerHTML = '';
  const loadingEl = document.createElement('p');
  loadingEl.className = 'chapter-loading';
  loadingEl.textContent = `טוען ${headingHe}…`;
  reader.appendChild(loadingEl);
  try{
    const targetDate = selectedDate || new Date();
    const calendarUrl = selectedDate
      ? `https://www.sefaria.org/api/calendars?diaspora=0&year=${targetDate.getUTCFullYear()}&month=${targetDate.getUTCMonth()+1}&day=${targetDate.getUTCDate()}`
      : `https://www.sefaria.org/api/calendars?diaspora=0&year=${targetDate.getFullYear()}&month=${targetDate.getMonth()+1}&day=${targetDate.getDate()}`;
    const res = await fetch(calendarUrl);
    if(!res.ok) throw new Error('calendar fetch failed');
    const data = await res.json();
    const items = (data && data.calendar_items) || [];
    const item = items.find(i => i.title && i.title.en === titleEn);
    if(!item || !item.ref) throw new Error('no item: ' + titleEn);
    const { text, ref: resolvedRef } = await fetchRefText(item.ref);
    if(!text) throw new Error('empty text');
    const flat = Array.isArray(text) ? text : [text];
    const paragraphs = flat.map(p => {
      const inner = Array.isArray(p) ? p.flat(Infinity) : [p];
      return inner.map(stripTags).filter(Boolean).join(' ');
    }).filter(Boolean);
    if(!paragraphs.length) throw new Error('no paragraphs');

    reader.innerHTML = '';
    const card = document.createElement('article');
    card.className = 'chapter-card';
    card.innerHTML = `
      <div class="chapter-head">
        <h2>${(item.displayValue && (item.displayValue.he || (item.title && item.title.he))) || headingHe}</h2>
        <div class="share-row"></div>
        <span class="gem">${resolvedRef || item.ref}</span>
      </div>
      <p class="learning-date-label">${(commentators||[]).map(c=>c.labelHe.replace(/^פירוש \((.+)\)$/,'$1')).join(' ו')}<span class="sub">הפירוש מופיע בהמשך העמוד, אחרי כל קטע טקסט</span></p>
    `;
    const shareSlot = card.querySelector('.chapter-head .share-row');
    shareSlot.replaceWith(buildShareBar(location.href.split('#')[0], `${headingHe} — לימוד יומי:`));

    const wrap = document.createElement('div');
    paragraphs.forEach((p, i)=>{
      const pDiv = document.createElement('div');
      pDiv.className = 'verses';
      pDiv.textContent = p;
      wrap.appendChild(pDiv);

      commentators.forEach(c=>{
        const cDiv = document.createElement('div');
        cDiv.className = 'commentary';
        cDiv.innerHTML = `<div class="c-label">${c.labelHe}</div><div class="c-text">טוען פירוש…</div>`;
        cDiv.dataset.segIndex = i;
        cDiv.dataset.commentator = c.name;
        wrap.appendChild(cDiv);
      });
    });
    card.appendChild(wrap);
    reader.appendChild(card);

    const baseRef = resolvedRef || item.ref;
    const results = await Promise.all(commentators.map(c => fetchDafCommentary(c.name, baseRef)));
    const commentaryDivs = wrap.querySelectorAll('.commentary');
    commentaryDivs.forEach(div=>{
      const i = parseInt(div.dataset.segIndex, 10);
      const cIdx = commentators.findIndex(c => c.name === div.dataset.commentator);
      const list = results[cIdx];
      const txt = list ? list[i] : null;
      const cText = div.querySelector('.c-text');
      if(txt){
        cText.textContent = txt;
      } else if(cText){
        const label = (commentators[cIdx] && commentators[cIdx].labelHe) || 'הפירוש';
        cText.outerHTML = `<div class="c-unavailable">${label} לא נמצא עבור קטע זה.</div>`;
      }
    });
  }catch(e){
    reader.innerHTML = `<p class="chapter-error">לא ניתן היה לטעון את התוכן כרגע. אפשר לראות אותו ישירות ב<a href="https://www.sefaria.org/calendars" target="_blank" rel="noopener">ספריא</a>.</p>`;
  }
}

/* =====================================================================
   HEBREW ⇄ GREGORIAN DATE CONVERSION
   Built on the browser's own Hebrew calendar (Intl / ICU), so results always
   agree with every other Hebrew date shown on the site. Works over the whole
   range JavaScript dates allow (roughly ±270,000 years). All arithmetic is done
   in UTC at noon, so time zones, DST and historical local-time offsets can never
   shift a date. Gregorian years here use astronomical numbering
   (year 0 = 1 BCE, -1 = 2 BCE); dates before 1582 are proleptic Gregorian.
   ===================================================================== */
const DAY_MS = 86400000;
const GREG_MONTH_NAMES_HE = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
const HEB_ANCHOR_MS = Date.UTC(2026, 8, 12, 12);   // 1 Tishrei 5787, noon UTC
const HEB_ANCHOR_YEAR = 5787;
const HEB_MEAN_YEAR_DAYS = 365.2468222;            // mean Hebrew year, used only to get near a year's start
const HEB_MAX_MS = 8.64e15;                        // JavaScript Date limit

function hebrewCalendarSupported(){
  try{ return new Intl.DateTimeFormat('en-u-ca-hebrew').resolvedOptions().calendar === 'hebrew'; }
  catch(e){ return false; }
}

let _hebFormatterInstance = null;
function _hebFormatter(){
  if(!_hebFormatterInstance){
    _hebFormatterInstance = new Intl.DateTimeFormat('he-u-ca-hebrew', { timeZone:'UTC', year:'numeric', month:'long', day:'numeric' });
  }
  return _hebFormatterInstance;
}

// Date at 12:00 UTC for a (possibly ancient or far-future) Gregorian year. Uses
// setUTCFullYear because Date.UTC maps years 0–99 onto 1900–1999. Null if out of range.
function makeUTCNoon(year, monthIndex, day){
  const d = new Date(0);
  d.setUTCFullYear(year, monthIndex, day);
  d.setUTCHours(12, 0, 0, 0);
  return isNaN(d.getTime()) ? null : d;
}

// Hebrew {year, month (name), day} for a moment, or year NaN/<1 when unavailable.
function hebrewPartsAt(ms){
  let year = NaN, month = '', day = NaN;
  const parts = _hebFormatter().formatToParts(new Date(ms));
  for(const p of parts){
    if(p.type === 'year'){
      const s = p.value.replace(/[\u200e\u200f]/g, '');   // ICU puts a direction mark before a minus sign
      const neg = /^[-\u2212]/.test(s);
      const digits = s.replace(/\D/g, '');
      year = digits ? (neg ? -1 : 1) * parseInt(digits, 10) : NaN;
    } else if(p.type === 'month'){
      month = p.value;
    } else if(p.type === 'day'){
      const digits = p.value.replace(/\D/g, '');
      day = digits ? parseInt(digits, 10) : NaN;
    }
  }
  return { year, month, day };
}

// Hebrew date of a Gregorian day (ms at noon UTC); null before Hebrew year 1.
function gregorianToHebrew(ms){
  if(!(Math.abs(ms) <= HEB_MAX_MS)) return null;
  const p = hebrewPartsAt(ms);
  if(!(p.year >= 1) || !p.month || !(p.day >= 1)) return null;
  return p;
}

const _hebYearCache = new Map();
// Everything about one Hebrew year: first day, length, leap or not, and every month
// (in order, with its ICU name, first day and number of days — which also covers the
// varying Cheshvan/Kislev and the Adar I/II structure of leap years).
function getHebrewYearInfo(H){
  if(!Number.isInteger(H) || H < 1) return null;
  if(_hebYearCache.has(H)) return _hebYearCache.get(H);
  const est = HEB_ANCHOR_MS + (H - HEB_ANCHOR_YEAR) * HEB_MEAN_YEAR_DAYS * DAY_MS;
  if(!(Math.abs(est) < HEB_MAX_MS - 500*DAY_MS)) return null;
  let ms = Math.floor(est / DAY_MS) * DAY_MS + DAY_MS/2;
  // The estimate lands within a few weeks of Rosh Hashana: step back to before the year, then forward to its first day.
  let guard = 0;
  while(hebrewPartsAt(ms).year >= H){ ms -= DAY_MS; if(++guard > 800) return null; }
  guard = 0;
  while(hebrewPartsAt(ms).year < H){ ms += DAY_MS; if(++guard > 800) return null; }
  const startMs = ms;
  const months = [];
  let cur = null, days = 0;
  while(days <= 400){
    const p = hebrewPartsAt(ms);
    if(p.year !== H) break;
    if(!cur || cur.name !== p.month){ cur = { name: p.month, startMs: ms, days: 0 }; months.push(cur); }
    cur.days++; days++; ms += DAY_MS;
  }
  if(days < 350 || days > 390) return null;
  const info = { year: H, startMs, days, leap: months.length === 13, months };
  _hebYearCache.set(H, info);
  return info;
}

// Gregorian day (ms at noon UTC) for a Hebrew date. On failure returns { error, maxDay? }.
function hebrewToGregorianMs(H, monthName, day){
  const info = getHebrewYearInfo(H);
  if(!info) return { error: 'year' };
  const m = info.months.find(x => x.name === monthName);
  if(!m) return { error: 'month' };
  if(!Number.isInteger(day) || day < 1 || day > m.days) return { error: 'day', maxDay: m.days };
  return { ms: m.startMs + (day - 1) * DAY_MS, info };
}

// "ה׳ תשפ״ו"-style year letters; the current millennium's thousands digit is dropped, as everywhere on this site.
function hebrewYearLetters(y){
  const thousands = Math.floor(y / 1000), rest = y % 1000;
  const restLetters = rest > 0 ? hebNum(rest) : '';
  if(thousands === 0) return restLetters + ' (' + y + ')';   // years 1–999: letters alone would look like the 5000s
  if(thousands === 5) return restLetters || (hebNum(5) + ' אלפים');
  return hebNum(thousands) + ' ' + (restLetters || 'אלפים');
}
function formatHebrewDateLetters(p){ return `${hebNum(p.day)} ב${p.month} ${hebrewYearLetters(p.year)}`; }
function formatHebrewDateDigits(p){ return `${p.day} ב${p.month} ${p.year}`; }
// 353/383 = deficient (חסרה), 354/384 = regular (כסדרה), 355/385 = complete (שלמה)
function hebrewYearKindHe(days){
  const r = days % 10;
  return r === 3 ? 'חסרה' : (r === 4 ? 'כסדרה' : 'שלמה');
}

function gregorianYearLabel(y){ return y <= 0 ? `${1 - y} לפנה״ס` : String(y); }
function formatGregorianLong(ms){
  const d = new Date(ms);
  return `${d.getUTCDate()} ב${GREG_MONTH_NAMES_HE[d.getUTCMonth()]} ${gregorianYearLabel(d.getUTCFullYear())}`;
}
function formatGregorianNumeric(ms){
  const d = new Date(ms);
  return `${d.getUTCDate()}.${d.getUTCMonth() + 1}.${gregorianYearLabel(d.getUTCFullYear())}`;
}
function weekdayNameAt(ms){ return WEEKDAY_NAMES[new Date(ms).getUTCDay()]; }

const _HEB_LETTER_VALUES = {'א':1,'ב':2,'ג':3,'ד':4,'ה':5,'ו':6,'ז':7,'ח':8,'ט':9,'י':10,'כ':20,'ך':20,'ל':30,'מ':40,'ם':40,'נ':50,'ן':50,'ס':60,'ע':70,'פ':80,'ף':80,'צ':90,'ץ':90,'ק':100,'ר':200,'ש':300,'ת':400};
function gematriaValue(str){
  let sum = 0;
  for(const ch of str) sum += _HEB_LETTER_VALUES[ch] || 0;
  return sum;
}
// Accepts plain digits ("5786", "786"), or Hebrew letters ("תשפ״ו", "תשפו", "ה׳תשפ״ו").
// Letters without an explicit thousands marker mean the current millennium (5000s).
function parseHebrewYearInput(str){
  const s = String(str || '').trim();
  if(!s) return NaN;
  const plain = s.replace(/[,\s]/g, '');
  if(/^\d+$/.test(plain)) return parseInt(plain, 10);
  const withMarker = s.match(/^([א-ת])\s*['׳’`]\s*([א-ת'"׳״’`\s]+)$/);
  if(withMarker){
    const restVal = gematriaValue(withMarker[2].replace(/[^א-ת]/g, ''));
    return gematriaValue(withMarker[1]) * 1000 + restVal;
  }
  const letters = s.replace(/[^א-ת]/g, '');
  if(!letters) return NaN;
  const v = gematriaValue(letters);
  return v < 1000 ? v + 5000 : v;
}

/* =====================================================================
   Small page-level helpers shared by every page of the site
   ===================================================================== */
// Header "today" strip: an immediate midnight-based value, then the sunset-aware one.
function initHeaderDate(){
  const now = new Date();
  const wd = document.getElementById('today-weekday');
  const hb = document.getElementById('today-hebrew');
  if(wd) wd.textContent = "יום " + WEEKDAY_NAMES[now.getDay()];
  const gregLabel = now.toLocaleDateString('he-IL');
  if(hb){
    try{ hb.textContent = `${getHebrewDisplay(now)} (${gregLabel})`; }
    catch(e){ hb.textContent = `לא זמין בדפדפן זה (${gregLabel})`; }
  }
  updateHebrewDateDisplay();
}
// Floating WhatsApp button: shares this page's address with the given text.
function initWhatsappFloat(shareText){
  const btn = document.getElementById('whatsapp-float');
  if(!btn) return;
  const url = location.href.split('#')[0];
  btn.href = `https://wa.me/?text=${encodeURIComponent(shareText + ' ' + url)}`;
}
// Site-wide Shabbat / Yom Tov block: load the schedule now, re-check often, refresh every 6 hours.
function startSiteGating(){
  initGating();
  setInterval(checkGating, 30000);
  setInterval(initGating, 6*60*60*1000);
}

/* =====================================================================
   HEBREW-DATE PICKERS — month and day lists that follow the chosen year
   ===================================================================== */
// Fills a <select> with the months of Hebrew year `year` (leap years included) and selects
// `preferred` (or the current choice). Adar of a regular year corresponds to Adar II of a leap
// year, and back. Returns the year info, or null when the year can't be computed.
function populateHebrewMonthSelect(sel, year, preferred){
  const previous = preferred || sel.value;
  const info = getHebrewYearInfo(year);
  sel.innerHTML = '';
  if(!info){ sel.disabled = true; return null; }
  sel.disabled = false;
  info.months.forEach(m => {
    const o = document.createElement('option');
    o.value = m.name;
    o.textContent = m.name;
    sel.appendChild(o);
  });
  let target = previous;
  if(!info.months.some(m => m.name === target)){
    if(target === 'אדר' && info.leap) target = 'אדר ב׳';
    else if((target === 'אדר ב׳' || target === 'אדר א׳') && !info.leap) target = 'אדר';
    else target = info.months[0].name;
  }
  sel.value = target;
  return info;
}
// Fills a <select> with the days 1..N of a Hebrew month (N = that month's real length in that year).
function populateHebrewDaySelect(sel, year, monthName, preferredDay){
  const previous = preferredDay || parseInt(sel.value, 10) || 1;
  const info = getHebrewYearInfo(year);
  const m = info && info.months.find(x => x.name === monthName);
  sel.innerHTML = '';
  if(!m){ sel.disabled = true; return; }
  sel.disabled = false;
  for(let d = 1; d <= m.days; d++){
    const o = document.createElement('option');
    o.value = String(d);
    o.textContent = hebNum(d) + ' (' + d + ')';
    sel.appendChild(o);
  }
  sel.value = String(Math.min(previous, m.days));
}

/* =====================================================================
   BAR MITZVAH — the Hebrew birthday of the 13th year, and the Shabbat on or after it
   ===================================================================== */
const BAR_MITZVAH_AGE = 13;

// "YYYY-MM-DD" of a moment (UTC), and back to noon UTC. Only meant for years 1000–9999.
function isoDateOfMs(ms){ return new Date(ms).toISOString().slice(0, 10); }
function msFromIsoDate(iso){
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if(!m) return null;
  const y = parseInt(m[1], 10), mo = parseInt(m[2], 10) - 1, d = parseInt(m[3], 10);
  const dt = makeUTCNoon(y, mo, d);
  if(!dt || dt.getUTCMonth() !== mo || dt.getUTCDate() !== d) return null;
  return dt.getTime();
}

// The day of Hebrew year `targetYear` on which a birthday / anniversary of `birth` {year, month, day}
// is marked, by the Ashkenazi rules of the Rema as set out in Calendrical Calculations (Reingold &
// Dershowitz) and used by Hebcal — Sephardi custom may differ for Adar:
//  - born in Adar of a regular year -> Adar II in a leap year; born in Adar II -> Adar in a regular year;
//  - born in Adar I -> Adar in a regular year (30 Adar I -> 1 Nisan);
//  - 30 Cheshvan when Cheshvan has only 29 days -> 1 Kislev; 30 Kislev when Kislev has 29 -> 1 Tevet.
// Works on month POSITIONS, so it doesn't depend on how the browser spells the month names.
// Returns { month, day, note } (note is '' when nothing had to be adjusted), or null.
function hebrewAnniversary(birth, targetYear){
  const bInfo = getHebrewYearInfo(birth.year), tInfo = getHebrewYearInfo(targetYear);
  if(!bInfo || !tInfo) return null;
  const bIdx = bInfo.months.findIndex(m => m.name === birth.month);
  if(bIdx < 0) return null;
  let month = birth.month, day = birth.day, note = '';
  const bAdarRegular = !bInfo.leap && bIdx === 5;
  const bAdar1 = bInfo.leap && bIdx === 5;
  const bAdar2 = bInfo.leap && bIdx === 6;
  if(bAdarRegular || bAdar2){
    month = tInfo.months[tInfo.leap ? 6 : 5].name;          // the last Adar of the target year
    if(bAdarRegular && tInfo.leap) note = 'נולד באדר בשנה פשוטה, ושנת בר המצווה מעוברת — לפי הרמ״א (מנהג אשכנז) מציינים באדר ב׳. לפי מנהג הספרדים ייתכן שמציינים באדר א׳ — כדאי לשאול רב.';
    else if(bAdar2 && !tInfo.leap) note = 'נולד באדר ב׳ — בשנה פשוטה מציינים את היום באדר.';
  } else if(bAdar1){
    if(!tInfo.leap){
      month = tInfo.months[5].name;                          // Adar
      note = 'נולד באדר א׳ — בשנה פשוטה מציינים את היום באדר.';
      if(day === 30){
        month = tInfo.months[6].name;                        // Nisan
        day = 1;
        note = 'נולד ב־ל׳ באדר א׳ — בשנה פשוטה מציינים את היום ב־א׳ בניסן.';
      }
    }
  } else if(bIdx === 1 && day === 30 && tInfo.months[1].days < 30){
    month = tInfo.months[2].name;
    day = 1;
    note = 'נולד ב־ל׳ ב' + birth.month + ', ובשנה הזאת ל' + birth.month + ' יש רק 29 ימים — מציינים ב־א׳ ב' + month + '.';
  } else if(bIdx === 2 && day === 30 && tInfo.months[2].days < 30){
    month = tInfo.months[3].name;
    day = 1;
    note = 'נולד ב־ל׳ ב' + birth.month + ', ובשנה הזאת ל' + birth.month + ' יש רק 29 ימים — מציינים ב־א׳ ב' + month + '.';
  }
  return { month, day, note };
}

// Bar mitzvah for a boy whose Hebrew birth date is `birth` {year, month, day}: the Hebrew date of the
// 13th birthday, its civil date, and the Shabbat on or after it (the Shabbat he reads the Torah).
// The Hebrew day begins at sunset the evening before; a date that falls on Shabbat itself counts as that Shabbat.
function calcBarMitzvah(birth, age){
  const years = age || BAR_MITZVAH_AGE;
  const year = birth.year + years;
  const ann = hebrewAnniversary(birth, year);
  if(!ann) return null;
  const r = hebrewToGregorianMs(year, ann.month, ann.day);
  if(r.error) return null;
  const weekday = new Date(r.ms).getUTCDay();               // 0 = Sunday ... 6 = Shabbat
  return {
    hebrew: { year, month: ann.month, day: ann.day },
    note: ann.note,
    ms: r.ms,
    weekday,
    shabbatMs: r.ms + ((6 - weekday + 7) % 7) * DAY_MS,
    onShabbat: weekday === 6
  };
}

// Hebcal request for the weekly portions and major holidays around one Shabbat (±3 weeks).
function hebcalShabbatUrl(shabbatMs, israel){
  return 'https://www.hebcal.com/hebcal?v=1&cfg=json&s=on&maj=on&leyning=off'
    + '&start=' + isoDateOfMs(shabbatMs - 21 * DAY_MS)
    + '&end=' + isoDateOfMs(shabbatMs + 21 * DAY_MS)
    + (israel ? '&i=on' : '');
}
// What is read on a given Shabbat: { parasha, holidays, prev, next } — each parasha is Hebcal's item
// ({ title, hebrew, date }). parasha is null when the Shabbat has no regular portion (Yom Tov,
// Chol HaMoed); holidays then lists what falls on that day, and prev/next are the neighbouring portions.
// israel = true uses the Israeli reading schedule, false the Diaspora one. Data: Hebcal.com (CC BY 4.0).
async function fetchShabbatReading(shabbatMs, israel){
  const res = await fetch(hebcalShabbatUrl(shabbatMs, israel));
  if(!res.ok) throw new Error('hebcal request failed: ' + res.status);
  const data = await res.json();
  const items = (data && data.items) || [];
  const day = isoDateOfMs(shabbatMs);
  const portions = items.filter(i => i.category === 'parashat' && i.date);
  return {
    parasha: portions.find(i => i.date === day) || null,
    holidays: items.filter(i => i.category === 'holiday' && i.date === day && !/^Erev\b/i.test(i.title || '')),
    prev: portions.filter(i => i.date < day).pop() || null,
    next: portions.find(i => i.date > day) || null
  };
}

/* =====================================================================
   GREGORIAN DAY PICKER — a list of days that follows the chosen month and year
   ===================================================================== */
// Number of days in a Gregorian month. Without a usable year, February is given 29 days
// so that no valid date is ever hidden while the year is still being typed.
function gregorianDaysInMonth(year, monthIndex){
  if(Number.isInteger(year)){
    const last = makeUTCNoon(year, monthIndex + 1, 0);     // day 0 of the next month = last day of this one
    if(last) return last.getUTCDate();
  }
  return [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][monthIndex] || 31;
}
// Fills a <select> with 1..N for that month/year and keeps the current (or `preferredDay`) choice,
// pulled down to the month's last day when it no longer exists (31 -> 30, 29 Feb -> 28 Feb).
// With `placeholder` (e.g. "יום") the list starts with an empty first choice and nothing is preselected
// until the visitor picks — used where a forgotten day must not silently become "1".
function populateGregorianDaySelect(sel, year, monthIndex, preferredDay, placeholder){
  const previous = (preferredDay !== undefined && preferredDay !== null) ? preferredDay : parseInt(sel.value, 10);
  const n = gregorianDaysInMonth(year, monthIndex);
  sel.innerHTML = '';
  if(placeholder){
    const o = document.createElement('option');
    o.value = '';
    o.textContent = placeholder;
    sel.appendChild(o);
  }
  for(let d = 1; d <= n; d++){
    const o = document.createElement('option');
    o.value = String(d);
    o.textContent = String(d);
    sel.appendChild(o);
  }
  sel.value = previous >= 1 ? String(Math.min(previous, n)) : (placeholder ? '' : '1');
}

/* =====================================================================
   VEZOT HABERAKHAH — the one portion that is read on a festival, not on a Shabbat
   ===================================================================== */
// Simchat Torah, when Vezot HaBerakhah is read: 22 Tishrei in Israel (together with Shmini Atzeret),
// 23 Tishrei abroad. Returns noon UTC of that day, or null.
function simchatTorahMs(hebrewYear, israel){
  const info = getHebrewYearInfo(hebrewYear);
  if(!info) return null;
  const r = hebrewToGregorianMs(hebrewYear, info.months[0].name, israel ? 22 : 23);
  return r.error ? null : r.ms;
}
// True when Simchat Torah (the reading of Vezot HaBerakhah) is the first reading of the annual cycle
// after a bar-mitzvah date: the date falls in Tishrei, on or before Simchat Torah, and no regular weekly
// portion is read before it. `firstPortionMs` = date of the first regular weekly portion on or after the
// bar-mitzvah date (null / undefined = none nearby, so Simchat Torah comes first).
function vezotHaberakhahFirst(bm, israel, firstPortionMs){
  const info = getHebrewYearInfo(bm.hebrew.year);
  if(!info || bm.hebrew.month !== info.months[0].name) return false;
  const st = simchatTorahMs(bm.hebrew.year, israel);
  if(st === null || bm.ms > st) return false;
  return firstPortionMs === null || firstPortionMs === undefined || st <= firstPortionMs;
}
