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
          let label = 'שבת';
          const nearbyHoliday = items.find(h =>
            h.category === 'holiday' &&
            !/^Erev\s+/i.test(h.title || '') &&
            Math.abs(new Date(h.date) - events[i].date) < 1.5*86400000
          );
          if(nearbyHoliday) label = hebraizeYearInText(nearbyHoliday.hebrew || nearbyHoliday.title || label);
          intervals.push({ start: events[i].date, end: next.date, label });
        }
      }
    }
    return intervals;
  }catch(e){
    return [];
  }
}

function checkGating(){
  const now = new Date();
  const active = gatingIntervals.find(iv => now >= iv.start && now < iv.end);
  const banner = document.getElementById('shabbat-banner');
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
