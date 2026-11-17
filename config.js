// Nastavenia Light verzie (ročné preskúšanie). Otázky sú v questions.js.
// Light verzia je samostatná: nepoužíva žiadnu tabuľku ani server, výsledok sa zobrazí len na obrazovke.
window.APP_CONFIG = {
  RESULTS_URL: '',        // bez tabuľky
  STANDALONE: true,       // meno sa píše ručne, časy sa len zadávajú

  PRACTICAL_LIMIT: 300,   // praktický test: pod 5 min
  FINAL_TEST: false,      // žiadny záverečný test
  QUIZ_TEST: false,       // žiadny kvíz
  MODE_SWITCH: false,     // jediný režim
  MANUAL_TIMES: true,     // školiteľ meria na vlastných stopkách a časy po aplikáciách zapíše
  CTA_LABEL: 'Začať test',   // tlačidlo na úvode
  CTA_TARGET: 'practice'     // vedie rovno na praktický test
};
