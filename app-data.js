(function () {
  const API = (location.hostname === "127.0.0.1" || location.hostname === "localhost")
    ? "/api"
    : "https://api.transitous.org/api";
  const UA_NOTE = "TbilisiTransitUI/1.0";

  const PRESETS = {
    freedom: { name: "Freedom Square", nameKa: "თავისუფლების მოედანი", lat: 41.692738, lon: 44.802055, id: "ge-tbilisi-transport-company_1:3639", type: "STOP" },
    station: { name: "Station Square", nameKa: "სადგურის მოედანი", lat: 41.7221, lon: 44.797737, id: "ge-tbilisi-transport-company_1:metro_1_8", type: "STOP" },
  };

  const I18N = {
    en: {
      title: "Tbilisi Transit",
      subtitle: "Trip planner · Transitous",
      from: "From",
      to: "To",
      go: "Leave now",
      swap: "Swap",
      searching: "Searching…",
      planning: "Planning…",
      noResults: "No itineraries found. Try different stops.",
      pickBoth: "Pick From and To from the suggestions (or use a preset).",
      error: "Something went wrong.",
      duration: "min",
      transfers0: "Direct",
      transfers1: "1 transfer",
      transfersN: (n) => n + " transfers",
      live: "Live",
      scheduled: "Scheduled",
      walk: "Walk",
      bus: "Bus",
      metro: "Metro",
      gondola: "Gondola",
      toStop: "to",
      for: "for",
      presetFS: "Freedom Square → Station Square",
      presetSF: "Station Square → Freedom Square",
      footer: 'Data via <a href="https://transitous.org/" target="_blank" rel="noopener">Transitous</a> · sources: <a href="https://transitous.org/sources/" target="_blank" rel="noopener">transitous.org/sources</a> · times Asia/Tbilisi',
    },
    ka: {
      title: "თბილისის ტრანსპორტი",
      subtitle: "მარშრუტის დაგეგმვა · Transitous",
      from: "საიდან",
      to: "სადამდე",
      go: "გასვლა ახლა",
      swap: "შეცვლა",
      searching: "ძებნა…",
      planning: "დაგეგმვა…",
      noResults: "მარშრუტი ვერ მოიძებნა.",
      pickBoth: "აირჩიეთ საიდან და სადამდე (ან გამოიყენეთ პრესეტი).",
      error: "შეცდომა მოხდა.",
      duration: "წთ",
      transfers0: "პირდაპირი",
      transfers1: "1 გადასვლა",
      transfersN: (n) => n + " გადასვლა",
      live: "ცოცხალი",
      scheduled: "განრიგი",
      walk: "ფეხით",
      bus: "ავტობუსი",
      metro: "მეტრო",
      gondola: "გონდოლა",
      toStop: "მდე",
      for: "",
      presetFS: "თავისუფლების მოედანი → სადგურის მოედანი",
      presetSF: "სადგურის მოედანი → თავისუფლების მოედანი",
      footer: 'მონაცემები: <a href="https://transitous.org/" target="_blank" rel="noopener">Transitous</a> · წყაროები: <a href="https://transitous.org/sources/" target="_blank" rel="noopener">transitous.org/sources</a> · დრო Asia/Tbilisi',
    },
  };

  window.TT = { API, UA_NOTE, PRESETS, I18N };
})();
