// Safety check for an update of the Birkat HaMazon texts.
// The site decides which additions to show (על הנסים, יעלה ויבוא, רצה…) by recognising lines in the
// text (planBirkatSegments in shared.js). This runs that same code over the NEW text and over the
// text currently on the site, and fails if the additions it recognises are not the same — e.g.
// because Sefaria split, merged or reworded a line. Then the update must be checked by hand.
//
//   node .github/scripts/check_birkat.js <folder with the current _includes> <folder with the new _includes>
const fs = require('fs'), vm = require('vm'), path = require('path');
const [oldDir, newDir] = process.argv.slice(2);
const root = path.join(__dirname, '..', '..');

const ctx = { console, Intl, Date, Math, setTimeout, clearTimeout, setInterval, clearInterval,
  navigator: {}, window: {}, location: { href: '' },
  document: { getElementById: () => null, addEventListener(){}, querySelector: () => null, querySelectorAll: () => [] } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'shared.js'), 'utf8') + ';this.P=planBirkatSegments;', ctx);

const NUSACHOT = { ashkenaz: 'נוסח אשכנז', sefard: 'נוסח ספרד', edot: 'נוסח עדות המזרח' };
const REQUIRED = ['shabbat', 'chanukah', 'purim', 'yaaleh-any:rc', 'yaaleh-any:pesach', 'yaaleh-any:sukkot', 'yaaleh-any:rh'];
const HE = { 'shabbat':'רצה (שבת)', 'chanukah':'על הנסים — חנוכה', 'purim':'על הנסים — פורים', 'yaaleh-any:rc':'יעלה ויבוא — ראש חודש',
  'yaaleh-any:pesach':'יעלה ויבוא — פסח', 'yaaleh-any:sukkot':'יעלה ויבוא — סוכות', 'yaaleh-any:rh':'יעלה ויבוא — ראש השנה' };
const read = (dir, k) => { try{ return JSON.parse(fs.readFileSync(path.join(dir, 'birkat-' + k + '.json'), 'utf8')).text; }catch(e){ return null; } };
const signature = segs => ctx.P(segs).filter(Boolean).map(e => e.flag + (e.occ ? ':' + e.occ : ''));

let failed = false;
const lines = [];
for(const [k, name] of Object.entries(NUSACHOT)){
  const oldT = read(oldDir, k), newT = read(newDir, k);
  if(!newT){ lines.push(`- ${name}: ❌ הקובץ החדש חסר או לא תקין`); failed = true; continue; }
  const sNew = signature(newT);
  const missing = REQUIRED.filter(r => !sNew.includes(r));
  if(missing.length){ lines.push(`- ${name}: ❌ לא זוהו בטקסט החדש: ${missing.map(m => HE[m] || m).join(', ')}`); failed = true; continue; }
  if(oldT){
    const sOld = signature(oldT);
    if(JSON.stringify(sOld) !== JSON.stringify(sNew)){
      lines.push(`- ${name}: ⚠️ התוספות שזוהו השתנו (${sOld.length} → ${sNew.length}) — צריך לבדוק ידנית שהתוספות מופיעות נכון`);
      failed = true; continue;
    }
  }
  lines.push(`- ${name}: ✓ כל התוספות מזוהות כמו קודם`);
}
const out = '### בדיקת ברכת המזון\n' + lines.join('\n') + '\n';
console.log(out);
if(process.env.REPORT_FILE) fs.appendFileSync(process.env.REPORT_FILE, '\n' + out);
process.exit(failed ? 1 : 0);
