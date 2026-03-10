// ============================================
// PPL-8 TRAINING PLAN DATA MODEL
// ============================================

const PRE_ACTIVATION = {
    pushPull: {
        title: "Skapulahumerale Rhythmik & Kapsel-Clearance",
        exercises: [
            {
                name: "Serratus Wall Slides (Miniband)", sets: "1x10-12", detail: "2 Sek. Hold oben (Protraktion/Außenrotation).", timer: null,
                guide: "Stelle dich mit dem Gesicht zur Wand. Miniband um die Handgelenke. Hände an der Wand nach oben gleiten lassen, dabei aktiv die Schulterblätter nach vorne drücken (Protraktion). Oben 2 Sekunden halten und Außenrotation erzwingen. Kontrolliert zurück."
            },
            {
                name: "Bottom-Up KB Isometrics", sets: "1x20-30 Sek./Arm", detail: "90° Ellenbogen. Reaktive Kokontraktion der Rotatorenmanschette.", timer: 25,
                guide: "Kettlebell mit dem Boden nach oben halten (Bottom-Up). Ellenbogen auf 90° fixiert. Die Instabilität der KB erzwingt eine reflexive Aktivierung der gesamten Rotatorenmanschette. Schulterblatt aktiv stabilisieren."
            },
            {
                name: "Thoracic Extensions (Foam Roller)", sets: "1x10", detail: "BWS-Extension für sternale/klavikuläre Rekrutierung.", timer: null,
                guide: "Foam Roller quer unter die obere Brustwirbelsäule legen. Hände hinter den Kopf. Über den Roller nach hinten strecken (Extension), dabei den unteren Rücken neutral halten. Nur die BWS bewegt sich. Kontrolliert aufrichten."
            }
        ]
    },
    legs: {
        title: "Becken-Management Frontalebene & ISG-Schutz",
        exercises: [
            {
                name: "Mod. Copenhagen Planks (Knie auf Bank)", sets: "2x15-20 Sek./Seite", detail: "Adduktoren-Isometrik.", timer: 18,
                guide: "Seitlage, oberes Knie auf einer Bank. Unteres Bein hängt frei. Hüfte vom Boden heben und Position halten. Die Adduktoren des oberen Beins arbeiten isometrisch. Becken neutral halten, keine Rotation."
            },
            {
                name: "Banded Glute Bridges", sets: "1x12-15", detail: "3 Sek. Squeeze oben mit Abduktion. Gluteus Medius zur ISG-Neutralisierung.", timer: null,
                guide: "Rückenlage, Miniband über den Knien. Füße hüftbreit. Hüfte heben, oben 3 Sekunden halten und dabei Knie aktiv nach außen drücken (Abduktion gegen das Band). Der Gluteus Medius stabilisiert das ISG gegen Scherkräfte."
            }
        ]
    }
};

