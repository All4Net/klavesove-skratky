// Databáza otázok kvízu – pôvodný formát (area, q, correct). Pridať otázku = pridať riadok.
const QUESTION_POOL = [
    // Windows
    { area: "Windows", q: "Kopírovať vybratú položku", correct: "Ctrl + C" },
    { area: "Windows", q: "Prilepiť vybratú položku", correct: "Ctrl + V" },
    { area: "Windows", q: "Vystrihnúť vybratú položku", correct: "Ctrl + X" },
    { area: "Windows", q: "Presunúť sa medzi otvorenými programami", correct: "Alt + Tab" },
    { area: "Windows", q: "Označiť celé slová", correct: "Ctrl + Shift + Šípka" },
    { area: "Windows", q: "Vybrať všetky položky v dokumente/okne", correct: "Ctrl + A" },
    { area: "Windows", q: "Presunúť kurzor na začiatok ďalšieho slova", correct: "Ctrl + →" },
    { area: "Windows", q: "Presunúť kurzor na začiatok predošlého slova", correct: "Ctrl + ←" },
    { area: "Windows", q: "Urobiť printscreen", correct: "Win + Shift + S" },

    // Prehliadač
    { area: "Prehliadač", q: "Vytvoriť nový tab", correct: "Ctrl + T" },
    { area: "Prehliadač", q: "Zavrieť aktuálny tab", correct: "Ctrl + W" },
    { area: "Prehliadač", q: "Otvoriť posledný zavretý tab", correct: "Ctrl + Shift + T" },
    { area: "Prehliadač", q: "Presunúť sa na tab vpravo", correct: "Ctrl + Tab" },
    { area: "Prehliadač", q: "Presunúť sa na tab vľavo", correct: "Ctrl + Shift + Tab" },
    { area: "Prehliadač", q: "Otvoriť konkrétny tab podľa poradia", correct: "Ctrl + číslo (1-8)" },
    { area: "Prehliadač", q: "Otvoriť stiahnuté súbory", correct: "Ctrl + J" },
    { area: "Prehliadač", q: "Vyhľadávanie na webovej stránke", correct: "Ctrl + F" },
    { area: "Prehliadač", q: "Obnoviť stránku", correct: "F5" },

    // Total Commander
    { area: "Total Commander", q: "Vytvoriť nový súbor", correct: "Shift + F4" },
    { area: "Total Commander", q: "Kopírovať", correct: "F5" },
    { area: "Total Commander", q: "Presunúť", correct: "F6" },
    { area: "Total Commander", q: "Premenovať", correct: "Shift + F6" },
    { area: "Total Commander", q: "Vytvoriť nový adresár", correct: "F7" },
    { area: "Total Commander", q: "Mazať", correct: "Delete" },
    { area: "Total Commander", q: "Označiť položku", correct: "Insert" },
    { area: "Total Commander", q: "Presunúť sa na posledný súbor v zozname", correct: "End" },
    { area: "Total Commander", q: "Presunúť sa na prvý súbor v zozname", correct: "Home" },
    { area: "Total Commander", q: "Prepnúť medzi ľavým a pravým panelom", correct: "Tab" },

    // Excel
    { area: "Excel", q: "Označiť celú tabuľku", correct: "Ctrl + A" },
    { area: "Excel", q: "Nastaviť tučné písmo", correct: "Ctrl + B" },
    { area: "Excel", q: "Pridať stĺpec/riadok", correct: "Ctrl + plus" },
    { area: "Excel", q: "Odstrániť stĺpec/riadok", correct: "Ctrl + mínus" },
    { area: "Excel", q: "Uložiť dokument", correct: "Ctrl + S" },
    { area: "Excel", q: "Otvoriť dialógové okno Nájsť a nahradiť", correct: "Ctrl + F" },
    { area: "Excel", q: "Otvoriť možnosť Tlačiť", correct: "Ctrl + P" },

    // Ladesk
    { area: "Ladesk", q: "Vyriešiť ticket", correct: "Ctrl + E" },
    { area: "Ladesk", q: "Zatvoriť okno ticketu", correct: "Ctrl + Q" },
    { area: "Ladesk", q: "Odoslať správu", correct: "Ctrl + S" },
    { area: "Ladesk", q: "Odložiť správu", correct: "Ctrl + O" },
    { area: "Ladesk", q: "Zobraziť ťaháky", correct: "Ctrl + Space" },
    { area: "Ladesk", q: "Prechádzať cez otvorené karty ticketov doprava", correct: "Ctrl + ↑" },
    { area: "Ladesk", q: "Prechádzať cez otvorené karty ticketov doľava", correct: "Ctrl + ↓" },
    { area: "Ladesk", q: "Pridanie flagu/značky danému ticketu", correct: "Ctrl + Shift + D" },
    { area: "Ladesk", q: "Preradenie ticketu inému kolegovi", correct: "Ctrl + Shift + X" },
    { area: "Ladesk", q: "Pridanie poznámky ku ticketu", correct: "Ctrl + H" },
    { area: "Ladesk", q: "Odpovedať na ticket", correct: "Ctrl + Shift + Enter" },

];
