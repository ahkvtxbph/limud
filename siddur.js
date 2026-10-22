/* siddur.js — the dynamic siddur (סידור תפילה), shared by the siddur pages.
   Loaded after shared.js (uses hebNum, getHebrewDisplay, WEEKDAY_NAMES, buildShareBar,
   detectGatingLocation, calcSunsetUTC, calcSunEventUTC).

   How it works, in three layers:
   1. DAY  — sdComputeFacts() works out, from the Hebrew calendar alone (no network), what the
             day is: Rosh Chodesh, Chanukah, a fast, Chol HaMoed, the Ten Days of Repentance,
             summer/winter, the Omer… and sdDeriveFlags() turns that into what the prayer needs:
             Tachanun or not, which Hallel, Musaf, Avinu Malkeinu, LaMenatzeach, and so on.
   2. TEXT — the prayer text is loaded live from Sefaria, per nusach. Every nusach is described
             below (SIDDUR_NUSACHOT) as an ordered list of groups; each group picks its pieces
             out of Sefaria's table of contents by English title, and says WHEN it is said.
   3. LINES — inside a text, the printed instructions ("בקיץ:", "בעשי"ת:", "בחנוכה:", …) are
             recognised and decide which lines are said today. Anything not recognised is
             simply shown, so nothing is lost; "נוסח מלא" shows every line regardless.

   The person can always correct the automatic choice by hand (checkboxes on the page). */

/* =====================================================================
   1. HEBREW CALENDAR — facts about a civil date
   ===================================================================== */
const SD_DAY_MS = 86400000;
let _sdHebFmt = null;
function sdHebFmt(){
  if(!_sdHebFmt) _sdHebFmt = new Intl.DateTimeFormat('en-u-ca-hebrew', {timeZone:'UTC', day:'numeric', month:'long', year:'numeric'});
  return _sdHebFmt;
}
// Month names differ slightly between browsers ("Tishri"/"Tishrei"…) — normalised to one set.
function sdMonthKey(name){
  const n = String(name || '').trim();
  if(/^Adar\s*(II|2)$/i.test(n)) return 'Adar II';
  if(/^Adar\s*(I|1)$/i.test(n)) return 'Adar I';
  if(/^Adar/i.test(n)) return 'Adar';
  if(/^Tish/i.test(n)) return 'Tishri';
  if(/^(Hesh|Chesh|Hes|Ches|Mar)/i.test(n)) return 'Heshvan';
  if(/^Kis/i.test(n)) return 'Kislev';
  if(/^Tev/i.test(n)) return 'Tevet';
  if(/^She/i.test(n)) return 'Shevat';
  if(/^Nis/i.test(n)) return 'Nisan';
  if(/^Iy/i.test(n)) return 'Iyar';
  if(/^Siv/i.test(n)) return 'Sivan';
  if(/^Tam/i.test(n)) return 'Tamuz';
  if(/^Av/i.test(n)) return 'Av';
  if(/^Elul/i.test(n)) return 'Elul';
  return n;
}
// Hebrew day / month / year of the civil date whose UTC-noon instant is `ms`.
function sdHeb(ms){
  const p = {};
  sdHebFmt().formatToParts(new Date(ms)).forEach(x => { p[x.type] = x.value; });
  return { d: parseInt(p.day, 10), m: sdMonthKey(p.month), y: parseInt(String(p.year).replace(/\D/g, ''), 10) };
}
function sdIsLeap(y){ return ((7 * y + 1) % 19) < 7; }
function sdNoonOf(date){ return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12); }
function sdGregLeap(y){ return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }

// Everything the calendar says about one civil date (given as its UTC-noon ms).
// loc: { isIsrael, inJerusalem }
function sdComputeFacts(ms, loc){
  loc = loc || {};
  const isIsrael = loc.isIsrael !== false;
  const inJerusalem = !!loc.inJerusalem;
  const civ = new Date(ms);
  const dow = civ.getUTCDay();
  const H = sdHeb(ms);
  const leap = sdIsLeap(H.y);
  const m = H.m, d = H.d;
  const purimMonth = leap ? 'Adar II' : 'Adar';
  const f = {
    ms, dow, hd: d, hm: m, hy: H.y, leap, isIsrael, inJerusalem,
    civY: civ.getUTCFullYear(), civM: civ.getUTCMonth(), civD: civ.getUTCDate()
  };

  // Rosh Chodesh: the 30th, or the 1st (not 1 Tishrei, which is Rosh Hashana)
  f.rc = d === 30 || (d === 1 && m !== 'Tishri');

  // Chanukah: eight days from 25 Kislev
  f.chanukah = false; f.chanukahDay = 0;
  for(let k = 0; k < 8; k++){
    const h = k === 0 ? H : sdHeb(ms - k * SD_DAY_MS);
    if(h.m === 'Kislev' && h.d === 25){ f.chanukah = true; f.chanukahDay = k + 1; break; }
  }

  // Purim: 14 Adar (Adar II in a leap year); Jerusalem reads on 15. No Tachanun on both days anywhere.
  f.purim = m === purimMonth && d === (inJerusalem ? 15 : 14);
  f.purimAny = m === purimMonth && (d === 14 || d === 15);
  f.purimKatan = leap && m === 'Adar I' && (d === 14 || d === 15);

  // Festivals (Israel: one day of Yom Tov; Diaspora: two)
  f.pesach = m === 'Nisan' && d >= 15 && d <= (isIsrael ? 21 : 22);
  f.sukkot = m === 'Tishri' && d >= 15 && d <= 21;
  f.shavuot = m === 'Sivan' && (d === 6 || (!isIsrael && d === 7));
  f.shmini = m === 'Tishri' && (d === 22 || (!isIsrael && d === 23));
  f.rh = m === 'Tishri' && (d === 1 || d === 2);
  f.yk = m === 'Tishri' && d === 10;
  const ytDays = isIsrael
    ? { Nisan:[15,21], Sivan:[6], Tishri:[1,2,10,15,22] }
    : { Nisan:[15,16,21,22], Sivan:[6,7], Tishri:[1,2,10,15,16,22,23] };
  f.yomTov = !!(ytDays[m] && ytDays[m].indexOf(d) !== -1);
  f.chm = (f.pesach || f.sukkot) && !f.yomTov;
  f.chmKind = f.chm ? (f.pesach ? 'pesach' : 'sukkot') : null;
  f.hoshanaRaba = m === 'Tishri' && d === 21;
  f.sukkotDay = f.sukkot ? d - 14 : 0;

  // Public fasts (a fast that falls on Shabbat moves: Gedalia/17 Tamuz/9 Av to Sunday, Esther to Thursday)
  f.fastKind = null;
  if(m === 'Tishri' && ((d === 3 && dow !== 6) || (d === 4 && dow === 0))) f.fastKind = 'gedalia';
  else if(m === 'Tevet' && d === 10) f.fastKind = 'tevet';
  else if(m === purimMonth && ((d === 13 && dow !== 6) || (d === 11 && dow === 4))) f.fastKind = 'esther';
  else if(m === 'Tamuz' && ((d === 17 && dow !== 6) || (d === 18 && dow === 0))) f.fastKind = 'tamuz';
  else if(m === 'Av' && ((d === 9 && dow !== 6) || (d === 10 && dow === 0))) f.fastKind = 'av9';
  f.fast = !!f.fastKind;
  f.av9 = f.fastKind === 'av9';

  f.ayt = m === 'Tishri' && d >= 1 && d <= 10;           // Ten Days of Repentance
  f.elul27 = m === 'Elul' || (m === 'Tishri' && d <= 22); // "לדוד ה׳ אורי" from 1 Elul to Shmini Atzeret
  f.erevPesach = m === 'Nisan' && d === 14;
  f.erevYK = m === 'Tishri' && d === 9;
  f.erevRH = m === 'Elul' && d === 29;
  f.pesachSheni = m === 'Iyar' && d === 14;
  f.lagBaomer = m === 'Iyar' && d === 18;
  f.tuBishvat = m === 'Shevat' && d === 15;
  f.tuBeav = m === 'Av' && d === 15;

  // Yom HaAtzmaut (5 Iyar, moved off Friday/Shabbat to Thursday and off Monday to Tuesday) and Yom Yerushalayim
  f.yomHaatzmaut = false; f.yomYerushalayim = false;
  if(m === 'Iyar' && isIsrael){
    const dow5 = (((dow + (5 - d)) % 7) + 7) % 7;
    const actual = dow5 === 5 ? 4 : dow5 === 6 ? 3 : dow5 === 1 ? 6 : 5;
    f.yomHaatzmaut = d === actual;
    f.yomYerushalayim = d === 28;
  }

  // Summer / winter: "משיב הרוח" from Shmini Atzeret to the first day of Pesach
  const winterMonths = ['Heshvan','Kislev','Tevet','Shevat','Adar I','Adar II','Adar'];
  f.mashiv = (m === 'Tishri' && d >= 22) || winterMonths.indexOf(m) !== -1 || (m === 'Nisan' && d <= 14);
  // "ותן טל ומטר": Israel from 7 Cheshvan; Diaspora from 4/5 December (evening) — until Pesach
  if(isIsrael){
    f.talUmatar = (m === 'Heshvan' && d >= 7) || ['Kislev','Tevet','Shevat','Adar I','Adar II','Adar'].indexOf(m) !== -1 || (m === 'Nisan' && d <= 14);
  }else{
    const start = sdGregLeap(f.civY + 1) ? 6 : 5;
    if(f.civM === 11) f.talUmatar = f.civD >= start;
    else if(f.civM <= 4) f.talUmatar = ['Tevet','Shevat','Adar I','Adar II','Adar'].indexOf(m) !== -1 || (m === 'Nisan' && d <= 14) || m === 'Kislev';
    else f.talUmatar = false;
  }

  // Sefirat HaOmer: 16 Nisan = day 1 … 5 Sivan = day 49
  f.omerDay = 0;
  if(m === 'Nisan' && d >= 16) f.omerDay = d - 15;
  else if(m === 'Iyar') f.omerDay = 15 + d;
  else if(m === 'Sivan' && d <= 5) f.omerDay = 44 + d;

  return f;
}

// Why Tachanun is not said on this day (empty array = it is said).
function sdNoTachanunReasons(f){
  const r = [];
  if(f.dow === 6) r.push('shabbat');
  if(f.yomTov) r.push('yomTov');
  if(f.rh) r.push('rh');
  if(f.rc) r.push('rc');
  if(f.hm === 'Nisan') r.push('nisan');
  if(f.chm) r.push('chm');
  if(f.chanukah) r.push('chanukah');
  if(f.purimAny || f.purimKatan) r.push('purim');
  if(f.pesachSheni) r.push('pesachSheni');
  if(f.lagBaomer) r.push('lagBaomer');
  if(f.hm === 'Sivan' && f.hd <= 12) r.push('sivan');
  if(f.av9) r.push('av9');
  if(f.tuBeav) r.push('tuBeav');
  if(f.tuBishvat) r.push('tuBishvat');
  if(f.erevRH) r.push('erevRH');
  if(f.hm === 'Tishri' && f.hd >= 9) r.push('tishri');
  if(f.yomHaatzmaut) r.push('yomHaatzmaut');
  if(f.yomYerushalayim) r.push('yomYerushalayim');
  return r;
}
// Days whose eve already drops Tachanun at Mincha.
const SD_FESTIVE_EVE = ['shabbat','yomTov','rh','chanukah','purim','pesachSheni','lagBaomer','av9','tuBeav','tuBishvat','yomHaatzmaut','yomYerushalayim'];

/* What the prayer needs, from the facts (after any manual overrides). `nusach` and `prayer`
   ('shacharit' | 'mincha' | 'maariv') fine-tune a few customs. */
