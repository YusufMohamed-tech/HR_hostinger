const CITY = {
  ABHA_KHAMIS: "\u0627\u0628\u0647\u0627 - \u062e\u0645\u064a\u0633",
  AL_KHOBAR: "\u0627\u0644\u062e\u0628\u0631",
  AL_KHARJ: "\u0627\u0644\u062e\u0631\u062c",
  AL_MAJMAAH: "\u0627\u0644\u0645\u062c\u0645\u0639\u0647",
  AL_QATIF: "\u0627\u0644\u0642\u0637\u064a\u0641",
  AL_QASSIM: "\u0627\u0644\u0642\u0635\u064a\u0645",
  AL_TAIF: "\u0627\u0644\u0637\u0627\u0626\u0641",
  AMLAJ: "\u0627\u0645\u0644\u062c",
  DAMMAM: "\u0627\u0644\u062f\u0645\u0627\u0645",
  HAIL: "\u062d\u0627\u0626\u0644",
  JAZAN: "\u062c\u0627\u0632\u0627\u0646",
  JAZAN_ABU_ARISH: "\u062c\u0627\u0632\u0627\u0646 ( \u0627\u0628\u0648 \u0639\u0631\u064a\u0634 )",
  JEDDAH: "\u062c\u062f\u0629",
  MADINAH: "\u0627\u0644\u0645\u062f\u064a\u0646\u0629",
  MAKKAH: "\u0645\u0643\u0629",
  RAS_TANURA: "\u0631\u0623\u0633 \u062a\u0646\u0648\u0631\u0629",
  RIYADH: "\u0627\u0644\u0631\u064a\u0627\u0636",
  SAIHAT: "\u0633\u064a\u0647\u0627\u062a",
  TABUK: "\u062a\u0628\u0648\u0643",
};

const ANCHORS = new Map([
  [CITY.ABHA_KHAMIS, { label: "Abha / Khamis Mushait", latitude: 18.2644, longitude: 42.6173 }],
  [CITY.AL_KHOBAR, { label: "Al Khobar", latitude: 26.2172, longitude: 50.1971 }],
  [CITY.AL_KHARJ, { label: "Al Kharj", latitude: 24.1554, longitude: 47.3346 }],
  [CITY.AL_MAJMAAH, { label: "Al Majmaah", latitude: 25.9045, longitude: 45.3454 }],
  [CITY.AL_QATIF, { label: "Qatif", latitude: 26.5652, longitude: 50.0089 }],
  [CITY.AL_QASSIM, { label: "Al Qassim", latitude: 26.3592, longitude: 43.9818 }],
  [CITY.AL_TAIF, { label: "Taif", latitude: 21.4373, longitude: 40.5127 }],
  [CITY.AMLAJ, { label: "Umluj", latitude: 25.0213, longitude: 37.2685 }],
  [CITY.DAMMAM, { label: "Dammam", latitude: 26.4207, longitude: 50.0888 }],
  [CITY.HAIL, { label: "Hail", latitude: 27.5114, longitude: 41.7208 }],
  [CITY.JAZAN, { label: "Jazan", latitude: 16.8892, longitude: 42.5511 }],
  [CITY.JAZAN_ABU_ARISH, { label: "Abu Arish", latitude: 16.9689, longitude: 42.8325 }],
  [CITY.JEDDAH, { label: "Jeddah", latitude: 21.4858, longitude: 39.1925 }],
  [CITY.MADINAH, { label: "Madinah", latitude: 24.5247, longitude: 39.5692 }],
  [CITY.MAKKAH, { label: "Makkah", latitude: 21.3891, longitude: 39.8579 }],
  [CITY.RAS_TANURA, { label: "Ras Tanura", latitude: 26.7236, longitude: 50.0608 }],
  [CITY.RIYADH, { label: "Riyadh", latitude: 24.7136, longitude: 46.6753 }],
  [CITY.SAIHAT, { label: "Saihat", latitude: 26.4852, longitude: 50.0405 }],
  [CITY.TABUK, { label: "Tabuk", latitude: 28.3835, longitude: 36.5662 }],
]);