const TRAINING_PLAN = {
    cycleA: [
        {
            day: 1, name: "Push A", type: "push",
            subtitle: "Upper Chest, Scapula & Optimized Levers",
            exercises: [
                {
                    id: "a1e1", name: "DB Incline Press", sets: 2, reps: "8-12", tempo: "3-1-1-0", note: "Max. 32kg. 1 Sek. Dead-Stop im tiefen Stretch.",
                    guide: "Bank auf 30-35° einstellen. Dumbbells mit neutralem Griff starten, beim Absenken 3 Sekunden exzentrisch kontrollieren. Im tiefsten Punkt 1 Sekunde Dead-Stop – kein Bounce! Explosiv nach oben drücken. Der Dead-Stop eliminiert den Dehnungsreflex und erzwingt maximale Rekrutierung aus der gestretchten Position."
                },
                {
                    id: "a1e2", name: "Low-to-High Cable Crossovers", sets: 2, reps: "10-12", tempo: null, note: "Pectoralis über die Mittellinie verkürzen.",
                    guide: "Kabelzug tief einstellen. Leichter Vorwärtsschritt. Arme aus der tiefen Position in einer bogenförmigen Bewegung nach oben-innen führen. Hände ÜBER der Mittellinie zusammenführen und dort maximal kontrahieren. Der sternale und klavikuläre Anteil des Pectoralis wird so optimal verkürzt."
                },
                {
                    id: "a1e3", name: "Butterfly Maschine", sets: 2, reps: "8-10", tempo: null, note: "Nach Versagen: Partielle Reps im Stretch (Stretch-Mediated).",
                    guide: "Sitz so einstellen, dass die Griffhöhe auf Brusthöhe ist. Kontrolliert zusammenführen, 1 Sek. Squeeze. Nach dem konzentrischen Versagen: 3-5 partielle Reps im gestretchten Bereich (tiefste 1/3 der ROM). Dies nutzt den Stretch-Mediated Hypertrophy Mechanismus."
                },
                {
                    id: "a1e4", name: "Machine Lateral Raises", sets: 2, reps: "10-12", tempo: null, note: "Krafteinleitung am Ellenbogen zur Hebelreduktion.",
                    guide: "Polster am ELLENBOGEN positionieren, nicht am Handgelenk. Bei 2.00m Körpergröße reduziert dies den Momentenarm erheblich und schützt die Schulter. Kontrolliert heben bis knapp über Schulterhöhe, 1 Sek. halten, langsam senken."
                },
                {
                    id: "a1e5", name: "Overhead Cable Extensions", sets: 2, reps: "10-15/Arm", tempo: null, unilateral: true, note: "Long Head Bias. Einarmig ausführen.",
                    guide: "Rücken zum Kabelzug, Seil hinter dem Kopf. Ellenbogen zeigen nach oben und bleiben fixiert. Unterarme strecken. Die Überkopf-Position bringt den langen Trizepskopf in eine gestreckte Position und maximiert dessen Aktivierung."
                },
                {
                    id: "a1e6", name: "Hanging Leg Raises", sets: 2, reps: "max", tempo: null, note: "Bis technisches Versagen. Kick-Prep.",
                    guide: "An der Klimmzugstange hängen, Schulterblätter aktiv nach unten ziehen. Beine gestreckt nach oben führen (min. 90°). Kein Schwung! Kontrolliert absenken. Bereitet die Hüftflexion und Rumpfstabilität für Kicks vor."
                }
            ]
        },
        {
            day: 2, name: "Pull A", type: "pull",
            subtitle: "Front Lever Prep & Mid-Back Diversification",
            exercises: [
                {
                    id: "a2e1", name: "Tuck Front Lever Holds", sets: 3, reps: "5-10 Sek.", tempo: null, note: "Skill-Work bei frischem ZNS.",
                    guide: "An der Stange hängen, Knie zur Brust ziehen (Tuck-Position). Körper horizontal ausrichten. Schulterblätter nach hinten-unten ziehen. Lats und Core maximal anspannen. Position halten. Wird als erstes bei frischem ZNS trainiert, da es maximale neuronale Ansteuerung erfordert."
                },
                {
                    id: "a2e2", name: "Explosive High Pull-Ups", sets: 4, reps: "3", tempo: null, note: "Nur Körpergewicht. Fokus: RFD / Speed.",
                    guide: "Schulterbreiter Griff. EXPLOSIV nach oben ziehen mit dem Ziel, die Brust über die Stange zu bringen. Maximale Kraftentwicklungsrate (RFD). Kontrolliert absenken. Niedrige Reps, maximale Geschwindigkeit – trainiert die schnelle Kraftentfaltung."
                },
                {
                    id: "a2e3", name: "Straight-Arm Cable Pulldowns", sets: 2, reps: "10-12", tempo: null, note: "Latissimus Sweep (Shortened Position).",
                    guide: "Am Kabelzug stehend, Arme gestreckt. Stange/Seil mit gestreckten Armen nach unten zu den Oberschenkeln ziehen. Lats maximal kontrahieren. Diese Übung trainiert den Lat in der verkürzten Position – wichtig für den V-Taper."
                },
                {
                    id: "a2e4", name: "Chest-Supported Row (breiter Griff)", sets: 2, reps: "8-10", tempo: null, note: "Thoracic Bias (Rhomboiden, Mid-Trap). Technogym.",
                    guide: "Brust auf die Polsterung legen. Breiter Griff. Ellenbogen nach außen führen (ca. 60-70°). Schulterblätter am oberen Punkt maximal zusammenziehen. Der breite Griff und die Ellenbogenrichtung verlagern den Fokus auf Rhomboiden und mittleren Trapezius statt auf die Lats."
                },
                {
                    id: "a2e5", name: "Single-Arm Cable Iliac Pulldown", sets: 2, reps: "10-12/Seite", tempo: null, note: "Fokus auf den V-Taper Cut.",
                    guide: "Einarmig am Kabelzug. Arm gestreckt starten, nach unten Richtung Hüftknochen (Iliac Crest) ziehen. Maximale Lat-Kontraktion am tiefsten Punkt. Unilateral für Symmetrie und intensivere Aktivierung des unteren Lat-Ansatzes."
                },
                {
                    id: "a2e6", name: "Face Pulls", sets: 2, reps: "12-15", tempo: null, note: "Rear Delts.",
                    guide: "Seil am Kabelzug auf Gesichtshöhe. Zum Gesicht ziehen, dabei Hände auseinanderrotieren (Außenrotation). Schulterblätter zusammenziehen. Trainiert hintere Schulter und externe Rotatoren – essentiell für Schultergesundheit."
                }
            ]
        },
        {
            day: 3, name: "Legs A", type: "legs",
            subtitle: "Becken-Management & Unilateral Stability",
            exercises: [
                {
                    id: "a3e1", name: "B-Stance RDLs (DB/Landmine)", sets: 2, reps: "6-8 / 8-10", tempo: null, note: "1x Top-Set, 1x Back-off. Ersetzt Trap Bar – kein ISG-Stress.",
                    guide: "Hauptfuß vorne, hinterer Fuß leicht versetzt (B-Stance). Hüfte nach hinten schieben, Rücken gerade. Dumbbells oder Landmine kontrolliert absenken, maximaler Hamstring-Stretch. Explosiv über Hüftextension aufrichten. Der B-Stance entlastet das ISG im Vergleich zum bilateralen Kreuzheben."
                },
                {
                    id: "a3e2", name: "Kontralaterale Bulgarian Split Squats (DB)", sets: 2, reps: "8-10/Bein", tempo: null, note: "Anti-Rotation fürs Becken.",
                    guide: "Hinterer Fuß erhöht auf Bank. Dumbbell in der GEGENÜBERLIEGENDEN Hand zum vorderen Bein (kontralateral). Dies erzwingt eine Anti-Rotations-Stabilisierung des Beckens. Tief absenken bis Oberschenkel parallel, kontrolliert hochdrücken."
                },
                {
                    id: "a3e3", name: "Technogym Leg Press (Füße tief)", sets: 2, reps: "10-15", tempo: null, note: "Quad Sweep.",
                    guide: "Füße TIEF auf der Plattform positionieren (kaum Ferse auf der Platte). Dies verlagert den Fokus auf den Quadrizeps. Kontrolliert absenken bis 90° Kniebeugung, explosiv drücken. Knie in Zehenrichtung halten."
                },
                {
                    id: "a3e4", name: "Seated Calf Raises", sets: 2, reps: "12-15", tempo: null, note: "Soleus / Achilles-Prep.",
                    guide: "Sitzend, Polster auf den Knien. Im tiefsten Punkt maximale Dehnung der Wade (2 Sek. halten). Explosiv hochdrücken, oben 1 Sek. Squeeze. Der Soleus wird sitzend besser aktiviert als stehend und ist für die Achillessehnen-Gesundheit entscheidend."
                },
                {
                    id: "a3e5", name: "Ab-Wheel Rollouts", sets: 2, reps: "8-12", tempo: null, note: "Anti-Extension.",
                    guide: "Auf den Knien, Ab-Wheel vor dem Körper. Kontrolliert nach vorne rollen, dabei den Core MAXIMAL anspannen um eine Überstreckung der Lendenwirbelsäule zu verhindern (Anti-Extension). Nur so weit rollen, wie die LWS neutral bleibt. Zurückrollen."
                }
            ]
        },
        {
            day: 4, name: "System Rest & GPP", type: "rest",
            subtitle: "Zone 2 Cardio & Recovery",
            exercises: [
                {
                    id: "a4e1", name: "Zone 2 Cardio", sets: 1, reps: "45 Min", tempo: null, noTracking: true, note: "Schwimmen, Klettern oder Radfahren.",
                    guide: "45 Minuten bei moderater Intensität (Zone 2 = Nasenatmung möglich, Unterhaltung möglich). Wähle zwischen Schwimmen, Klettern oder Radfahren. Ziel: Aktive Erholung, Durchblutung fördern, aerobe Basis stärken."
                },
                {
                    id: "a4e2", name: "Sauna & Massagebett", sets: 1, reps: "nach Bedarf", tempo: null, noTracking: true, note: "Paravertebrale Entlastung der LWS.",
                    guide: "Sauna für Durchblutung und Erholung. Massagebett zur Entlastung der paravertebralen Muskulatur entlang der Lendenwirbelsäule. Besonders wichtig bei langen Hebeln und hoher axialer Belastung."
                }
            ]
        }
    ],
    cycleB: [
        {
            day: 5, name: "Push B", type: "push",
            subtitle: "PAP-Effekt & Eccentric Damage",
            exercises: [
                {
                    id: "b5e1", name: "Depth Jumps (Dunk-Prep)", sets: 4, reps: "3", tempo: null, note: "Neural Primer. PAP fernab des Beintrainings.",
                    guide: "Von einer Box (30-50cm) absteigen, sofort maximal hochspringen. MINIMALE Bodenkontaktzeit. Der PAP-Effekt (Post-Activation Potentiation) aktiviert das ZNS für die folgenden Übungen. Bewusst am Push-Tag platziert, nicht am Beintag, um die Beinmuskulatur frisch zu halten."
                },
                {
                    id: "b5e2", name: "Milon Bankdrückmaschine", sets: 2, reps: "All-Out", tempo: null, note: "100% Konz. / 130% Exz. ROM-Restriktion im Stretch!",
                    guide: "WICHTIG: Die Milon-Maschine bietet 130% isokinetische Exzentrik. Das bedeutet, die Maschine drückt in der Absenkphase mit 130% des konzentrischen Gewichts. Du musst diese Last KONTROLLIERT abbremsen. ZWINGEND: ROM 2-3cm vor der anatomischen Endposition stoppen! Niemals in die passive Kapselstruktur crashen. Konzentrisch: maximale Kraft aufbringen."
                },
                {
                    id: "b5e3", name: "Flat DB Press", sets: 2, reps: "8-12", tempo: null, note: "Max. 32kg.",
                    guide: "Flachbank. Dumbbells kontrolliert absenken, leichter Bogen in der Bewegung. Schulterblätter zusammen und nach unten. Explosiv nach oben drücken. Bei 2.00m Körpergröße auf die lange ROM achten – mehr mechanische Arbeit pro Rep."
                },
                {
                    id: "b5e4", name: "Machine Shoulder Press", sets: 2, reps: "8-12", tempo: null, note: "Anterior Bias.",
                    guide: "Maschinendrücken über Kopf. Sitz so einstellen, dass die Griffe auf Schulterhöhe starten. Kontrolliert nach oben drücken, nicht komplett locken. Der anteriore (vordere) Deltamuskel ist der Hauptbeweger."
                },
                {
                    id: "b5e5", name: "Unilateral Cable Pushdowns", sets: 2, reps: "10-15/Arm", tempo: null, unilateral: true, note: "Cross-Body oder Straight. Ellenbogen-Alignment bei 2.00m.",
                    guide: "Einarmig am Kabelzug. Bei 2.00m Körpergröße ist das Ellenbogen-Alignment entscheidend – der Kabelzug muss exakt in Linie mit dem Unterarm sein. Cross-Body oder gerade nach unten. Ersetzt den V-Griff, da unilateral besseres Alignment möglich ist."
                },
                {
                    id: "b5e6", name: "Milon Crunchmaschine", sets: 2, reps: "All-Out", tempo: null, note: "130% Exzentrik.",
                    guide: "Milon Crunchmaschine mit exzentrischer Überladung. Konzentrisch normal crunchen, exzentrisch gegen 130% der Last kontrolliert zurückführen. Der Core muss die erhöhte exzentrische Last stabilisieren."
                }
            ]
        },
        {
            day: 6, name: "Pull B", type: "pull",
            subtitle: "Eccentric Damage & Core Transfer",
            exercises: [
                {
                    id: "b6e1", name: "Milon Rudermaschine", sets: 2, reps: "All-Out", tempo: null, note: "100% Konz. / 130% Exz. Skapula-Retraktion halten!",
                    guide: "Milon-Rudern mit 130% exzentrischer Überladung. Konzentrisch maximal rudern und Schulterblätter zusammenziehen (Retraktion). In der exzentrischen Phase (130%) die Skapula-Retraktion so lange wie möglich HALTEN. Das exzentrische Halten der Retraktion ist der Schlüsselreiz."
                },
                {
                    id: "b6e2", name: "Neutral Grip Pulldowns (Technogym)", sets: 2, reps: "8-10", tempo: null, note: "Lat Width.",
                    guide: "Enger neutraler Griff (Handflächen zueinander). Kontrolliert nach unten ziehen, Ellenbogen eng am Körper. Volle Streckung oben, maximale Kontraktion unten. Der neutrale Griff erlaubt eine größere ROM und schont die Schulter."
                },
                {
                    id: "b6e3", name: "Kelso Shrugs (Chest-Supported)", sets: 2, reps: "10-12", tempo: null, note: "Axial kompressionsfreier Trapezius-Overload.",
                    guide: "Brust auf einer Schrägbank liegend, Dumbbells hängen lassen. Schulterblätter nach oben und zusammen ziehen (Shrug + Retraktion). Da die Wirbelsäule nicht axial belastet wird (Brust liegt auf), kann der Trapezius ohne Kompressionsstress trainiert werden. Bei 2.00m besonders wichtig!"
                },
                {
                    id: "b6e4", name: "Decline Reverse Crunches", sets: 2, reps: "max", tempo: null, note: "4-5 Sek. Exzentrik. LWS-sicher für Front Lever.",
                    guide: "Auf der Negativbank, Hände oben festhalten. Becken maximal zum Brustkorb einrollen (posteriore Beckenrotation). Dann 4-5 Sekunden LANGSAM die Beine absenken (exzentrische Bremsphase). Trainiert die Core-Kontrolle, die für den Front Lever Transfer entscheidend ist, ohne die LWS zu belasten."
                },
                {
                    id: "b6e5", name: "Y-Raises am Kabelzug", sets: 2, reps: "12-15", tempo: null, note: "Lower Trap / Rotatoren.",
                    guide: "Am Kabelzug von unten. Arme in Y-Form nach oben-außen führen. Daumen zeigen nach oben. Aktiviert den unteren Trapezius und die externen Rotatoren. Wichtig für die Schultergesundheit und Skapula-Stabilität."
                }
            ]
        },
        {
            day: 7, name: "Legs B", type: "legs",
            subtitle: "Posterior Chain, Kicks & VO2 Max",
            exercises: [
                {
                    id: "b7e1", name: "Dynamic Mobility (Dr. Wolff / Vibrationspads)", sets: 1, reps: "5-10 Min", tempo: null, noTracking: true, note: "Kick-Prep.",
                    guide: "Dynamische Mobilisierung auf dem Dr. Wolff Dehnbereich oder Vibrationspads. Fokus auf Hüftflexion, -extension und -abduktion. Bereitet die Muskulatur und Faszien auf die explosiven Kick-Bewegungen vor. Keine statischen Dehnungen!"
                },
                {
                    id: "b7e2", name: "Milon Beinbeuger (Seated Leg Curl)", sets: 2, reps: "All-Out", tempo: null, note: "130% Exzentrik. Bremskraft-Aufbau für High Kicks!",
                    guide: "WICHTIGSTE ÜBUNG für Kick-Sicherheit! Die Hamstrings sind der primäre Bremsmechanismus bei High Kicks. 130% exzentrische Überladung stärkt die Hamstrings in ihrer Bremsfunktion und schützt vor Zerrungen. Konzentrisch: maximale Kraft. Exzentrisch: kontrolliert gegen 130% bremsen."
                },
                {
                    id: "b7e3", name: "Milon Beinstrecker", sets: 2, reps: "All-Out", tempo: null, note: "130% Exz. ROM-LIMITIERUNG am tiefsten Punkt!",
                    guide: "⚠️ ACL-SCHUTZ: Die ROM muss am tiefsten Punkt (maximale Kniebeugung) ZWINGEND limitiert werden! Das vordere Kreuzband (ACL) ist in tiefer Kniebeugung unter Last maximal belastet. 2-3cm vor der Endposition stoppen. Konzentrisch volle Extension, exzentrisch 130% kontrolliert abbremsen."
                },
                {
                    id: "b7e4", name: "45-Degree Back Extension", sets: 2, reps: "10-15", tempo: null, note: "Hamstring Lengthened Position.",
                    guide: "Im 45°-Hyperextension-Gerät. Fokus auf die Hamstrings in der GESTRETCHTEN Position (Lengthened). Langsam nach unten, Stretch in den Hamstrings spüren, kontrolliert über die hintere Kette hochdrücken. Kein Überstrecken der LWS!"
                },
                {
                    id: "b7e5", name: "Cable Woodchoppers / Pallof Press", sets: 2, reps: "10-12/Seite", tempo: null, note: "Core-Rotation für Kicks.",
                    guide: "Woodchoppers: Kabelzug von oben nach unten diagonal ziehen mit Rumpfrotation. ODER Pallof Press: Kabel auf Brusthöhe, Arme nach vorne strecken und halten (Anti-Rotation). Beide trainieren die rotatorische Core-Stabilität, die für Kicks essentiell ist."
                },
                {
                    id: "b7e6", name: "VO2 Max Finisher", sets: 4, reps: "4 Min Zone 5 / 3 Min Pause", tempo: null, noTracking: true, note: "Assault Bike ODER Rower. GPP Peak.",
                    guide: "4 Intervalle à 4 Minuten auf dem Assault Bike oder Rudergerät in Zone 5 (nahezu maximale Intensität, Sprechen nicht möglich). 3 Minuten aktive Pause zwischen den Intervallen. Dies ist der GPP-Finisher für maximale kardiovaskuläre Leistung."
                }
            ]
        },
        {
            day: 8, name: "System Rest & Recovery", type: "rest",
            subtitle: "Nährstoff-Timing & ZNS-Entlastung",
            exercises: [
                {
                    id: "b8e1", name: "Totale ZNS-Entlastung", sets: 1, reps: "ganztägig", tempo: null, noTracking: true, note: "Nährstoff-Timing maximieren.",
                    guide: "Vollständiger Ruhetag. Fokus auf Ernährung (Proteinzufuhr, Mikronährstoffe), Schlafqualität und mentale Erholung. Kein Training, kein intensiver Sport. Das ZNS braucht nach 7 Tagen hoher Belastung volle Regeneration."
                }
            ]
        }
    ]
};