function sdDeriveFlags(f, nusach, prayer){
  const g = Object.assign({}, f);
  g.prayer = prayer;
  g.nusach = nusach;
  const reasons = sdNoTachanunReasons(f);
  if(f.tachanunOverride === true || f.tachanunOverride === false){
    g.tachanun = f.tachanunOverride;
    g.tachanunMincha = f.tachanunOverride;
  }else{
    g.tachanun = reasons.length === 0;
    let minchaOk = g.tachanun && f.dow !== 5;
    if(minchaOk && f.tomorrow){
      const tr = sdNoTachanunReasons(f.tomorrow);
      if(tr.some(x => SD_FESTIVE_EVE.indexOf(x) !== -1)) minchaOk = false;
    }
    g.tachanunMincha = minchaOk;
  }
  g.monThu = f.dow === 1 || f.dow === 4;
  g.nisim = f.chanukah || f.purim;
  const amFasts = nusach !== 'edot' && nusach !== 'baladi';    // Edot HaMizrach, Teiman: Avinu Malkeinu in the Ten Days only
  g.avinuMalkeinu = (f.ayt && !f.erevYK && !f.yomTov && !f.rh && !f.yk) || (amFasts && f.fast && !f.av9);
  g.avinuMalkeinuMincha = g.avinuMalkeinu && f.dow !== 5;
  if(f.hallelOverride) g.hallel = f.hallelOverride;
  else if(f.chanukah || (f.chm && f.chmKind === 'sukkot')) g.hallel = 'full';
  else if(f.rc || (f.chm && f.chmKind === 'pesach')) g.hallel = 'half';
  else if(f.isIsrael && (f.yomHaatzmaut || f.yomYerushalayim)) g.hallel = 'full';
  else g.hallel = 'none';
  g.musaf = f.rc || f.chm;
  g.lamenatzeach = !(f.rc || f.chanukah || f.purimAny || f.chm || f.erevPesach || f.erevYK || f.av9 || f.yomHaatzmaut || f.yomYerushalayim || f.yomTov);
  g.mizmorLetoda = !(f.pesach || f.erevPesach || f.erevYK || f.yomTov);
  g.torahReading = g.monThu || f.rc || f.chanukah || f.purim || f.fast || f.chm;
  g.torahReadingMincha = f.fast;
  g.barchiNafshi = f.rc;
  g.hoshanot = f.chm && f.chmKind === 'sukkot';
  g.motzash = prayer === 'maariv' && f.dow === 0;
  const levanaFrom = nusach === 'ashkenaz' ? 3 : 7;
  g.levana = f.hd >= levanaFrom && f.hd <= 15 && !(f.hm === 'Tishri' && f.hd <= 10) && !(f.hm === 'Av' && f.hd <= 9);
  g.selichotFast = f.fast && !f.av9;
  return g;
}

/* Human-readable list of what changes in a given prayer (used on the pages and the hub). */
function sdDescribe(g, prayer){
  const out = [];
  const isShach = prayer === 'shacharit', isMin = prayer === 'mincha', isMaariv = prayer === 'maariv';
  if(g.ayt) out.push('עשרת ימי תשובה — זכרנו, המלך הקדוש, המלך המשפט');
  if(g.rc || g.chm) out.push('יעלה ויבוא');
  if(g.chanukah) out.push('על הניסים (חנוכה)');
  if(g.purim) out.push('על הניסים (פורים)');
  if(g.fast && (isMin || (isShach && g.nusach !== 'ashkenaz'))) out.push('עננו');
  if(g.av9 && isMin) out.push('נחם');
  if(g.motzash && isMaariv) out.push('אתה חוננתנו · ויהי נועם');
  out.push(g.mashiv ? 'משיב הרוח ומוריד הגשם' : 'מוריד הטל');
  out.push(g.talUmatar ? 'ותן טל ומטר לברכה' : 'ותן ברכה');
  if(isShach && g.hallel === 'full') out.push('הלל שלם');
  if(isShach && g.hallel === 'half') out.push('חצי הלל');
  if(isShach && g.hoshanot) out.push('נטילת לולב והושענות');
  if(isShach && g.musaf) out.push(g.rc ? 'מוסף לראש חודש' : 'מוסף לחול המועד');
  if(isShach && g.avinuMalkeinu) out.push('אבינו מלכנו');
  if(isMin && g.avinuMalkeinuMincha) out.push('אבינו מלכנו');
  if(isShach) out.push(g.tachanun ? (g.monThu ? 'תחנון (ארוך — שני וחמישי)' : 'תחנון') : 'אין אומרים תחנון');
  if(isMin) out.push(g.tachanunMincha ? 'תחנון' : 'אין אומרים תחנון');
  if(isShach && g.torahReading) out.push('קריאת התורה');
  if(isMin && g.torahReadingMincha) out.push('קריאת התורה (תענית)');
  if(isShach && !g.lamenatzeach) out.push('אין אומרים למנצח');
  if(isShach && !g.mizmorLetoda) out.push('אין אומרים מזמור לתודה');
  if(isShach && g.barchiNafshi) out.push('ברכי נפשי');
  if((isShach || isMaariv) && g.elul27) out.push('לדוד ה׳ אורי');
  if(isMaariv && g.omerDay) out.push('ספירת העומר — יום ' + g.omerDay);
  if(isMaariv && g.levana) out.push('אפשר לקדש את הלבנה');
  return out;
}

/* The special days, as short labels (for the status line). */
function sdDayLabels(g){
  const out = [];
  if(g.rc) out.push('ראש חודש');
  if(g.chanukah) out.push('חנוכה — נר ' + hebNum(g.chanukahDay));
  if(g.purim) out.push(g.inJerusalem ? 'שושן פורים' : 'פורים');
  else if(g.purimAny) out.push(g.hd === 15 ? 'שושן פורים' : 'פורים');
  if(g.purimKatan) out.push('פורים קטן');
  if(g.chm) out.push(g.chmKind === 'pesach' ? 'חול המועד פסח' : (g.hoshanaRaba ? 'הושענא רבה' : 'חול המועד סוכות'));
  if(g.yomTov) out.push('יום טוב');
  const FAST = { gedalia:'צום גדליה', tevet:'עשרה בטבת', esther:'תענית אסתר', tamuz:'שבעה עשר בתמוז', av9:'תשעה באב' };
  if(g.fastKind) out.push(FAST[g.fastKind]);
  if(g.ayt && !g.rh && !g.yk) out.push('עשרת ימי תשובה');
  if(g.erevYK) out.push('ערב יום כיפור');
  if(g.erevPesach) out.push('ערב פסח');
  if(g.lagBaomer) out.push('ל״ג בעומר');
  if(g.pesachSheni) out.push('פסח שני');
  if(g.tuBishvat) out.push('ט״ו בשבט');
  if(g.tuBeav) out.push('ט״ו באב');
  if(g.yomHaatzmaut) out.push('יום העצמאות');
  if(g.yomYerushalayim) out.push('יום ירושלים');
  if(g.omerDay) out.push('ספירת העומר: ' + g.omerDay);
  return out;
}

/* =====================================================================
   2. THE NUSACHOT — which Sefaria pieces make up each prayer, in order
   Each group: { he, match: RegExp on the path inside the book, when?: g => true|false|'optional',
                 note?, special?: 'hallel'|'songOfDay'|'omer', leaves?: [{ match, when, note, special }] }
   'optional' = shown folded (opened by a click) — for things whose custom varies.
   ===================================================================== */
const SD_ALWAYS = () => true;
const SD_OPTIONAL = () => 'optional';