const CITY_KEYWORDS = [
  [CITY.JAZAN_ABU_ARISH, CITY.JAZAN_ABU_ARISH],
  [CITY.ABHA_KHAMIS, CITY.ABHA_KHAMIS],
  [CITY.AL_KHOBAR, CITY.AL_KHOBAR],
  [CITY.AL_KHARJ, CITY.AL_KHARJ],
  [CITY.AL_MAJMAAH, CITY.AL_MAJMAAH],
  [CITY.AL_QATIF, CITY.AL_QATIF],
  [CITY.AL_QASSIM, CITY.AL_QASSIM],
  [CITY.AL_TAIF, CITY.AL_TAIF],
  [CITY.AMLAJ, CITY.AMLAJ],
  [CITY.DAMMAM, CITY.DAMMAM],
  [CITY.HAIL, CITY.HAIL],
  [CITY.JAZAN, CITY.JAZAN],
  [CITY.JEDDAH, CITY.JEDDAH],
  [CITY.MADINAH, CITY.MADINAH],
  [CITY.MAKKAH, CITY.MAKKAH],
  [CITY.RAS_TANURA, CITY.RAS_TANURA],
  [CITY.RIYADH, CITY.RIYADH],
  [CITY.SAIHAT, CITY.SAIHAT],
  [CITY.TABUK, CITY.TABUK],
  ["\u0635\u0627\u0631\u064a", CITY.JEDDAH],
  ["\u0627\u0644\u062d\u0645\u062f\u0627\u0646\u064a\u0629", CITY.JEDDAH],
  ["\u0627\u0644\u0633\u0646\u0627\u0628\u0644", CITY.JEDDAH],
  ["\u0627\u0644\u0641\u064a\u0635\u0644\u064a\u0629", CITY.JEDDAH],
  ["\u0627\u0644\u0639\u0644\u064a\u0627", CITY.RIYADH],
  ["\u0645\u062f\u064a\u0646\u0629 \u0627\u0644\u0643\u0645\u0628\u064a\u0648\u062a\u0631", CITY.RIYADH],
  ["\u0645\u062c\u0645\u0639 \u0627\u0644\u0643\u0645\u0628\u064a\u0648\u062a\u0631", CITY.RIYADH],
  ["\u0627\u0644\u0645\u0646\u0627\u0631", CITY.RIYADH],
];

function normalize(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\u0649/g, "\u064a")
    .replace(/\u0623|\u0625|\u0622/g, "\u0627");
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value || "")) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function unitFromHash(seed, salt) {
  return (stableHash(`${seed}:${salt}`) % 1000000) / 1000000;
}

function roundCoordinate(value) {
  return Number(value.toFixed(6));
}

function anchorForLocation(location) {
  const city = normalize(location?.city);
  if (ANCHORS.has(city)) return { city, anchor: ANCHORS.get(city) };

  const searchable = normalize(`${location?.name || ""} ${location?.site_name || ""} ${location?.region || ""}`);
  for (const [keyword, targetCity] of CITY_KEYWORDS) {
    if (searchable.includes(normalize(keyword))) {
      return { city: targetCity, anchor: ANCHORS.get(targetCity) };
    }
  }

  return { city: CITY.RIYADH, anchor: ANCHORS.get(CITY.RIYADH) };
}

export function coordinatesForLocation(location) {
  const { city, anchor } = anchorForLocation(location || {});
  const seed = `${location?.name || ""}|${location?.site_name || ""}|${city}`;
  const angle = unitFromHash(seed, "angle") * Math.PI * 2;
  const distanceKm = 0.35 + unitFromHash(seed, "distance") * 6.75;
  const latitudeOffset = (Math.cos(angle) * distanceKm) / 111.32;
  const longitudeOffset = (Math.sin(angle) * distanceKm) / (111.32 * Math.cos((anchor.latitude * Math.PI) / 180));

  return {
    city,
    city_label: anchor.label,
    latitude: roundCoordinate(anchor.latitude + latitudeOffset),
    longitude: roundCoordinate(anchor.longitude + longitudeOffset),
  };
}

export function hasCoordinates(location) {
  if (!location) return false;
  const hasLatitude = location.latitude !== null && location.latitude !== undefined && location.latitude !== "";
  const hasLongitude = location.longitude !== null && location.longitude !== undefined && location.longitude !== "";
  return hasLatitude && hasLongitude && Number.isFinite(Number(location.latitude)) && Number.isFinite(Number(location.longitude));
}
