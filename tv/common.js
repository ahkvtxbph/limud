/* Shared by the TV board (/tv/) and its admin page (/tv/admin.html): the places to choose from.
   Jerusalem and Tel Aviv first, the rest in alphabetical order. */
const TV_CITIES = (function(){
  const first = [{ name: 'ירושלים', lat: 31.7683, lon: 35.2137 }, { name: 'תל אביב', lat: 32.0853, lon: 34.7818 }];
  const rest = [
    { name: 'חיפה', lat: 32.7940, lon: 34.9896 }, { name: 'באר שבע', lat: 31.2518, lon: 34.7913 },
    { name: 'בני ברק', lat: 32.0807, lon: 34.8338 }, { name: 'פתח תקווה', lat: 32.0840, lon: 34.8878 },
    { name: 'בית שמש', lat: 31.7470, lon: 34.9881 }, { name: 'מודיעין עילית', lat: 31.9333, lon: 35.0417 },
    { name: 'ביתר עילית', lat: 31.6960, lon: 35.1150 }, { name: 'אלעד', lat: 32.0522, lon: 34.9511 },
    { name: 'אשדוד', lat: 31.8044, lon: 34.6553 }, { name: 'נתניה', lat: 32.3215, lon: 34.8532 },
    { name: 'ראשון לציון', lat: 31.9730, lon: 34.7925 }, { name: 'רחובות', lat: 31.8928, lon: 34.8113 },
    { name: 'מודיעין', lat: 31.8980, lon: 35.0104 }, { name: 'צפת', lat: 32.9646, lon: 35.4960 },
    { name: 'טבריה', lat: 32.7922, lon: 35.5312 }, { name: 'אשקלון', lat: 31.6688, lon: 34.5743 },
    { name: 'קרית גת', lat: 31.6100, lon: 34.7642 }, { name: 'אילת', lat: 29.5577, lon: 34.9519 },
    { name: 'נתיבות', lat: 31.4231, lon: 34.5886 }, { name: 'כפר מימון', lat: 31.4436, lon: 34.5414 },
    { name: 'תושיה', lat: 31.4296, lon: 34.5321 }
  ];
  rest.sort((a, b) => a.name.localeCompare(b.name, 'he'));
  return first.concat(rest);
})();