const SIDDUR_NUSACHOT = {
  ashkenaz: {
    local: 'data-siddur-ashkenaz.json', book: 'Siddur Ashkenaz', he: 'נוסח אשכנז', page: 'siddur-ashkenaz.html',
    prayers: {
      shacharit: [
        { he: 'השכמת הבוקר וברכות השחר', match: /^Weekday, Shacharit, Preparatory Prayers, (?!Korbanot)/ },
        { he: 'קרבנות', match: /^Weekday, Shacharit, Preparatory Prayers, Korbanot/ },
        { he: 'פסוקי דזמרה', match: /^Weekday, Shacharit, Pesukei Dezimra/, leaves: [
          { match: /Mizmor Letoda/i, when: g => g.mizmorLetoda },
          { match: /Psalm 130/, when: g => g.ayt }
        ]},
        { he: 'קריאת שמע וברכותיה', match: /^Weekday, Shacharit, Blessings of the Shema/ },
        { he: 'תפילת העמידה', match: /^Weekday, Shacharit, Amidah/ },
        { he: 'נטילת לולב', match: /^Festivals, Sukkot, Blessing on Lulav/, when: g => g.hoshanot && g.dow !== 6 },
        { he: 'הלל', match: /^Festivals, Rosh Chodesh, Hallel/, when: g => g.hallel !== 'none', special: 'hallel' },
        { he: 'סליחות לתענית ציבור', match: g => SD_FAST_SELICHOT_ASHK[g.fastKind] || null, when: g => g.selichotFast ? 'optional' : false },
        { he: 'אחר העמידה — אבינו מלכנו ותחנון', match: /^Weekday, Shacharit, Post Amidah/, leaves: [
          { match: /Vidui/i, when: SD_OPTIONAL, note: 'נאמר בעיקר בימי תענית ובעשרת ימי תשובה' },
          { match: /Avinu Malk/i, when: g => g.avinuMalkeinu },
          { match: /(Half Kaddish|Kaddish)$/i, when: SD_ALWAYS },
          { match: /(V'?hu Rachum|Vehu Rachum|For Monday|God of Israel|Elokei Yisrael)/i, when: g => g.tachanun && g.monThu },
          { match: /Tachanun/i, when: g => g.tachanun }
        ]},
        { he: 'קריאת התורה', match: /^Weekday, Shacharit, (Keriat Hatorah|Torah Reading)/i, when: g => g.torahReading },
        { he: 'אשרי, למנצח ובא לציון', match: /^Weekday, Shacharit, Concluding Prayers, (Ashrei|Lamenatze|Uva Letzion)/, leaves: [
          { match: /Lamenatze/, when: g => g.lamenatzeach }
        ]},
        { he: 'תפילת מוסף לראש חודש', match: /^Festivals, Rosh Chodesh, Musaf/, when: g => g.rc && !g.chm },
        { he: 'תפילת מוסף לחול המועד', match: /^Festivals, Shalosh Regalim, Mussaf/, when: g => g.chm },
        { he: 'הושענות', match: g => g.sukkotDay ? new RegExp("^Festivals, Sukkot, Hosha'anot, " + SD_HOSHANOT_ASHK[g.hoshanaRaba ? 7 : g.sukkotDay]) : null, when: g => g.hoshanot ? 'optional' : false },
        { he: 'סיום התפילה', match: /^Weekday, Shacharit, Concluding Prayers, (?!Ashrei|Lamenatze|Uva Letzion)/, leaves: [
          { match: /Song of the Day|Shir shel Yom/i, special: 'songOfDay' },
          { match: /Barchi Nafshi/i, when: g => g.barchiNafshi },
          { match: /LeDavid|L'David/i, when: g => g.elul27 },
          { match: /Korbanot \(Israel\)/i, when: g => g.isIsrael ? true : 'optional', note: 'מנהג ארץ ישראל' }
        ]},
        { he: 'תפילות נוספות', match: /^Weekday, Shacharit, Post Service/, when: SD_OPTIONAL, note: 'שש זכירות, עשרת הדברות, י״ג עיקרים' }
      ],
      mincha: [
        { he: 'אשרי', match: /^Weekday, Minch?ah?, Ashrei/ },
        { he: 'תפילת העמידה', match: /^Weekday, Minch?ah?, Amid/ },
        { he: 'אחר העמידה — אבינו מלכנו ותחנון', match: /^Weekday, Minch?ah?, Post Amidah/, leaves: [
          { match: /Vidui/i, when: SD_OPTIONAL, note: 'נאמר בעיקר בימי תענית ובעשרת ימי תשובה' },
          { match: /Avinu Malk/i, when: g => g.avinuMalkeinuMincha },
          { match: /Kaddish/i, when: SD_ALWAYS },
          { match: /Tachanun/i, when: g => g.tachanunMincha }
        ]},
        { he: 'עלינו לשבח', match: /^Weekday, Minch?ah?, Concluding/ }
      ],
      maariv: [
        { he: 'והוא רחום · ברכו', match: /^Weekday, Maariv, (Vehu Rachum|V'hu Rachum|Barchu)/ },
        { he: 'קריאת שמע וברכותיה', match: /^Weekday, Maariv, Blessings of the Shema/, leaves: [
          { match: /Third Blessing after Shema/i, when: g => !g.isIsrael, note: 'בחוץ לארץ' }
        ]},
        { he: 'תפילת העמידה', match: /^Weekday, Maariv, Amidah/ },
        { he: 'קדיש שלם', match: /^Weekday, Maariv, Kaddish Shalem/ },
        { he: 'תוספות למוצאי שבת', match: /^Weekday, Maariv, Additions for Motza/, when: g => g.motzash },
        { he: 'ספירת העומר', match: /^Weekday, Maariv, Sefirat/, when: g => g.omerDay > 0, special: 'omer' },
        { he: 'עלינו לשבח', match: /^Weekday, Maariv, (Alenu|Aleinu|Mourner)/ },
        { he: 'לדוד ה׳ אורי', match: /^Weekday, Maariv, (LeDavid|L'David)/, when: g => g.elul27 },
        { he: 'קידוש לבנה', match: /^Weekday, Maariv, Birkat HaLevana/, when: g => g.levana ? 'optional' : false },
        { he: 'קריאת שמע על המיטה', match: /^Weekday, Maariv, Keri'at Shema/, when: SD_OPTIONAL }
      ]
    }
  },

  sefard: {
    local: 'data-siddur-sefard.json', book: 'Siddur Sefard', he: 'נוסח ספרד', page: 'siddur-sefard.html',
    prayers: {
      shacharit: [
        { he: 'השכמת הבוקר', match: /^Upon Arising, / },
        { he: 'ברכות השחר', match: /^Weekday Shacharit, (Morning Blessings|Blessings on Torah|Morning Prayer)/ },
        { he: 'קרבנות', match: /^Weekday Shacharit, (Korbanot|B'raita)/ },
        { he: 'פסוקי דזמרה', match: /^Weekday Shacharit, (Hodu|Yishtabach)/ },
        { he: 'קריאת שמע וברכותיה', match: /^Weekday Shacharit, The Shema/ },
        { he: 'תפילת העמידה', match: /^Weekday Shacharit, Amid/ },
        { he: 'נטילת לולב', match: /^Shaking Lulav/, when: g => g.hoshanot && g.dow !== 6 },
        { he: 'הלל', match: /^Rosh Chodesh, Hallel/, when: g => g.hallel !== 'none', special: 'hallel' },
        { he: 'סליחות לתענית ציבור', match: g => SD_FAST_SELICHOT_SEFARD[g.fastKind] || null, when: g => g.selichotFast ? 'optional' : false },
        { he: 'תחנון', match: /^Weekday Shacharit, Tachanun/, when: g => g.tachanun },
        { he: 'אבינו מלכנו', match: /^Weekday Shacharit, Avinu Malk/, when: g => g.avinuMalkeinu },
        { he: 'תחנון לשני וחמישי', match: /^Weekday Shacharit, For Monday/, when: g => g.tachanun && g.monThu },
        { he: 'סדר ראש חודש', match: /^Rosh Chodesh, (?!Hallel)/, when: g => g.rc, leaves: [
          { match: /Song of the Day/i, special: 'songOfDay' }
        ]},
        { he: 'קריאת התורה', match: /^Weekday Shacharit, Torah Reading/, when: g => g.torahReading && !g.rc },
        { he: 'אשרי ובא לציון', match: /^Weekday Shacharit, Ashrei/, when: g => !g.rc },
        { he: 'תפילת מוסף לחול המועד', match: /^Holidays, Yom Tov Musaf/, when: g => g.chm },
        { he: 'הושענות', match: g => g.hoshanaRaba ? /^Sukkot, Hoshana Rabba/ : /^Sukkot, (Order of Hoshanot|First Day & Chol HaMoed)/, when: g => g.hoshanot ? 'optional' : false },
        { he: 'סיום התפילה', match: /^Weekday Shacharit, (Beit Yaakov|Song of the Day|Barchi Nafshi|L'David|Kaveh|Aleinu)/, leaves: [
          { match: /Song of the Day/i, special: 'songOfDay', when: g => !g.rc },
          { match: /Barchi Nafshi/i, when: g => g.barchiNafshi && !g.rc },
          { match: /L'David/i, when: g => g.elul27 }
        ]},
        { he: 'תפילות נוספות', match: /^Additional Prayers/, when: SD_OPTIONAL, note: 'שש זכירות, י״ג עיקרים, פרשת המן ועוד' }
      ],
      mincha: [
        { he: 'קרבנות ואשרי', match: /^Weekday Mincha, Korbanot/ },
        { he: 'קריאת התורה לתענית', match: /^Weekday Mincha, Torah Reading/, when: g => g.torahReadingMincha },
        { he: 'תפילת העמידה', match: /^Weekday Mincha, Amid/ },
        { he: 'תחנון', match: /^Weekday Mincha, Tachanun/, when: g => g.tachanunMincha },
        { he: 'אבינו מלכנו', match: /^Weekday Mincha, Avinu Malk/, when: g => g.avinuMalkeinuMincha }
      ],
      maariv: [
        { he: 'קריאת שמע וברכותיה', match: /^Weekday Maariv, The Shema/ },
        { he: 'תפילת העמידה', match: /^Weekday Maariv, Amid/ },
        { he: 'תוספות למוצאי שבת', match: /^Weekday Maariv, Motzaei Shabbat/, when: g => g.motzash },
        { he: 'ספירת העומר', match: /^Weekday Maariv, Sefirat/, when: g => g.omerDay > 0, special: 'omer' },
        { he: 'קידוש לבנה', match: /^Kiddush Levanah/, when: g => g.levana ? 'optional' : false },
        { he: 'קריאת שמע על המיטה', match: /^Bedtime Shema/, when: SD_OPTIONAL }
      ]
    }
  },

  edot: {
    local: 'data-siddur-edot.json', book: 'Siddur Edot HaMizrach', he: 'נוסח עדות המזרח', page: 'siddur-edot-hamizrach.html',
    prayers: {
      shacharit: [
        { he: 'השכמת הבוקר וברכות השחר', match: /^Preparatory Prayers, / },
        { he: 'פתיחת אליהו, טלית ותפילין', match: /^Weekday Shacharit, (Petichat|Order of)/ },
        { he: 'סדר ברכות השחר וקטורת', match: /^Weekday Shacharit, (Hanna|Morning Prayer|Incense)/ },
        { he: 'הודו ופסוקי דזמרה', match: /^Weekday Shacharit, (Hodu|Pesukei)/ },
        { he: 'קריאת שמע וברכותיה', match: /^Weekday Shacharit, The Shema/ },
        { he: 'תפילת העמידה', match: /^Weekday Shacharit, Amid/ },
        { he: 'הלל — חנוכה', match: /^Hanukkah, Shacharit/, when: g => g.chanukah },
        { he: 'הלל', match: /^Rosh Hodesh, Hallel/, when: g => g.hallel !== 'none' && !g.chanukah, special: 'hallel' },
        { he: 'וידוי ותחנון', match: /^Weekday Shacharit, Vidui/, when: g => g.tachanun },
        { he: 'סדר התענית', match: g => SD_FAST_EDOT[g.fastKind] || null, when: g => g.fast ? 'optional' : false },
        { he: 'ספר תורה', match: /^Weekday Shacharit, Torah Reading/, when: g => g.torahReading },
        { he: 'אשרי', match: /^Weekday Shacharit, Ashrei/ },
        { he: 'ובא לציון', match: /^Weekday Shacharit, Uva/, when: g => !g.rc },
        { he: 'סדר ראש חודש — ובא לציון, מוסף וסיום', match: /^Rosh Hodesh, (Uva|Song|Mussaf|Barchi|Kaveh|Incense|Alenu)/, when: g => g.rc, leaves: [
          { match: /Song of the Day/i, special: 'songOfDay' }
        ]},
        { he: 'תפילת מוסף לחול המועד', match: /^Prayers for Three Festivals, Mussaf/, when: g => g.chm },
        { he: 'שיר של יום וסיום התפילה', match: /^Weekday Shacharit, (Beit Yaakov|Song of the Day|Kaveh|Alenu)/, when: g => !g.rc, leaves: [
          { match: /Song of the Day/i, special: 'songOfDay' }
        ]},
        { he: 'תוספות לתפילת שחרית', match: /^Additions for Shacharit/, when: SD_OPTIONAL, note: 'י״ג עיקרים, עשר זכירות' }
      ],
      mincha: [
        { he: 'קרבנות ואשרי', match: /^Weekday Mincha, Offerings/ },
        { he: 'קריאת התורה לתענית', match: /^Fast Days and Mourning, Torah Reading for Fast/, when: g => g.torahReadingMincha ? 'optional' : false },
        { he: 'תפילת העמידה', match: /^Weekday Mincha, Amid/ },
        { he: 'וידוי ותחנון', match: /^Weekday Mincha, Vidui/, when: g => g.tachanunMincha },
        { he: 'עלינו לשבח', match: /^Weekday Mincha, Alenu/ }
      ],
      maariv: [
        { he: 'ברכו · קריאת שמע וברכותיה', match: /^Weekday Arvit, (Barchu|The Shema)/ },
        { he: 'תפילת העמידה', match: /^Weekday Arvit, Amid/ },
        { he: 'ספירת העומר', match: /^Counting of the Omer/, when: g => g.omerDay > 0, special: 'omer' },
        { he: 'עלינו לשבח', match: /^Weekday Arvit, Alenu/ },
        { he: 'ויתן לך — למוצאי שבת', match: /^Havdalah, Veyiten/, when: g => g.motzash ? 'optional' : false },
        { he: 'ברכת הלבנה', match: /^Blessing of the Moon/, when: g => g.levana ? 'optional' : false },
        { he: 'קריאת שמע על המיטה', match: /^Bedtime Shema/, when: SD_OPTIONAL }
      ]
    }
  },

  // Yemenite (Baladi) — from Hebrew Wikisource, kept on the site (data-siddur-baladi.json, refreshed weekly).
  // The day-dependent parts are marked explicitly in the data (see .github/scripts/siddur_baladi.py), and the
  // prayer is built from the sections of the data itself, so new sections on Wikisource appear by themselves.
  baladi: {
    book: 'local:baladi', data: 'data-siddur-baladi.json', explicit: true, auto: true,
    he: 'נוסח תימן (בלדי)', page: 'siddur-teiman-baladi.html',
    sourceName: 'ויקיטקסט', sourceUrl: 'https://he.wikisource.org/wiki/%D7%A1%D7%99%D7%93%D7%95%D7%A8/%D7%A0%D7%95%D7%A1%D7%97_%D7%AA%D7%99%D7%9E%D7%9F_%D7%91%D7%9C%D7%93%D7%99',
    prayerOf: { 'שחרית': 'shacharit', 'מנחה': 'mincha', 'ערבית': 'maariv', 'קריאת שמע על המיטה': 'maariv' },
    rules: [   // by section name (or a piece inside it)
      { match: /נפילת אפים|תחנון|וידוי/, when: g => g.prayer === 'mincha' ? g.tachanunMincha : g.tachanun },
      { match: /הלל/, when: g => g.hallel !== 'none', special: 'hallel' },
      { match: /מוסף/, when: g => g.musaf },
      { match: /ספירת העומר/, when: g => g.omerDay > 0, special: 'omer' },
      { match: /קריאת שמע על המיטה/, when: SD_OPTIONAL },
      { match: /ברכת הלבנה|קידוש לבנה/, when: g => g.levana ? 'optional' : false }
    ],
    leafRules: [
      { match: /מזמור לתודה/, when: g => g.mizmorLetoda }
    ],
    prayers: null
  },

  chabad: {
    local: 'data-siddur-chabad.json', book: 'Weekday Siddur Chabad', he: 'נוסח חב״ד (האר״י)', page: 'siddur-chabad.html',
    prayers: {
      shacharit: [
        { he: 'השכמת הבוקר וברכות השחר', match: /^Shacharit, (Upon Arising|Morning Blessings)/ },
        { he: 'ציצית, טלית ותפילין', match: /^Shacharit, (Tzitzit|Tefillin)/ },
        { he: 'סדר התפילה וקרבנות', match: /^Shacharit, (Morning Prayer|Kaddish DeRabbanan)/ },
        { he: 'הודו ופסוקי דזמרה', match: /^Shacharit, (Hodu|Pesukei)/ },
        { he: 'קריאת שמע וברכותיה', match: /^Shacharit, Blessings of the Shema/ },
        { he: 'תפילת העמידה', match: /^Shacharit, (The )?Amid/ },
        { he: 'נטילת לולב', match: /^Lulav$/, when: g => g.hoshanot && g.dow !== 6 },
        { he: 'הלל', match: /^Hallel$/, when: g => g.hallel !== 'none', special: 'hallel' },
        { he: 'תחנון', match: /^Shacharit, Tach/, when: g => g.tachanun || g.avinuMalkeinu, note: '' },
        { he: 'קריאת התורה', match: /^Shacharit, Torah Reading/, when: g => g.torahReading },
        { he: 'אשרי ובא לציון', match: /^Shacharit, Ashrei/ },
        { he: 'ראש חודש — מוסף', match: /^Rosh Chodesh$/, when: g => g.rc },
        { he: 'תפילת מוסף לחול המועד', match: /^Musaf for Festivals$/, when: g => g.chm },
        { he: 'שיר של יום וסיום התפילה', match: /^Shacharit, (Song of the Day|Mourner's Kaddish|Kaveh|Aleinu)/, leaves: [
          { match: /Song of the Day/i, special: 'songOfDay' }
        ]},
        { he: 'תפילין דרבנו תם ושש זכירות', match: /^Shacharit, (Rabbenu Tam|Six Remembrances)/, when: SD_OPTIONAL }
      ],
      mincha: [
        { he: 'קרבנות ואשרי', match: /^Mincha, (Korbanot|Ashrei)/ },
        { he: 'תפילת העמידה', match: /^Mincha, Amid/ },
        { he: 'תחנון', match: /^Mincha, Tach/, when: g => g.tachanunMincha || g.avinuMalkeinuMincha },
        { he: 'עלינו לשבח', match: /^Mincha, Aleinu/ }
      ],
      maariv: [
        { he: 'תפילת ערבית', match: /^Maariv$/ },
        { he: 'ספירת העומר', match: /^Sefirat HaOmer$/, when: g => g.omerDay > 0, special: 'omer' },
        { he: 'קידוש לבנה', match: /^Kiddush Levanah$/, when: g => g.levana ? 'optional' : false },
        { he: 'קריאת שמע על המיטה', match: /^Bedtime Shema$/, when: SD_OPTIONAL }
      ]
    }
  }
};
const SD_FAST_SELICHOT_ASHK = { gedalia: /^Festivals, Selichot, Fast of Gedal/, tevet: /^Festivals, Selichot, Ten of Tevet/, esther: /^Festivals, Selichot, Fast of Esther/, tamuz: /^Festivals, Selichot, Seventeen of Tamm?uz/ };
const SD_FAST_SELICHOT_SEFARD = { tevet: /^Fast Days, Selichot for Asara/, esther: /^Fast Days, Selichot for Taanit Esther/, tamuz: /^Fast Days, Selichot for 17 Tamm?uz/ };
const SD_FAST_EDOT = { gedalia: /^Fast Days and Mourning, Fast of Gedal/, tevet: /^Fast Days and Mourning, Tenth of Tevet/, esther: /^Fast Days and Mourning, Fast of Esther/, tamuz: /^Fast Days and Mourning, Seventeenth of Tamm?uz/ };
const SD_HOSHANOT_ASHK = ['', 'First Day', 'Second Day', 'Third Day', 'Fourth Day', 'Fifth Day', 'Sixth Day', "Hosha'ana Rabba"];

const SD_PRAYER_HE = { shacharit: 'שחרית', mincha: 'מנחה', maariv: 'ערבית' };

/* =====================================================================
   3. LOADING FROM SEFARIA
   ===================================================================== */
const SD_API = 'https://www.sefaria.org';
function sdStore(key, value){
  try{
    if(value === undefined){ const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; }
    localStorage.setItem(key, JSON.stringify(value));
  }catch(e){ return null; }
  return null;
}

// The book's table of contents as an ordered list of { path, he, ref } (one per text piece).
// A Sefaria siddur the site keeps a copy of (data-siddur-<key>.json + its chunks, refreshed weekly):
// the same pieces and text as Sefaria; anything missing is still fetched from Sefaria.
const sdLocalChunk = new Map();      // ref -> chunk file
const sdLocalChunkData = new Map();  // chunk file -> Promise<{texts}>
async function sdLoadLocalIndex(N){
  const idx = await fetchSiteJson(N.local);
  if(!idx || !Array.isArray(idx.leaves) || !idx.leaves.length) throw new Error('no local index');
  const base = N.local.replace(/\.json$/, '');
  const prefix = N.book + ', ';
  return idx.leaves.map(l => {
    if(l.c !== undefined) sdLocalChunk.set(l.r, base + '-' + l.c + '.json');
    return { ref: l.r, path: l.p || (l.r.indexOf(prefix) === 0 ? l.r.slice(prefix.length) : l.r), he: l.h || '' };
  });
}
async function sdLocalText(ref){
  const file = sdLocalChunk.get(ref);
  if(!file) return null;
  if(!sdLocalChunkData.has(file)){
    const p = fetchSiteJson(file);
    sdLocalChunkData.set(file, p);
    p.catch(() => sdLocalChunkData.delete(file));
  }
  const d = await sdLocalChunkData.get(file);
  const segs = d && d.texts && d.texts[ref];
  return Array.isArray(segs) && segs.length ? segs : null;
}

// A nusach kept on the site itself: its sections, and their text straight into the text cache.
async function sdLoadLocalBook(N){
  const data = await fetchSiteJson(N.data);
  if(!data || !Array.isArray(data.leaves) || !data.leaves.length) throw new Error('local siddur: no data');
  return data.leaves.map((l, i) => {
    const ref = N.book + '#' + i;
    sdTextCache.set(ref, Promise.resolve(l.s || []));
    return { ref, path: l.p, he: l.h || l.p };
  });
}
// The groups of each prayer, from the sections of a local book: "שחרית, זמירות, ברוך שאמר" → group "זמירות".
function sdAutoPrayers(N, leaves){
  const out = { shacharit: [], mincha: [], maariv: [] };
  const seen = new Set();
  const esc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  leaves.forEach(l => {
    const parts = l.path.split(/,\s*/);
    const pr = N.prayerOf[parts[0]];
    if(!pr) return;
    const own = parts[0] === 'קריאת שמע על המיטה';
    const key = own ? parts[0] : parts[0] + ', ' + (parts[1] || '');
    if(seen.has(key)) return;
    seen.add(key);
    const name = own ? parts[0] : (parts[1] || parts[0]);
    const rule = (N.rules || []).find(r => r.match.test(name)) || {};
    out[pr].push({ he: name, match: new RegExp('^' + esc(key) + '(,|$)'), when: rule.when, special: rule.special, leaves: N.leafRules });
  });
  return out;
}

async function sdLoadLeaves(book){
  const cacheKey = 'sd-toc-v1-' + book;
  const cached = sdStore(cacheKey);
  if(cached && cached.t && Date.now() - cached.t < 7 * SD_DAY_MS && Array.isArray(cached.leaves) && cached.leaves.length) return cached.leaves;
  let leaves = null;
  try{
    const res = await fetch(SD_API + '/api/shape/' + encodeURIComponent(book));
    if(!res.ok) throw new Error('shape ' + res.status);
    const data = await res.json();
    const out = [];
    (function walk(node){
      if(Array.isArray(node)){ node.forEach(walk); return; }
      if(!node || typeof node !== 'object') return;
      const ch = node.chapters;
      const nested = Array.isArray(ch) && ch.some(x => x && typeof x === 'object' && !Array.isArray(x));
      if(typeof node.title === 'string' && node.title !== book && !nested){
        out.push({ ref: node.title, he: node.heTitle || '' });
        return;
      }
      if(nested) walk(ch);
    })(data);
    if(out.length) leaves = out;
  }catch(e){ console.warn('siddur: shape failed, trying the index', e); }
  if(!leaves){
    const res = await fetch(SD_API + '/api/v2/raw/index/' + encodeURIComponent(book));
    if(!res.ok) throw new Error('index ' + res.status);
    const data = await res.json();
    const out = [];
    const title = (node, lang) => {
      const t = (node.titles || []).filter(x => x.lang === lang);
      const p = t.find(x => x.primary) || t[0];
      return p ? p.text : (lang === 'en' ? node.key : '');
    };
    (function walk(node, en, he){
      const isDefault = node.default || node.key === 'default';
      const myEn = isDefault ? en : (en ? en + ', ' : '') + title(node, 'en');
      const myHe = isDefault ? he : (he ? he + ', ' : '') + title(node, 'he');
      if(Array.isArray(node.nodes) && node.nodes.length) node.nodes.forEach(n => walk(n, myEn, myHe));
      else out.push({ ref: book + ', ' + myEn, he: myHe });
    })(data.schema || {}, '', '');
    leaves = out;
  }
  const prefix = book + ', ';
  leaves = leaves.map(l => ({ ref: l.ref, path: l.ref.indexOf(prefix) === 0 ? l.ref.slice(prefix.length) : l.ref, he: l.he }));
  sdStore(cacheKey, { t: Date.now(), leaves });
  return leaves;
}

// The Hebrew text of one piece, as an array of HTML segments.
const sdTextCache = new Map();
function sdFlatten(text){
  const out = [];
  (function walk(n){ if(Array.isArray(n)) n.forEach(walk); else if(n != null && n !== '') out.push(String(n)); })(text);
  return out;
}
function sdFetchLeaf(ref){
  if(sdTextCache.has(ref)) return sdTextCache.get(ref);
  const p = sdQueue(async () => {
    let segs = [];
    try{ segs = (await sdLocalText(ref)) || []; }catch(e){ segs = []; }
    if(segs.length) return segs;
    try{
      const res = await fetch(SD_API + '/api/v3/texts/' + encodeURIComponent(ref) + '?version=hebrew');
      if(res.ok){
        const data = await res.json();
        if(data && data.versions && data.versions.length) segs = sdFlatten(data.versions[0].text);
      }
    }catch(e){}
    if(!segs.length){
      const res = await fetch(SD_API + '/api/texts/' + encodeURIComponent(ref) + '?context=0&commentary=0&pad=0');
      if(!res.ok) throw new Error('text ' + res.status);
      const data = await res.json();
      segs = sdFlatten(data && data.he);
    }
    if(!segs.length) throw new Error('empty');
    return segs;
  });
  sdTextCache.set(ref, p);
  p.catch(() => sdTextCache.delete(ref));
  return p;
}
// at most 6 requests at a time (Sefaria is a shared, free service)
const _sdQ = { running: 0, waiting: [] };
function sdQueue(job){
  return new Promise((resolve, reject) => {
    const run = () => {
      _sdQ.running++;
      job().then(resolve, reject).finally(() => {
        _sdQ.running--;
        const next = _sdQ.waiting.shift();
        if(next) next();
      });
    };
    if(_sdQ.running < 6) run(); else _sdQ.waiting.push(run);
  });
}
function sdSefariaUrl(ref){ return SD_API + '/' + encodeURIComponent(ref.replace(/ /g, '_')).replace(/%2C/g, ',') + '?lang=he'; }

/* =====================================================================
   4. READING THE TEXT — instructions, conditions, and which lines are said
   ===================================================================== */
const SD_NIKUD_RE = /[ְ-ׇּׁׂ]/;
const SD_HEB_RE = /[א-ת]/;
function sdEsc(s){ return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
// plain letters only (for matching phrases in the prayer text itself)
function sdPlain(s){
  return String(s || '').replace(/־/g, ' ').replace(/[֑-ׇ]/g, '').replace(/[^א-ת\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
// an instruction, with its abbreviations spelled out
const SD_ABBR = [
  [/ר["״׳']ח/g, 'ראש חודש'], [/חוה["״׳']?מ(["״׳']?ע)?/g, 'חול המועד'], [/עשי["״׳']ת/g, 'עשרת ימי תשובה'],
  [/יו["״׳']ט/g, 'יום טוב'], [/ש["״׳']ץ/g, 'שליח ציבור'], [/מוצ["״׳']ש/g, 'מוצאי שבת'], [/ת["״׳']צ/g, 'תענית ציבור'],
  [/ט["״׳']ב/g, 'תשעה באב'], [/א["״׳']י/g, 'ארץ ישראל'], [/חו["״׳']ל/g, 'חוץ לארץ'], [/שמע["״׳']צ/g, 'שמיני עצרת'],
  [/ר["״׳']ה/g, 'ראש השנה'], [/יוה["״׳']כ/g, 'יום הכיפורים'], [/בה["״׳']ב/g, 'בהב'], [/ס["״׳']ת/g, 'ספר תורה']
];
function sdNormIns(s){
  let t = String(s || '').replace(/־/g, ' ').replace(/[֑-ׇ]/g, '');
  SD_ABBR.forEach(([re, rep]) => { t = t.replace(re, rep); });
  return t.replace(/[^א-ת\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

const SD_WEEKDAY_WORDS = ['ראשון','שני','שלישי','רביעי','חמישי','ששי'];
function sdWeekdayIn(plain){
  const m = /(?:^|\s)[בלה]?יום (ראשון|שני|שלישי|רביעי|חמישי|ששי|שישי)(?=\s|$)/.exec(plain);
  if(!m) return -1;
  return m[1] === 'שישי' ? 5 : SD_WEEKDAY_WORDS.indexOf(m[1]);
}

// conditions that must ALL hold when named (the rest: any one is enough)
const SD_RESTRICTIVE = ['shabbat','israel','diaspora','monThu','shacharit','mincha','maariv'];
const SD_OCCASION_SUB = ['rc','pesach','sukkot','shavuot','shmini','rh','yk'];
const _sdClassCache = new Map();
function sdClassify(norm){
  if(_sdClassCache.has(norm)) return _sdClassCache.get(norm);
  const c = { conds: [], neg: false, note: false, weekday: -1, blockOpen: null, norm };
  const n = ' ' + norm + ' ';
  if(norm.length > 90 || /^(ו?אם |טעה|שכח|ושכח|דינו|ודינו|הגה|עיין|ולכן|כתב|ודע|נכון|כל זה|המנהג|ומנהג|יש נוהגים|ויש נוהגים|יש אומרים|ויש אומרים|כשאומר|כשמגיע|כשיגיע|כשהש)/.test(norm)){
    c.note = true;
  }
  let t = n;
  const add = (k) => { if(c.conds.indexOf(k) === -1) c.conds.push(k); };
  const take = (re, k) => { if(re.test(t)){ add(k); t = t.replace(re, ' '); } };
  take(/חול המועד (?:של )?פסח/g, 'chmPesach');
  take(/חול המועד (?:של )?סו?כות/g, 'chmSukkot');
  take(/ערב פסח/g, 'erevPesach');
  take(/ערב יום ה?כי?פו?רים/g, 'erevYK');
  take(/מוצאי שבת|אתה חוננתנו/g, 'motzash');
  take(/עשרת ימי תשובה|ימי תשובה|ימים הנוראים/g, 'ayt');
  take(/שמיני עצרת|שמחת תורה/g, 'shmini');
  take(/ראש השנה/g, 'rh');
  take(/יום ה?כי?פו?רים/g, 'yk');
  take(/ראש ח(?:ו)?דש/g, 'rc');
  take(/חול המועד/g, 'chm');
  take(/יום טוב|ימים טובים|רגלים|מועדים/g, 'yomtov');
  take(/(?:^|\s)[ובלה]{0,2}פסח(?=\s)/g, 'pesach');
  take(/(?:^|\s)[ובלה]{0,2}סו?כות(?=\s)/g, 'sukkot');
  take(/שבועות/g, 'shavuot');
  take(/על הנסים/g, 'nisim');
  take(/חנוכה|חנכה/g, 'chanukah');
  take(/פורים/g, 'purim');
  take(/תשעה באב/g, 'av9');
  take(/תענית|צום|עננו/g, 'fast');
  take(/חורף|ימות הגשמים|ימי הגשמים|משיב הרוח/g, 'winter');
  take(/קיץ|ימות החמה|ימי החמה|מוריד הטל/g, 'summer');
  take(/ארץ ישראל/g, 'israel');
  take(/חוץ לארץ/g, 'diaspora');
  take(/ספירת העומר|לעומר|העומר/g, 'omer');
  take(/אלול/g, 'elul');
  take(/שני וחמישי|בשני ובחמישי|שני ובחמישי/g, 'monThu');
  take(/שאומרים תחנון|שאין אומרים תחנון|נפילת אפים|תחנון/g, 'tachanunDay');
  take(/במנחה|למנחה|בתפלת המנחה|בתפילת המנחה/g, 'mincha');
  take(/בשחרית|לשחרית/g, 'shacharit');
  take(/בערבית|במעריב|לערבית/g, 'maariv');
  c.weekday = sdWeekdayIn(norm);
  if(c.weekday === -1) take(/(?:^|\s)[ובלה]{0,2}שבת(?=\s)/g, 'shabbat');
  if(c.conds.indexOf('nisim') !== -1){ add('chanukah'); add('purim'); c.conds = c.conds.filter(x => x !== 'nisim'); c.blockOpen = 'nisim'; }
  else if(c.conds.indexOf('chanukah') !== -1 && c.conds.indexOf('purim') !== -1) c.blockOpen = 'nisim';
  if(/יעלה|ויבא|ויבוא/.test(norm) || (c.conds.indexOf('rc') !== -1 && (c.conds.indexOf('chm') !== -1 || c.conds.indexOf('yomtov') !== -1))) c.blockOpen = 'yaaleh';
  c.neg = /(אין|אינם|אינו|לא|ואין) (אומרים|אומר|יאמר|יאמרו|נוהגים|לומר|מתפללים)|מדלגים|מדלג|דולגים|דילג|חוץ מ/.test(norm);
  c.isSub = c.conds.length > 0 && c.conds.every(x => SD_OCCASION_SUB.indexOf(x) !== -1) && c.conds.length === 1;
  _sdClassCache.set(norm, c);
  return c;
}

function sdEvalOne(k, g, ctx){
  switch(k){
    case 'ayt': return !!g.ayt;
    case 'winter': return ctx.inBarech ? !!g.talUmatar : !!g.mashiv;
    case 'summer': return ctx.inBarech ? !g.talUmatar : !g.mashiv;
    case 'rc': return !!g.rc;
    case 'chm': return !!g.chm;
    case 'chmPesach': return !!g.chm && g.chmKind === 'pesach';
    case 'chmSukkot': return !!g.chm && g.chmKind === 'sukkot';
    case 'erevPesach': return !!g.erevPesach;
    case 'erevYK': return !!g.erevYK;
    case 'yomtov': return !!g.yomTov;
    case 'pesach': return !!g.pesach;
    case 'sukkot': return !!g.sukkot;
    case 'shavuot': return !!g.shavuot;
    case 'shmini': return !!g.shmini;
    case 'rh': return !!g.rh;
    case 'yk': return !!g.yk;
    case 'chanukah': return !!g.chanukah;
    case 'purim': return !!g.purim;
    case 'av9': return !!g.av9;
    case 'fast': return !!g.fast;
    case 'motzash': return !!g.motzash;
    case 'shabbat': return g.dow === 6;
    case 'israel': return !!g.isIsrael;
    case 'diaspora': return !g.isIsrael;
    case 'omer': return g.omerDay > 0;
    case 'elul': return !!g.elul27;
    case 'monThu': return !!g.monThu;
    case 'tachanunDay': return g.prayer === 'mincha' ? !!g.tachanunMincha : !!g.tachanun;
    case 'mincha': return g.prayer === 'mincha';
    case 'shacharit': return g.prayer === 'shacharit';
    case 'maariv': return g.prayer === 'maariv';
  }
  return true;
}
// a classified instruction → is what it governs said today? (null/undefined = no condition)
function sdEval(c, g, ctx){
  if(!c || !c.conds || !c.conds.length) return true;
  const restr = c.conds.filter(k => SD_RESTRICTIVE.indexOf(k) !== -1);
  const rest = c.conds.filter(k => SD_RESTRICTIVE.indexOf(k) === -1);
  let ok = restr.every(k => sdEvalOne(k, g, ctx)) && (!rest.length || rest.some(k => sdEvalOne(k, g, ctx)));
  if(c.neg) ok = !ok;
  return ok;
}

// One HTML segment → tokens { k: 'I' (instruction word) | 'T' (prayer word) | 'N' (space/punctuation) | 'BR', html, plain, small, bold }
function sdTokenize(html){
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html).replace(/\{[פס]\}/g, '');
  const toks = [];
  (function walk(node, small, bold){
    node.childNodes.forEach(ch => {
      if(ch.nodeType === 3){
        ch.nodeValue.split(/(\s+)/).forEach(part => {
          if(!part) return;
          if(/^\s+$/.test(part)){ toks.push({ k: 'N', html: ' ', plain: '' }); return; }
          const heb = SD_HEB_RE.test(part), nik = SD_NIKUD_RE.test(part);
          const k = !heb ? 'N' : (nik ? 'T' : 'I');
          toks.push({ k, html: sdEsc(part), raw: part, small, bold });
        });
        return;
      }
      if(ch.nodeType !== 1) return;
      const tag = ch.tagName.toLowerCase();
      if(tag === 'br'){ toks.push({ k: 'BR', html: '<br>' }); return; }
      if(tag === 'sup' || /footnote/.test(ch.className || '')) return;
      walk(ch, small || tag === 'small' || /small|instruction/.test(ch.className || ''), bold || tag === 'b' || tag === 'strong');
    });
  })(tpl.content, false, false);
  // a passage set in small print that is itself a fast-day / Tisha B'Av insertion ("עננו…", "נחם…")
  for(let i = 0; i < toks.length; i++){
    if(!(toks[i].small && toks[i].k === 'T')) continue;
    let j = i;
    while(j + 1 < toks.length && (toks[j + 1].small || toks[j + 1].k === 'N') && toks[j + 1].k !== 'BR') j++;
    const plain = sdPlain(toks.slice(i, j + 1).map(t => t.raw || ' ').join(''));
    let cond = null;
    if(/^עננו\s/.test(plain) && /(צום|תענית)/.test(plain)) cond = { conds: ['fast'] };
    else if(/^נחם\s/.test(plain) && /ירושלים/.test(plain)) cond = { conds: ['av9'] };
    if(cond) for(let k = i; k <= j; k++) toks[k].cond = cond;
    i = j;
  }
  return toks;
}
// tokens → runs of instruction words / prayer words (spaces and punctuation stay with their run)
function sdRuns(toks){
  const runs = [];
  let cur = null;
  toks.forEach(t => {
    if(t.k === 'N' || t.k === 'BR'){
      if(!cur){ cur = { k: 'T', toks: [] }; runs.push(cur); }
      cur.toks.push(t); return;
    }
    if(!cur || cur.k !== t.k){ cur = { k: t.k, toks: [] }; runs.push(cur); }
    cur.toks.push(t);
  });
  // a lone unvocalised word inside the prayer (e.g. an abbreviation) is not an instruction,
  // unless it is recognised as one ("בקיץ:", "בעשי״ת") or set apart in small print
  runs.forEach(r => {
    if(r.k !== 'I') return;
    const words = r.toks.filter(t => t.k === 'I');
    r.text = r.toks.map(t => t.raw || ' ').join('');
    r.norm = sdNormIns(r.text);
    const cls = sdClassify(r.norm);
    const allSmall = words.every(w => w.small);
    if(words.length === 1 && !allSmall && !cls.conds.length && !/[:—–]\s*$/.test(r.text.trim()) && cls.weekday === -1) r.k = 'T';
  });
  const merged = [];
  runs.forEach(r => {
    const last = merged[merged.length - 1];
    if(last && last.k === 'T' && r.k === 'T') last.toks = last.toks.concat(r.toks);
    else merged.push(r);
  });
  // a small-print run of vocalised words is still prayer text (e.g. said quietly) — kept as text
  merged.forEach(r => { if(r.k === 'T') r.plain = sdPlain(r.toks.map(t => t.raw || ' ').join('')); });
  return merged;
}
function sdTokHtml(t){
  if(t.k === 'BR') return '<br>';
  let h = t.html;
  if(t.bold) h = '<b>' + h + '</b>';
  if(t.small && t.k === 'T') h = '<small>' + h + '</small>';
  return h;
}

/* Process a stream of pieces (one group) and return its HTML.
   items: [{ leaf, segs, rule }] ; opts: { full, notes, special, noNeg } */
function sdRenderStream(items, g, opts){
  const st = { pending: null, block: null, inBarech: false };
  const ctx = st;   // sdEval reads ctx.inBarech
  const full = !!opts.full, notes = !!opts.notes;
  const out = [];
  // half Hallel: skip "לא לנו… " up to "ה׳ זכרנו" and "אהבתי…" up to "מה אשיב"
  const half = opts.special === 'hallel' && g.hallel === 'half';
  let hSkip = false;
  const NAME = /^(יהוה|יי|ה|ה')$/;

  items.forEach(item => {
    const segs = item.segs || [];
    // a piece whose inclusion the day rules already decided: its own "don't say on…" notes are shown, not applied
    const noNeg = !!opts.noNeg || !!(item.rule && item.rule.when !== undefined);
    let keepSeg = null;   // per-segment filter (song of the day, omer)
    const special = (item.rule && item.rule.special) || opts.special;
    if(special === 'songOfDay') keepSeg = sdSongOfDayFilter(segs, g);
    if(special === 'omer') keepSeg = sdOmerFilter(segs, g);
    if(item.heading) out.push(item.heading);
    if(item.error){ out.push(item.error); return; }
    out.push('<div class="sd-text">');
    segs.forEach((html, si) => {
      const filteredOut = keepSeg && !keepSeg[si];
      const toks = sdTokenize(html);
      const runs = sdRuns(toks);
      const hasText = runs.some(r => r.k === 'T' && r.plain);
      const segPlain = sdPlain(runs.filter(r => r.k === 'T').map(r => r.toks.map(t => t.raw || ' ').join('')).join(' '));
      let segOk = true, added = false, anyText = false;
      const parts = [];
      const insHtml = (r, on, kind) => {
        if(kind === 'note'){
          if(!notes && !full) return;
          parts.push('<span class="sd-note' + (on ? '' : ' sd-off') + '">' + sdEsc(r.text.trim()) + '</span> ');
          return;
        }
        if(!on && !full) return;
        parts.push('<span class="sd-ins' + (on ? '' : ' sd-off') + '">' + sdEsc(r.text.trim()) + '</span> ');
      };

      if(!hasText){
        // ---- a line of instructions only ----
        const norm = sdNormIns(runs.map(r => r.text || '').join(' '));
        if(!norm){ return; }
        let c = sdClassify(norm);
        if(noNeg && c.neg) c = Object.assign({}, c, { conds: [], neg: false });
        if(/ברכת השנים/.test(norm)) st.inBarech = true;
        const blockOn = st.block ? sdEval(st.block.cond, g, ctx) : true;
        let on = blockOn && !filteredOut;
        if(c.note){
          if(notes || full) out.push('<p class="sd-note-p' + (on ? '' : ' sd-off') + '">' + sdEsc(runs.map(r => r.text || '').join(' ').trim()) + '</p>');
          st.pending = null;
          return;
        }
        if(c.conds.length){
          on = on && sdEval(c, g, ctx);
          if(st.block && st.block.type === 'yaaleh' && c.isSub) st.pending = c;
          else if(c.blockOpen && !st.block){ st.block = { type: c.blockOpen, cond: c, count: 0 }; st.pending = null; }
          else st.pending = c;
          if(on || full) out.push('<p class="sd-label sd-cond' + (on ? '' : ' sd-off') + '">' + sdEsc(runs.map(r => r.text || '').join(' ').trim()) + '</p>');
          return;
        }
        // a heading / stage direction ("אבות", "קהל וחזן:")
        st.pending = null;
        if(on || full){
          const short = norm.split(' ').length <= 3 && !/[:]/.test(runs.map(r => r.text || '').join(''));
          out.push('<p class="' + (short ? 'sd-sub' : 'sd-label') + (on ? '' : ' sd-off') + '">' + sdEsc(runs.map(r => r.text || '').join(' ').trim()) + '</p>');
        }
        return;
      }

      // ---- a line of prayer (maybe with instructions inside it) ----
      if(st.block){
        const b = st.block;
        if(b.type === 'yaaleh' && /^(ו?תחזינה|ותחזנה|מודים|ועל כלם|ועל כולם)/.test(segPlain)) st.block = null;
        else if(b.type === 'nisim' && /^(ו?על כ ?ו?לם|ועל הכל|וכל החיים|ועל כולם)/.test(segPlain)) st.block = null;
        else if(++b.count > 12) st.block = null;
      }
      if(/תקע בשופר/.test(segPlain)) st.inBarech = false;
      if(/(^|\s)(ברך עלינו|ברכנו)(\s|$)/.test(segPlain)) st.inBarech = true;
      let openedHere = false;
      if(!st.block && /(^|\s)יעלה ויבו?א/.test(segPlain)){
        st.block = { type: 'yaaleh', cond: { conds: ['rc','chm','yomtov','rh'], neg: false }, count: 0 }; openedHere = true;
      }else if(!st.block && /^ו?על הנסים/.test(segPlain) && !runs.some(r => r.k === 'I' && sdClassify(r.norm).conds.length)){
        st.block = { type: 'nisim', cond: { conds: ['chanukah','purim'], neg: false }, count: 0 }; openedHere = true;
      }
      const base = st.block ? st.block.cond : null;
      let pend = st.pending; st.pending = null;
      // inside על הנסים: the Chanukah / Purim paragraphs; inside יעלה ויבוא: the line naming the day
      let segCond = null;
      if(st.block && st.block.type === 'nisim'){
        if(/מתתי/.test(segPlain)) segCond = { conds: ['chanukah'] };
        else if(/מרדכי/.test(segPlain)) segCond = { conds: ['purim'] };
      }
      if(st.block && st.block.type === 'yaaleh' && segPlain.length < 60 && !runs.some(r => r.k === 'I')){
        if(/^(ביום )?ראש ה?חו?דש הזה/.test(segPlain)) segCond = { conds: ['rc'] };
        else if(/^(ביום )?חג המצות/.test(segPlain)) segCond = { conds: ['pesach'] };
        else if(/^(ביום )?חג השבו?עות/.test(segPlain)) segCond = { conds: ['shavuot'] };
        else if(/^(ביום )?חג הסו?כות/.test(segPlain)) segCond = { conds: ['sukkot'] };
        else if(/^(ביום )?שמיני/.test(segPlain)) segCond = { conds: ['shmini'] };
        else if(/^(ביום )?הזכרון/.test(segPlain)) segCond = { conds: ['rh'] };
        else if(/^(ביום )?הכי?פורים/.test(segPlain)) segCond = { conds: ['yk'], neg: false };
      }
      if(!segCond && !runs.some(r => r.k === 'I')){
        if(/^עננו\s/.test(segPlain) && /(צום|תענית)/.test(segPlain)) segCond = { conds: ['fast'] };
        else if(/^נחם\s/.test(segPlain) && /ירושלים/.test(segPlain)) segCond = { conds: ['av9'] };
      }
      // the everyday ending that the Ten Days replace
      let aytReplaced = false;
      if(g.ayt && !base && !pend && segPlain.length < 50 && /^ברוך אתה \S+ (האל הקדוש|מלך אוהב צדקה ומשפט)$/.test(segPlain)) aytReplaced = true;

      let inline = null, sub = null, paren = false, prevText = '';
      runs.forEach((r, ri) => {
        if(r.k === 'I'){
          let c = sdClassify(r.norm);
          if(noNeg && c.neg) c = Object.assign({}, c, { conds: [], neg: false });
          if(c.note){ insHtml(r, sdEval(base, g, ctx) && sdEval(pend, g, ctx), 'note'); return; }
          if(c.conds.length){
            if(st.block && st.block.type === 'yaaleh' && c.isSub){ sub = c; }
            else { inline = c; paren = /\(\s*$/.test(prevText); }
            if(c.blockOpen && !st.block && !openedHere){ st.block = { type: c.blockOpen, cond: c, count: 0 }; }
            insHtml(r, sdEval(base, g, ctx) && sdEval(pend, g, ctx) && sdEval(segCond, g, ctx) && sdEval(c, g, ctx), 'ins');
          }else{
            insHtml(r, sdEval(base, g, ctx) && sdEval(pend, g, ctx) && sdEval(inline, g, ctx), 'ins');
          }
          prevText = '';
          return;
        }
        // prayer words
        const toks2 = r.toks;
        let runHtml = '';
        let curOn = null;
        for(let ti = 0; ti < toks2.length; ti++){
          const t = toks2[ti];
          // half Hallel skipping, word by word
          if(half && t.k === 'T'){
            const w = sdPlain(t.raw);
            const nx = (toks2.slice(ti + 1).find(x => x.k === 'T') || {}).raw;
            const nxw = nx ? sdPlain(nx) : '';
            if(!hSkip && ((w === 'לא' && nxw === 'לנו') || (w === 'אהבתי' && nxw === 'כי'))) hSkip = true;
            else if(hSkip && ((NAME.test(w) && nxw === 'זכרנו') || (w === 'מה' && nxw === 'אשיב'))) hSkip = false;
          }
          let on = !filteredOut && !aytReplaced && sdEval(base, g, ctx) && sdEval(pend, g, ctx) && sdEval(segCond, g, ctx) && sdEval(inline, g, ctx) && sdEval(sub, g, ctx) && sdEval(t.cond, g, ctx);
          if(t.cond && on && t.k === 'T') added = true;
          if(half && hSkip && t.k === 'T') on = false;
          if(t.k === 'T'){
            if(on){ anyText = true; if(base || pend || segCond || inline || sub) added = true; }
          }
          if(on !== curOn){
            if(curOn === false) runHtml += '</span>';
            if(on === false) runHtml += '<span class="sd-off">';
            curOn = on;
          }
          if(on || full) runHtml += sdTokHtml(t);
          if(t.k === 'T' && sub && /הזה/.test(sdPlain(t.raw))) sub = null;
          if(paren && t.raw && /\)/.test(t.raw)){ inline = null; paren = false; }
        }
        if(curOn === false) runHtml += '</span>';
        parts.push(runHtml);
        prevText = toks2.map(t => t.raw || ' ').join('');
      });
      if(st.block && st.block.type === 'yaaleh' && /חנון ורחום/.test(segPlain)) st.block = null;
      if(!anyText && !full) return;
      const cls = !anyText ? ' class="sd-off"' : (added ? ' class="sd-added"' : '');
      out.push('<p' + cls + '>' + parts.join('').replace(/\s+<\/span>/g, '</span> ') + '</p>');
    });
    out.push('</div>');
  });
  return out.join('');
}

/* A local nusach whose day-dependent parts are marked in the data itself:
     <span class="sd-i">…</span>                 an instruction
     <span data-w="rc chm" [data-n="1"]>…</span> said when one of these holds [none of them holds]
   (nested spans: all must hold). items: [{ heading, segs, error }] ; opts: { full, notes } */
function sdExplicitKey(k, g){
  switch(k){
    case 'winter': return !!g.mashiv;
    case 'summer': return !g.mashiv;
    case 'winterB': return !!g.talUmatar;
    case 'summerB': return !g.talUmatar;
    case 'other': return false;            // another nusach's wording
  }
  return sdEvalOne(k, g, {});
}
function sdExplicitOn(el, g){
  const keys = (el.getAttribute('data-w') || '').split(/\s+/).filter(Boolean);
  if(!keys.length) return true;
  const restr = keys.filter(k => SD_RESTRICTIVE.indexOf(k) !== -1);
  const rest = keys.filter(k => SD_RESTRICTIVE.indexOf(k) === -1);
  let ok = restr.every(k => sdExplicitKey(k, g)) && (!rest.length || rest.some(k => sdExplicitKey(k, g)));
  if(el.getAttribute('data-n')) ok = !ok;
  return ok;
}
function sdRenderExplicit(items, g, opts){
  const full = !!opts.full, notes = !!opts.notes;
  const out = [];
  items.forEach(item => {
    if(item.heading) out.push(item.heading);
    if(item.error){ out.push(item.error); return; }
    out.push('<div class="sd-text">');
    (item.segs || []).forEach(html => {
      const tpl = document.createElement('template');
      tpl.innerHTML = String(html);
      const st = { text: false, ins: false, added: false };
      const walk = (node, on, cond) => {
        let h = '';
        node.childNodes.forEach(ch => {
          if(ch.nodeType === 3){
            if(!on && !full) return;
            if(on && SD_HEB_RE.test(ch.nodeValue)){ st.text = true; if(cond) st.added = true; }
            h += sdEsc(ch.nodeValue);
            return;
          }
          if(ch.nodeType !== 1) return;
          const tag = ch.tagName.toLowerCase();
          if(tag === 'br'){ if(on || full) h += '<br>'; return; }
          if(ch.classList.contains('sd-i')){
            const t = ch.textContent.trim();
            if(!t || (!on && !full)) return;
            const note = t.length > 90;
            if(note && !notes && !full) return;
            if(on) st.ins = true;
            h += '<span class="' + (note ? 'sd-note' : 'sd-ins') + (on ? '' : ' sd-off') + '">' + sdEsc(t) + '</span> ';
            return;
          }
          if(ch.hasAttribute('data-w')){
            const here = on && sdExplicitOn(ch, g);
            const inner = walk(ch, here, cond || (here && !ch.getAttribute('data-n')));
            if(!here && !full) return;
            h += here ? inner : '<span class="sd-off">' + inner + '</span>';
            return;
          }
          const inner = walk(ch, on, cond);
          if(tag === 'b' || tag === 'small') h += '<' + tag + '>' + inner + '</' + tag + '>';
          else h += inner;
        });
        return h;
      };
      const h = walk(tpl.content, true, false).replace(/^(\s|<br>)+|(\s|<br>)+$/g, '');
      if(!h) return;
      if(!st.text){
        if(st.ins) out.push('<p class="sd-label">' + h + '</p>');
        else if(full) out.push('<p class="sd-off">' + h + '</p>');
        return;
      }
      out.push('<p' + (st.added ? ' class="sd-added"' : '') + '>' + h + '</p>');
    });
    out.push('</div>');
  });
  return out.join('');
}

// Song of the day: keep the introduction and today's psalm only.
function sdSongOfDayFilter(segs, g){
  const days = segs.map(() => null);
  let cur = 'intro', found = false;
  segs.forEach((html, i) => {
    const plain = sdPlain(html.replace(/<[^>]+>/g, ' '));
    const norm = sdNormIns(html.replace(/<[^>]+>/g, ' '));
    const wd = sdWeekdayIn(plain);
    if(wd !== -1 && wd !== cur){ cur = wd; found = true; }
    else if(!SD_NIKUD_RE.test(html)){
      const c = sdClassify(norm);
      if(c.conds.length && wd === -1 && c.conds.some(k => ['rc','elul','chanukah','yomtov','chm','fast','av9'].indexOf(k) !== -1)) cur = 'general';
    }
    days[i] = cur;
  });
  if(!found) return null;
  return days.map(d => d === 'intro' || d === 'general' || d === g.dow);
}
// Sefirat HaOmer: of the 49 counts, keep tonight's.
function sdOmerFilter(segs, g){
  const idx = [];
  segs.forEach((html, i) => {
    const p = sdPlain(html.replace(/<[^>]+>/g, ' '));
    if(p.length < 260 && /(^|\s)היום\s/.test(p) && /(לעו?מר|בעו?מר)/.test(p)) idx.push(i);
  });
  if(idx.length < 40 || !g.omerDay || g.omerDay > idx.length) return null;
  const keep = segs.map(() => true);
  const first = idx[0], last = idx[idx.length - 1];
  for(let i = first; i <= last; i++) keep[i] = false;
  const mine = idx[g.omerDay - 1];
  keep[mine] = true;
  if(mine > 0 && !SD_NIKUD_RE.test(segs[mine - 1]) && keep[mine - 1] === false && (idx.indexOf(mine - 1) === -1)) keep[mine - 1] = true;
  return keep;
}

/* =====================================================================
   5. THE PAGE
   ===================================================================== */
function sdLastPart(he){ const p = String(he || '').split(/,\s*/); return p[p.length - 1] || he; }
function sdResolveMatch(m, g){ return typeof m === 'function' ? m(g) : m; }
function sdWhen(w, g){
  if(w === undefined) return true;
  const v = typeof w === 'function' ? w(g) : w;
  return v === 'optional' ? 'optional' : !!v;
}

function sdTimeTag(){
  const h = new Date().getHours() + new Date().getMinutes() / 60;
  return h >= 4 && h < 12.5 ? 'shacharit' : (h >= 12.5 && h < 17.5 ? 'mincha' : 'maariv');
}

function initSiddurPage(nusachKey){
  const N = SIDDUR_NUSACHOT[nusachKey];
  const $ = id => document.getElementById(id);
  const reader = $('reader');
  if(!N || !reader) return;

  const state = {
    prayer: null, date: null, loc: null, overrides: {},
    full: false, notes: false, leaves: null, renderId: 0
  };
  try{ state.notes = sdStore('sd-notes') === true; state.full = false; }catch(e){}
  // location: a quick guess from the device time zone, refined in the background
  let tz = '';
  try{ tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; }catch(e){}
  state.loc = { isIsrael: /Jerusalem|Tel_Aviv/.test(tz) || !tz, inJerusalem: false, lat: 31.7683, lon: 35.2137, guessed: true };

  // which prayer: from the address (#shacharit), else by the time of day
  const fromHash = (location.hash || '').replace('#', '');
  state.prayer = SD_PRAYER_HE[fromHash] ? fromHash : sdTimeTag();
  const params = new URLSearchParams(location.search);
  if(/^\d{4}-\d{2}-\d{2}$/.test(params.get('date') || '')){
    const [y, m, d] = params.get('date').split('-').map(Number);
    state.date = new Date(y, m - 1, d, 12);
  }

  function baseDate(){ return state.date || new Date(); }
  // Maariv belongs to the coming Hebrew day: the evening after the chosen date
  function prayerMs(){
    const b = baseDate();
    let ms = sdNoonOf(b);
    if(state.prayer === 'maariv'){
      const early = !state.date && new Date().getHours() < 4;   // after midnight, still "tonight"
      if(!early) ms += SD_DAY_MS;
    }
    return ms;
  }
  function currentFlags(){
    const ms = prayerMs();
    const facts = sdComputeFacts(ms, state.loc);
    facts.tomorrow = sdComputeFacts(ms + SD_DAY_MS, state.loc);
    const o = state.overrides;
    ['rc','chanukah','purim','fast','ayt','mashiv','talUmatar'].forEach(k => { if(o[k] !== undefined) facts[k] = o[k]; });
    if(o.fast === true && !facts.fastKind) facts.fastKind = 'tevet';
    if(o.fast === false){ facts.fastKind = null; facts.av9 = false; }
    if(o.chm !== undefined){
      facts.chm = o.chm;
      facts.chmKind = o.chm ? (facts.chmKind || (['Nisan','Iyar','Adar','Adar II','Shevat'].indexOf(facts.hm) !== -1 ? 'pesach' : 'sukkot')) : null;
      if(o.chm){ if(facts.chmKind === 'pesach') facts.pesach = true; else facts.sukkot = true; }
    }
    if(o.isIsrael !== undefined) facts.isIsrael = o.isIsrael;
    if(o.tachanun !== undefined) facts.tachanunOverride = o.tachanun;
    if(o.hallel) facts.hallelOverride = o.hallel;
    const g = sdDeriveFlags(facts, nusachKey, state.prayer);
    if(o.motzash !== undefined) g.motzash = o.motzash;
    return g;
  }

  /* ---------- the day panel ---------- */
  const FLAG_BOXES = [
    ['rc', 'ראש חודש'], ['chm', 'חול המועד'], ['chanukah', 'חנוכה'], ['purim', 'פורים'],
    ['fast', 'תענית ציבור'], ['ayt', 'עשרת ימי תשובה'], ['tachanun', 'אומרים תחנון'],
    ['mashiv', 'משיב הרוח (חורף)'], ['talUmatar', 'ותן טל ומטר'], ['motzash', 'מוצאי שבת (בערבית)'], ['isIsrael', 'ארץ ישראל']
  ];
  function buildFlagBoxes(){
    const wrap = $('sd-flags');
    if(!wrap || wrap.dataset.built) return;
    wrap.dataset.built = '1';
    FLAG_BOXES.forEach(([k, label]) => {
      const lab = document.createElement('label');
      lab.className = 'choice';
      lab.innerHTML = '<input type="checkbox" id="sd-flag-' + k + '"> ' + label;
      wrap.appendChild(lab);
      lab.querySelector('input').addEventListener('change', e => {
        state.overrides[k] = e.target.checked;
        rerender();
      });
    });
    const hs = $('sd-hallel');
    if(hs) hs.addEventListener('change', () => { state.overrides.hallel = hs.value || undefined; rerender(); });
    const reset = $('sd-reset');
    if(reset) reset.addEventListener('click', () => { state.overrides = {}; if(hs) hs.value = ''; rerender(); });
  }
  function syncFlagBoxes(g){
    const val = { rc: g.rc, chm: g.chm, chanukah: g.chanukah, purim: g.purim, fast: g.fast, ayt: g.ayt,
      tachanun: state.prayer === 'mincha' ? g.tachanunMincha : g.tachanun, mashiv: g.mashiv, talUmatar: g.talUmatar, motzash: g.motzash, isIsrael: g.isIsrael };
    FLAG_BOXES.forEach(([k]) => {
      const el = $('sd-flag-' + k);
      if(el){ el.checked = !!val[k]; el.closest('.choice').classList.toggle('sd-overridden', state.overrides[k] !== undefined); }
    });
    const hs = $('sd-hallel');
    if(hs && !state.overrides.hallel) hs.value = '';
    const hl = $('sd-hallel-auto');
    if(hl) hl.textContent = { none: 'ללא', half: 'חצי הלל', full: 'הלל שלם' }[g.hallel] || '';
  }
  function renderDayPanel(g){
    const st = $('sd-status');
    let dayLabel = '';
    try{ dayLabel = getHebrewDisplay(new Date(g.ms)); }catch(e){}
    const wd = 'יום ' + WEEKDAY_NAMES[g.dow];
    const evening = state.prayer === 'maariv' ? 'ליל ' : '';
    const labels = sdDayLabels(g);
    if(st){
      st.innerHTML = 'תפילת <b>' + SD_PRAYER_HE[state.prayer] + '</b> ל' + evening + sdEsc(wd) + ', ' + sdEsc(dayLabel) +
        (labels.length ? ' · <b>' + sdEsc(labels.join(' · ')) + '</b>' : '') +
        (state.loc && state.loc.guessed ? '' : (g.isIsrael ? ' · מנהג ארץ ישראל' : ' · מנהג חוץ לארץ'));
    }
    const list = $('sd-summary');
    if(list){
      let items = sdDescribe(g, state.prayer);
      if(N.auto){
        // a nusach built from its own sections: don't list parts it does not have (yet)
        const names = N.prayers ? (N.prayers[state.prayer] || []).map(x => x.he).join(' ') : '';
        const NEEDS = [[/הלל/, /הלל/], [/מוסף/, /מוסף/], [/קריאת התורה/, /קריאת התורה|ספר תורה/], [/למנצח/, /למנצח/],
                       [/ברכי נפשי/, /ברכי נפשי|ראש חודש/], [/לולב/, /לולב|הושענות/], [/אבינו מלכנו/, /./]];
        items = items.filter(x => NEEDS.every(([re, want]) => !re.test(x) || want.test(names)));
      }
      list.innerHTML = items.map(x => '<li>' + sdEsc(x) + '</li>').join('');
    }
    syncFlagBoxes(g);
    const di = $('sd-date');
    if(di){
      const b = baseDate();
      di.value = b.getFullYear() + '-' + String(b.getMonth() + 1).padStart(2, '0') + '-' + String(b.getDate()).padStart(2, '0');
    }
  }

  /* ---------- building the prayer ---------- */
  function planGroups(g){
    const groups = (N.prayers && N.prayers[state.prayer]) || [];
    const used = new Set();
    return groups.map((grp, gi) => {
      const when = sdWhen(grp.when, g);
      const re = sdResolveMatch(grp.match, g);
      const leaves = re ? state.leaves.filter(l => !used.has(l.ref) && re.test(l.path)) : [];
      leaves.forEach(l => used.add(l.ref));
      const items = leaves.map(l => {
        const rule = (grp.leaves || []).find(r => r.match.test(l.path)) || null;
        const lw = rule ? sdWhen(rule.when, g) : true;
        return { leaf: l, rule, when: lw };
      });
      return { grp, gi, when, items };
    }).filter(p => p.items.length);
  }

  function groupCardHtml(p, g){
    const id = 'sd-g-' + p.gi;
    const head = '<div class="chapter-head"><h2>' + sdEsc(p.grp.he) + '</h2>' +
      (p.grp.note ? '<span class="gem">' + sdEsc(p.grp.note) + '</span>' : '') + '</div>';
    return { id, head };
  }

  async function renderGroupBody(p, g, bodyEl){
    const items = p.items.filter(it => it.when !== false || state.full);
    const single = items.length === 1;
    const loaded = await Promise.all(items.map(async it => {
      try{
        const segs = await sdFetchLeaf(it.leaf.ref);
        return { it, segs };
      }catch(e){
        return { it, error: '<p class="chapter-error">לא ניתן היה לטעון את "' + sdEsc(sdLastPart(it.leaf.he) || it.leaf.path) + '" כרגע. אפשר לקרוא ישירות ב<a href="' + sdSefariaUrl(it.leaf.ref) + '" target="_blank" rel="noopener">ספריא</a>.</p>' };
      }
    }));
    const streamItems = [];
    loaded.forEach(x => {
      const it = x.it;
      const name = sdLastPart(it.leaf.he) || it.leaf.path;
      const showHead = !single && name && name !== p.grp.he;
      if(it.when === 'optional'){
        // a folded sub-piece inside a group
        streamItems.push({ fold: true, heading: '<details class="sd-fold"><summary>' + sdEsc(name) + (it.rule && it.rule.note ? ' <span class="sd-fold-note">(' + sdEsc(it.rule.note) + ')</span>' : '') + '</summary>', segs: x.segs, rule: it.rule, error: x.error });
        return;
      }
      const off = it.when === false;
      const head = showHead ? '<h3 class="sd-leaf' + (off ? ' sd-off' : '') + '">' + sdEsc(name) + (off ? ' <span class="sd-leaf-tag">לא נאמר היום</span>' : '') + (it.rule && it.rule.note && !off ? ' <span class="sd-leaf-tag">' + sdEsc(it.rule.note) + '</span>' : '') + '</h3>' : '';
      streamItems.push({ heading: head, segs: off ? [] : x.segs, rule: it.rule, error: x.error, offLeaf: off });
    });
    // render; folded items get their own stream (so their instructions don't leak)
    let html = '';
    let buffer = [];
    const render = (its, o) => N.explicit ? sdRenderExplicit(its, g, o) : sdRenderStream(its, g, o);
    const flushBuf = () => { if(buffer.length){ html += render(buffer, { full: state.full, notes: state.notes, special: p.grp.special, noNeg: p.grp.special === 'hallel' }); buffer = []; } };
    for(let i = 0; i < streamItems.length; i++){
      const s = streamItems[i];
      if(s.fold){
        flushBuf();
        html += s.heading + (s.error || render([{ segs: s.segs, rule: s.rule }], { full: state.full, notes: state.notes, special: s.rule && s.rule.special })) + '</details>';
        continue;
      }
      if(s.offLeaf){ flushBuf(); html += s.heading; continue; }
      buffer.push(s);
    }
    flushBuf();
    if(p.grp.special === 'omer' && g.omerDay){
      html = '<p class="sd-today-note">הלילה סופרים: <b>' + sdEsc(sdOmerText(g.omerDay)) + '</b></p>' + html;
    }
    if(p.grp.special === 'hallel'){
      const kind = g.hallel === 'half' ? 'חצי הלל — מדלגים על "לא לנו" ועל "אהבתי" (עד "ה׳ זכרנו" ועד "מה אשיב")' : 'הלל שלם';
      html = '<p class="sd-today-note">היום: <b>' + kind + '</b>. ' + (g.hallel === 'half' && g.nusach !== 'ashkenaz' && g.nusach !== 'chabad' ? 'בנוסח עדות המזרח אין מברכים על חצי הלל.' : '') + '</p>' + html;
    }
    bodyEl.innerHTML = html || '<p class="sd-empty">אין בקטע זה דבר שנאמר היום.</p>';
    if(!html.replace(/<[^>]+>/g, '').trim()) bodyEl.innerHTML = '<p class="sd-empty">אין בקטע זה דבר שנאמר היום.</p>';
  }

  async function renderPrayer(){
    const myId = ++state.renderId;
    const g = currentFlags();
    renderDayPanel(g);
    document.querySelectorAll('#siddur-section nav.modes button').forEach(b => {
      const on = b.dataset.prayer === state.prayer;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    if(!state.leaves){
      reader.innerHTML = '<p class="chapter-loading">' + (N.data || N.local ? 'טוען את הסידור…' : 'טוען את הסידור מספריא…') + '</p>';
      try{
        if(N.data){ state.leaves = await sdLoadLocalBook(N); if(N.auto){ N.prayers = sdAutoPrayers(N, state.leaves); renderDayPanel(g); } }
        else if(N.local){
          try{ state.leaves = await sdLoadLocalIndex(N); }
          catch(e){ console.warn('siddur: local copy unavailable, loading from Sefaria', e); state.leaves = await sdLoadLeaves(N.book); }
        }
        else state.leaves = await sdLoadLeaves(N.book);
      }
      catch(e){
        console.error('siddur: table of contents failed', e);
        const src = N.data ? '<a href="' + N.sourceUrl + '" target="_blank" rel="noopener">' + sdEsc(N.he) + ' ב' + sdEsc(N.sourceName) + '</a>'
                           : '<a href="' + sdSefariaUrl(N.book) + '" target="_blank" rel="noopener">' + sdEsc(N.he) + ' בספריא</a>';
        reader.innerHTML = '<p class="chapter-error" role="alert">לא ניתן היה לטעון את הסידור כרגע. אפשר לנסות שוב בעוד רגע, או לפתוח את ' + src + '.</p>';
        return;
      }
      if(myId !== state.renderId) return;
    }
    const plan = planGroups(g);
    const toc = $('sd-toc');
    const parts = [];
    const tocParts = [];
    const pageUrl = location.href.split('#')[0];
    plan.forEach(p => {
      const { id, head } = groupCardHtml(p, g);
      if(p.when === false){
        if(state.full) parts.push('<article class="chapter-card sd-group sd-group-off" id="' + id + '">' + head.replace('</h2>', ' <span class="sd-leaf-tag">לא נאמר היום</span></h2>') + '</article>');
        return;
      }
      if(p.when === 'optional'){
        parts.push('<details class="chapter-card sd-group sd-optional" id="' + id + '"><summary><span class="sd-opt-title">' + sdEsc(p.grp.he) + '</span>' +
          (p.grp.note ? '<span class="sd-fold-note">' + sdEsc(p.grp.note) + '</span>' : '') + '<span class="sd-opt-hint">להצגה</span></summary><div class="sd-body" data-gi="' + p.gi + '"></div></details>');
        return;
      }
      tocParts.push('<a class="chip" href="#' + id + '">' + sdEsc(p.grp.he) + '</a>');
      parts.push('<article class="chapter-card sd-group" id="' + id + '">' + head + '<div class="sd-body" data-gi="' + p.gi + '"><p class="chapter-loading">טוען…</p></div></article>');
    });
    reader.innerHTML =
      '<div class="sd-reader-head"><h2 class="sd-reader-title">' + SD_PRAYER_HE[state.prayer] + ' — ' + sdEsc(N.he) + '</h2><div class="share-row"></div></div>' +
      parts.join('');
    const shareSlot = reader.querySelector('.sd-reader-head .share-row');
    if(shareSlot) shareSlot.replaceWith(buildShareBar(pageUrl + '#' + state.prayer, 'תפילת ' + SD_PRAYER_HE[state.prayer] + ' — ' + N.he + ', מותאם ליום:'));
    if(toc) toc.innerHTML = tocParts.join('');
    // load the groups in order (the requests themselves run in parallel, a few at a time)
    const byGi = {};
    plan.forEach(p => { byGi[p.gi] = p; });
    reader.querySelectorAll('details.sd-optional').forEach(det => {
      det.addEventListener('toggle', () => {
        const body = det.querySelector('.sd-body');
        if(det.open && body && !body.dataset.loaded){
          body.dataset.loaded = '1';
          body.innerHTML = '<p class="chapter-loading">טוען…</p>';
          renderGroupBody(byGi[body.dataset.gi], g, body);
        }
      });
    });
    const bodies = Array.from(reader.querySelectorAll('article.sd-group .sd-body'));
    await Promise.all(bodies.map(async body => {
      const p = byGi[body.dataset.gi];
      try{ await renderGroupBody(p, g, body); }
      catch(e){ console.error('siddur: group failed', p && p.grp.he, e); body.innerHTML = '<p class="chapter-error">שגיאה בהצגת קטע זה.</p>'; }
    }));
  }
  function rerender(){ renderPrayer(); }

  /* ---------- controls ---------- */
  document.querySelectorAll('#siddur-section nav.modes button').forEach(b => {
    b.addEventListener('click', () => {
      state.prayer = b.dataset.prayer;
      state.overrides = {};
      const hs = $('sd-hallel'); if(hs) hs.value = '';
      history.replaceState(null, '', '#' + state.prayer);
      rerender();
    });
  });
  const di = $('sd-date');
  if(di) di.addEventListener('change', () => {
    if(!di.value) return;
    const [y, m, d] = di.value.split('-').map(Number);
    state.date = new Date(y, m - 1, d, 12);
    state.overrides = {};
    rerender();
  });
  const shift = delta => {
    const b = baseDate();
    state.date = new Date(b.getFullYear(), b.getMonth(), b.getDate() + delta, 12);
    state.overrides = {};
    rerender();
  };
  if($('sd-prev')) $('sd-prev').addEventListener('click', () => shift(-1));
  if($('sd-next')) $('sd-next').addEventListener('click', () => shift(1));
  if($('sd-today')) $('sd-today').addEventListener('click', () => { state.date = null; state.overrides = {}; state.prayer = sdTimeTag(); rerender(); });
  const fullBox = $('sd-full');
  if(fullBox) fullBox.addEventListener('change', () => { state.full = fullBox.checked; rerender(); });
  const notesBox = $('sd-notes');
  if(notesBox){ notesBox.checked = state.notes; notesBox.addEventListener('change', () => { state.notes = notesBox.checked; sdStore('sd-notes', state.notes); rerender(); }); }
  // text size
  let size = 1.3;
  try{ const s = parseFloat(sdStore('sd-size')); if(s >= 1 && s <= 2.2) size = s; }catch(e){}
  const applySize = () => { reader.style.setProperty('--sd-size', size.toFixed(2) + 'rem'); };
  applySize();
  if($('sd-bigger')) $('sd-bigger').addEventListener('click', () => { size = Math.min(2.2, size + 0.1); applySize(); sdStore('sd-size', size); });
  if($('sd-smaller')) $('sd-smaller').addEventListener('click', () => { size = Math.max(1, size - 0.1); applySize(); sdStore('sd-size', size); });

  buildFlagBoxes();
  renderPrayer();

  // refine the location (Israel / abroad, Jerusalem for Shushan Purim) — re-render only if it matters
  (async () => {
    try{
      const loc = await detectGatingLocation();
      const inJ = Math.abs(loc.lat - 31.78) < 0.12 && Math.abs(loc.lon - 35.22) < 0.15;
      const changed = loc.isIsrael !== state.loc.isIsrael || inJ !== state.loc.inJerusalem;
      state.loc = { isIsrael: loc.isIsrael, inJerusalem: inJ, lat: loc.lat, lon: loc.lon, guessed: false };
      // after sunset the evening prayer is the natural default
      if(!fromHash && !state.date){
        try{
          const now = new Date();
          const sunset = calcSunsetUTC(now, loc.lat, loc.lon);
          if(sunset && now >= sunset && state.prayer !== 'maariv'){ state.prayer = 'maariv'; renderPrayer(); return; }
        }catch(e){}
      }
      if(changed) renderPrayer(); else renderDayPanel(currentFlags());
    }catch(e){}
  })();
}

function sdOmerText(n){
  const W = ['', 'שבוע אחד', 'שני שבועות', 'שלושה שבועות', 'ארבעה שבועות', 'חמישה שבועות', 'שישה שבועות', 'שבעה שבועות'];
  const D = ['', 'יום אחד', 'שני ימים', 'שלושה ימים', 'ארבעה ימים', 'חמישה ימים', 'שישה ימים'];
  const w = Math.floor(n / 7), d = n % 7;
  let s = 'היום ' + (n === 1 ? 'יום אחד' : n + ' ימים') + ' לעומר';
  if(w) s += ', שהם ' + W[w] + (d ? ' ו' + D[d] : '');
  return s;
}

/* =====================================================================
   6. HUB PAGE (siddur.html) — what changes today, for every prayer
   ===================================================================== */
function initSiddurHub(){
  const box = document.getElementById('sd-hub-today');
  if(!box) return;
  let tz = '';
  try{ tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; }catch(e){}
  let loc = { isIsrael: /Jerusalem|Tel_Aviv/.test(tz) || !tz, inJerusalem: false };
  function draw(){
    const now = new Date();
    const today = sdNoonOf(now);
    const rows = ['shacharit','mincha','maariv'].map(pr => {
      const ms = pr === 'maariv' ? (now.getHours() < 4 ? today : today + SD_DAY_MS) : today;
      const f = sdComputeFacts(ms, loc);
      f.tomorrow = sdComputeFacts(ms + SD_DAY_MS, loc);
      const g = sdDeriveFlags(f, 'ashkenaz', pr);
      const labels = sdDayLabels(g);
      let dayLabel = '';
      try{ dayLabel = getHebrewDisplay(new Date(ms)); }catch(e){}
      const items = sdDescribe(g, pr).filter(x => !/^(משיב|מוריד|ותן)/.test(x) || pr !== 'mincha');
      return '<li class="sd-hub-row"><div class="sd-hub-when"><b>' + SD_PRAYER_HE[pr] + '</b><span>' + (pr === 'maariv' ? 'ליל ' : '') + sdEsc(dayLabel) + (labels.length ? ' · ' + sdEsc(labels.join(' · ')) : '') + '</span></div>' +
        '<ul class="sd-pills">' + items.map(x => '<li>' + sdEsc(x) + '</li>').join('') + '</ul>' +
        '<div class="sd-hub-links">' + Object.keys(SIDDUR_NUSACHOT).map(k => '<a href="' + SIDDUR_NUSACHOT[k].page + '#' + pr + '">' + sdEsc(SIDDUR_NUSACHOT[k].he) + '</a>').join('') + '</div></li>';
    });
    box.innerHTML = '<ul class="sd-hub-list">' + rows.join('') + '</ul>';
  }
  draw();
  (async () => {
    try{
      const l = await detectGatingLocation();
      const inJ = Math.abs(l.lat - 31.78) < 0.12 && Math.abs(l.lon - 35.22) < 0.15;
      if(l.isIsrael !== loc.isIsrael || inJ !== loc.inJerusalem){ loc = { isIsrael: l.isIsrael, inJerusalem: inJ }; draw(); }
    }catch(e){}
  })();
}
