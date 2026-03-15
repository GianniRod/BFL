import { useState, useRef, useEffect } from 'react';
import './GameSimulator.css';

// ── Probability helpers ──
const weightedRandom = (options) => {
    const total = options.reduce((sum, o) => sum + o.weight, 0);
    let r = Math.random() * total;
    for (const opt of options) {
        r -= opt.weight;
        if (r <= 0) return opt.value;
    }
    return options[options.length - 1].value;
};

const randomBetween = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

const chance = (pct) => Math.random() * 100 < pct;

// ── Simulation engine ──
export function simulateGame(localTeamName, visitanteTeamName, isLocalHome, teamRatings) {
    const log = [];
    let localScore = 0;
    let visitanteScore = 0;
    const scoreByQuarter = { local: [0, 0, 0, 0], visitante: [0, 0, 0, 0] };
    const gameClock = [900, 900, 900, 900];
    let quarter = 0;
    let broadcastTime = 0;
    let totalPlays = 0;
    let driveCount = 0;

    const stats = {
        local: { totalYards: 0, passingYards: 0, rushingYards: 0, turnovers: 0, firstDowns: 0, timeOfPossession: 0, drives: 0 },
        visitante: { totalYards: 0, passingYards: 0, rushingYards: 0, turnovers: 0, firstDowns: 0, timeOfPossession: 0, drives: 0 },
    };

    // ── VENTAJA system: offense stars vs opponent defense stars ──
    const localOff = parseFloat(teamRatings?.localOff) || 3;
    const localDef = parseFloat(teamRatings?.localDef) || 3;
    const visitOff = parseFloat(teamRatings?.visitOff) || 3;
    const visitDef = parseFloat(teamRatings?.visitDef) || 3;

    // Calculate advantage for whoever has the ball
    // VENTAJA = Offensive stars of ball carrier - Defensive stars of opponent
    const getVentaja = () => {
        const homeBonus = isLocalHome ? 0.25 : -0.25; // small home field bonus
        if (possession === 'local') return (localOff - visitDef) + homeBonus;
        return (visitOff - localDef) - homeBonus;
    };

    // +3% per point of advantage
    const getAdvPct = () => getVentaja() * 3;

    // Yard multiplier: from 0.80 (-3) to 1.20 (+3), linear
    const getYardMult = () => {
        const v = Math.max(-3, Math.min(3, getVentaja()));
        // -3→0.80, 0→1.00, +3→1.20
        return 1 + (v * 0.0667);
    };

    // Turnover adjustment: base% + modifier
    const getTurnoverAdj = () => {
        const v = getVentaja();
        // +2 or more → -1% turnovers, -2 or less → +1% turnovers
        return -v * 0.5; // per point of advantage
    };
    let twoMinQ2 = false;
    let twoMinQ4 = false;

    let possession = chance(50) ? 'local' : 'visitante';
    let yardLine = 25;
    let down = 1;
    let yardsToGo = 10;
    let drivePlays = 0;
    let driveOver = false;

    const safeQ = () => Math.min(quarter, 3);

    const ordDown = (d) => {
        if (d === 1) return '1st';
        if (d === 2) return '2nd';
        if (d === 3) return '3rd';
        if (d === 4) return '4th';
        return `${d}th`;
    };

    const push = (entry) => {
        log.push({
            ...entry,
            quarter: safeQ() + 1,
            gameClock: gameClock[safeQ()] || 0,
            localScore,
            visitanteScore,
            broadcastTime,
            possession,
            down: entry.down != null ? entry.down : down,
            yardsToGo: entry.yardsToGo != null ? entry.yardsToGo : yardsToGo,
            yardLine: entry.yardLine != null ? entry.yardLine : yardLine
        });
    };

    const flipPoss = (yl) => {
        possession = possession === 'local' ? 'visitante' : 'local';
        yardLine = yl != null ? yl : 25;
        down = 1;
        yardsToGo = 10;
        drivePlays = 0;
        driveCount++;
        stats[possession].drives++;
        driveOver = false;
    };

    const tn = (t) => t === 'local' ? localTeamName : visitanteTeamName;
    const def = (t) => t === 'local' ? 'visitante' : 'local';

    const tick = (s) => {
        gameClock[safeQ()] = Math.max(0, (gameClock[safeQ()] || 0) - s);
        stats[possession].timeOfPossession += s;
    };

    const is2min = () => (gameClock[safeQ()] || 0) <= 120 && (quarter === 1 || quarter === 3);

    const pickPlay = () => {
        if (is2min()) {
            return weightedRandom([
                { value: 'short_pass', weight: 50 },
                { value: 'deep_pass', weight: 35 },
                { value: 'run', weight: 10 },
                { value: 'spike', weight: 5 },
            ]);
        }
        return weightedRandom([
            { value: 'run', weight: 42 },
            { value: 'short_pass', weight: 33 },
            { value: 'deep_pass', weight: 18 },
            { value: 'screen', weight: 4 },
            { value: 'trick', weight: 1 },
            { value: 'sack', weight: 2 },
        ]);
    };

    const doRun = () => {
        const fumbleChance = Math.max(0.5, 1.5 + getTurnoverAdj() * 0.3);
        if (chance(fumbleChance)) return { yards: 0, fumble: true, desc: '¡FUMBLE! Balón suelto recuperado por la defensa' };
        const adv = getAdvPct();
        const mult = getYardMult();
        const y = Math.round(weightedRandom([
            { value: randomBetween(-2, -1), weight: Math.max(1, 8 - adv) },
            { value: randomBetween(0, 2), weight: 30 },
            { value: randomBetween(3, 5), weight: Math.max(1, 35 + adv) },
            { value: randomBetween(6, 10), weight: Math.max(1, 20 + adv * 0.5) },
            { value: randomBetween(11, 20), weight: Math.max(1, 6 + adv * 0.3) },
            { value: randomBetween(21, 40), weight: 1 },
        ]) * mult);
        return { yards: y, desc: `Acarreo por ${y} yardas` };
    };

    const doShort = () => {
        const adv = getAdvPct();
        const mult = getYardMult();
        const intChance = Math.max(0.5, 2 + getTurnoverAdj() * 0.5);
        const r = weightedRandom([
            { value: 'inc', weight: Math.max(1, 35 - adv) },
            { value: 's', weight: Math.max(1, 40 + adv) },
            { value: 'm', weight: Math.max(1, 18 + adv * 0.5) },
            { value: 'l', weight: 5 },
            { value: 'int', weight: Math.max(0.5, intChance) },
        ]);
        if (r === 'inc') return { yards: 0, incomplete: true, desc: 'Pase incompleto' };
        if (r === 'int') return { yards: 0, interception: true, desc: '¡INTERCEPCIÓN!' };
        const rawY = r === 's' ? randomBetween(3, 7) : r === 'm' ? randomBetween(8, 15) : randomBetween(15, 30);
        const y = Math.round(rawY * mult);
        const prefix = r === 'l' ? 'Gran pase completado' : 'Pase completado';
        return { yards: y, desc: `${prefix} por ${y} yardas` };
    };

    const doDeep = () => {
        const pickSixChance = Math.max(0.2, 0.5 + getTurnoverAdj() * 0.15);
        if (chance(pickSixChance)) return { yards: 0, interception: true, pickSix: true, desc: '¡PICK SIX! ¡Intercepción devuelta para touchdown!' };
        const adv = getAdvPct();
        const mult = getYardMult();
        const intChance = Math.max(0.5, 3 + getTurnoverAdj() * 0.5);
        const r = weightedRandom([
            { value: 'inc', weight: Math.max(1, 55 - adv) },
            { value: 'm', weight: Math.max(1, 25 + adv) },
            { value: 'l', weight: Math.max(1, 12 + adv * 0.3) },
            { value: 'd', weight: Math.max(1, 5 + adv * 0.2) },
            { value: 'int', weight: Math.max(0.5, intChance) },
        ]);
        if (r === 'inc') return { yards: 0, incomplete: true, desc: 'Pase profundo incompleto' };
        if (r === 'int') return { yards: 0, interception: true, desc: '¡INTERCEPCIÓN en pase profundo!' };
        const rawY = r === 'm' ? randomBetween(15, 25) : r === 'l' ? randomBetween(25, 40) : randomBetween(40, 70);
        const y = Math.round(rawY * mult);
        const prefix = r === 'd' ? '¡BOMBA! Pase profundo' : r === 'l' ? '¡Gran pase profundo' : 'Pase profundo completado';
        return { yards: y, desc: `${prefix} por ${y} yardas${r === 'l' ? '!' : ''}` };
    };

    const doScreen = () => {
        const mult = getYardMult();
        const rawY = weightedRandom([
            { value: randomBetween(-2, 0), weight: 15 },
            { value: randomBetween(1, 5), weight: 40 },
            { value: randomBetween(6, 12), weight: 30 },
            { value: randomBetween(13, 25), weight: 15 },
        ]);
        const y = Math.round(rawY * mult);
        return { yards: y, desc: `Screen pass por ${y} yardas` };
    };

    const doTrick = () => {
        const adv = getAdvPct();
        if (chance(Math.max(10, 40 + adv))) { const y = randomBetween(15, 50); return { yards: y, desc: `¡Jugada engaño exitosa por ${y} yardas!` }; }
        return { yards: randomBetween(-5, 0), desc: 'Jugada engaño fallida' };
    };

    const doSack = () => {
        const adv = getAdvPct();
        // Stronger defense → worse sacks
        const minLoss = Math.round(Math.max(2, 3 - adv * 0.3));
        const maxLoss = Math.round(Math.max(4, 8 - adv * 0.5));
        const y = -randomBetween(minLoss, maxLoss);
        return { yards: y, desc: `¡SACK! Pérdida de ${Math.abs(y)} yardas` };
    };

    const exec = (pt) => {
        switch (pt) {
            case 'run': return doRun();
            case 'short_pass': return doShort();
            case 'deep_pass': return doDeep();
            case 'screen': return doScreen();
            case 'trick': return doTrick();
            case 'sack': return doSack();
            case 'spike': return { yards: 0, incomplete: true, desc: 'Spike – reloj detenido' };
            default: return { yards: 0, desc: 'Jugada' };
        }
    };

    const decide4th = () => {
        const dist = 100 - yardLine;
        const fgDist = dist + 17;
        if (fgDist <= 60) return 'fg';
        if (yardsToGo <= 2 && yardLine >= 55 && chance(30)) return 'go';
        if (yardLine < 60 && yardsToGo > 3) return chance(85) ? 'punt' : 'go';
        if (yardLine >= 60 && yardsToGo <= 4 && chance(50)) return 'go';
        return 'punt';
    };

    // ── MAIN LOOP ──
    push({ desc: `${tn(possession)} recibe el kickoff`, eventType: 'kickoff' });
    stats[possession].drives++;
    broadcastTime += 30;

    let iter = 0;
    while (quarter < 4 && iter < 800) {
        iter++;

        // Two-minute warnings
        if (quarter === 1 && !twoMinQ2 && (gameClock[1] || 0) <= 120) {
            twoMinQ2 = true;
            push({ desc: 'Two Minute Warning – Segundo Cuarto', eventType: 'two_min' });
            broadcastTime += 110;
        }
        if (quarter === 3 && !twoMinQ4 && (gameClock[3] || 0) <= 120) {
            twoMinQ4 = true;
            push({ desc: 'Two Minute Warning – Cuarto Cuarto', eventType: 'two_min' });
            broadcastTime += 110;
        }

        // Quarter end
        if ((gameClock[safeQ()] || 0) <= 0) {
            if (quarter === 1) {
                push({ desc: 'Medio Tiempo', eventType: 'halftime' });
                broadcastTime += 540;
                quarter = 2;
                flipPoss(25);
                push({ desc: `${tn(possession)} recibe el kickoff de la segunda mitad`, eventType: 'kickoff' });
                broadcastTime += 30;
                quarter = 2;
                continue;
            }
            push({ desc: `Fin del ${quarter + 1}° cuarto`, eventType: 'quarter_end' });
            quarter++;
            if (quarter >= 4) break;
            continue;
        }

        // Turnover on downs
        if (down > 4) {
            push({ desc: 'Turnover on downs', eventType: 'turnover', down: 4, yardsToGo, yardLine });
            const nyl = Math.max(1, Math.min(99, 100 - yardLine));
            if (chance(55)) { push({ desc: 'Pausa comercial', eventType: 'commercial' }); broadcastTime += randomBetween(70, 100); }
            flipPoss(nyl);
            continue;
        }

        // 4th down decision
        if (down === 4 && !driveOver) {
            const dec = decide4th();

            if (dec === 'punt') {
                const py = randomBetween(35, 55);
                const ry = randomBetween(0, 15);
                push({ desc: `Punt de ${py} yardas. Retorno de ${ry} yardas.`, eventType: 'punt', down, yardsToGo, yardLine });
                const nyl = Math.max(1, Math.min(99, 100 - (yardLine + py) + ry));
                tick(randomBetween(5, 8));
                broadcastTime += 55;
                totalPlays++;
                if (chance(55)) { push({ desc: 'Pausa comercial', eventType: 'commercial' }); broadcastTime += randomBetween(70, 100); }
                flipPoss(nyl);
                continue;
            }

            if (dec === 'fg') {
                const fgDist = (100 - yardLine) + 17;
                let pct = fgDist < 30 ? 95 : fgDist <= 40 ? 90 : fgDist <= 50 ? 75 : fgDist <= 60 ? 55 : 20;
                totalPlays++;
                if (chance(pct)) {
                    if (possession === 'local') { localScore += 3; scoreByQuarter.local[safeQ()] += 3; } else { visitanteScore += 3; scoreByQuarter.visitante[safeQ()] += 3; }
                    push({ desc: `¡FIELD GOAL! Gol de campo de ${fgDist} yardas. ¡Es bueno!`, eventType: 'field_goal', down, yardsToGo, yardLine });
                } else {
                    push({ desc: `Field goal fallido de ${fgDist} yardas.`, eventType: 'missed_fg', down, yardsToGo, yardLine });
                }
                tick(randomBetween(4, 7));
                broadcastTime += 60;
                push({ desc: 'Pausa comercial', eventType: 'commercial' });
                broadcastTime += randomBetween(70, 100);
                flipPoss(25);
                continue;
            }
            // 'go' → fall through to normal play
        }

        // Kickoff after scoring
        if (driveOver) {
            driveOver = false;
            flipPoss(25);
            push({ desc: `${tn(possession)} recibe el kickoff`, eventType: 'kickoff' });
            broadcastTime += 30;
            tick(randomBetween(5, 8));
            continue;
        }

        // ── Normal play ──
        const pt = pickPlay();
        const res = exec(pt);
        totalPlays++;
        drivePlays++;

        // Turnovers
        if (res.fumble || res.interception) {
            stats[def(possession)].turnovers++;
            push({ desc: res.desc, eventType: 'turnover', down, yardsToGo, yardLine });

            if (res.pickSix) {
                const dt = def(possession);
                if (dt === 'local') { localScore += 7; scoreByQuarter.local[safeQ()] += 7; } else { visitanteScore += 7; scoreByQuarter.visitante[safeQ()] += 7; }
                push({ desc: `¡PICK SIX TOUCHDOWN para ${tn(dt)}!`, eventType: 'touchdown' });
                broadcastTime += 70;
                push({ desc: 'Pausa comercial', eventType: 'commercial' });
                broadcastTime += randomBetween(70, 100);
                driveOver = true;
            } else {
                tick(randomBetween(5, 10));
                broadcastTime += 40;
                if (chance(55)) { push({ desc: 'Pausa comercial', eventType: 'commercial' }); broadcastTime += randomBetween(70, 100); }
                flipPoss(Math.max(1, Math.min(99, 100 - yardLine)));
            }
            continue;
        }

        // Advance
        if (!res.incomplete) {
            yardLine += res.yards;
            if (pt === 'run') stats[possession].rushingYards += res.yards;
            else stats[possession].passingYards += res.yards;
            stats[possession].totalYards += res.yards;
        }

        // Safety
        if (yardLine <= 0) {
            const dt = def(possession);
            if (dt === 'local') { localScore += 2; scoreByQuarter.local[safeQ()] += 2; } else { visitanteScore += 2; scoreByQuarter.visitante[safeQ()] += 2; }
            push({ desc: `¡SAFETY! 2 puntos para ${tn(dt)}`, eventType: 'safety', down, yardsToGo, yardLine: 0 });
            broadcastTime += 40;
            flipPoss(35);
            continue;
        }

        // Touchdown
        if (yardLine >= 100) {
            if (possession === 'local') { localScore += 7; scoreByQuarter.local[safeQ()] += 7; } else { visitanteScore += 7; scoreByQuarter.visitante[safeQ()] += 7; }
            push({ desc: res.desc, eventType: 'play', down, yardsToGo, yardLine: 100 });
            push({ desc: `¡TOUCHDOWN ${tn(possession)}!`, eventType: 'touchdown' });
            tick(randomBetween(5, 10));
            broadcastTime += 70;
            push({ desc: 'Pausa comercial', eventType: 'commercial' });
            broadcastTime += randomBetween(70, 100);
            driveOver = true;
            continue;
        }

        // Clock consumption
        let clk;
        if (res.incomplete || pt === 'spike') { clk = randomBetween(3, 6); broadcastTime += 22; }
        else if (pt === 'run') { clk = randomBetween(25, 40); broadcastTime += 33; }
        else if (pt === 'sack') { clk = randomBetween(15, 30); broadcastTime += 30; }
        else { clk = randomBetween(15, 35); broadcastTime += 30; }

        if (is2min()) clk = Math.min(clk, randomBetween(10, 15));
        tick(clk);

        // First down check
        yardsToGo -= (res.incomplete ? 0 : res.yards);
        if (yardsToGo <= 0 && !res.incomplete) {
            stats[possession].firstDowns++;
            down = 1;
            yardsToGo = Math.min(10, 100 - yardLine);
            broadcastTime += 5;
            push({ desc: `${res.desc} – PRIMER DOWN`, eventType: 'first_down', down: 1, yardsToGo, yardLine });
        } else {
            down++;
            push({ desc: res.desc, eventType: 'play', down: down - 1, yardsToGo: yardsToGo + (res.incomplete ? 0 : res.yards), yardLine });
        }

        if (totalPlays >= 300) {
            while (quarter <= 4) { gameClock[quarter] = 0; quarter++; }
            break;
        }
    }

    push({ desc: '¡Fin del partido!', eventType: 'game_end' });

    // ── Pre-compute Monte Carlo odds at each log entry ──
    const MC_SIMS = 50;
    const oddsTimeline = [];
    let lastOdds = { local: 50, visit: 50 };
    for (let li = 0; li < log.length; li++) {
        const entry = log[li];
        // Only compute on scoring events, quarter changes, and every ~15 plays
        const isKey = ['touchdown', 'field_goal', 'safety', 'halftime', 'quarter_end', 'game_end'].includes(entry.eventType);
        if (!isKey && li % 15 !== 0 && li !== 0) {
            oddsTimeline.push(lastOdds);
            continue;
        }
        if (entry.eventType === 'game_end') {
            const lw = entry.localScore > entry.visitanteScore ? 100 : entry.localScore < entry.visitanteScore ? 0 : 50;
            lastOdds = { local: lw, visit: 100 - lw };
            oddsTimeline.push(lastOdds);
            continue;
        }
        // Quick Monte Carlo from this state
        let localWins = 0;
        const remainQ = Math.max(0, 4 - (entry.quarter || 1));
        const remainClock = (entry.gameClock || 0) + remainQ * 900;
        for (let s = 0; s < MC_SIMS; s++) {
            const fs = quickSimRemainder(entry.localScore, entry.visitanteScore, remainClock, teamRatings, isLocalHome);
            if (fs.local > fs.visit) localWins++;
            else if (fs.local === fs.visit) localWins += 0.5;
        }
        const lPct = Math.round((localWins / MC_SIMS) * 100);
        lastOdds = { local: lPct, visit: 100 - lPct };
        oddsTimeline.push(lastOdds);
    }

    return { log, localScore, visitanteScore, stats, totalPlays, driveCount, broadcastTime, oddsTimeline, scoreByQuarter };
}

// ── Quick lightweight sim for Monte Carlo (no logging) ──
function quickSimRemainder(lScore, vScore, remainingSeconds, teamRatings, isLocalHome) {
    let localScore = lScore;
    let visitanteScore = vScore;
    let timeLeft = remainingSeconds;
    const localOff = parseFloat(teamRatings?.localOff) || 3;
    const localDef = parseFloat(teamRatings?.localDef) || 3;
    const visitOff = parseFloat(teamRatings?.visitOff) || 3;
    const visitDef = parseFloat(teamRatings?.visitDef) || 3;
    let possession = chance(50) ? 'local' : 'visitante';

    while (timeLeft > 0) {
        const ventaja = possession === 'local'
            ? (localOff - visitDef) + (isLocalHome ? 0.25 : -0.25)
            : (visitOff - localDef) - (isLocalHome ? 0.25 : -0.25);

        const tdPct = Math.max(5, Math.min(45, 22 + ventaja * 3));
        const fgPct = 15;
        const toPct = Math.max(3, Math.min(25, 10 - ventaja * 1.5));
        const driveTime = randomBetween(90, 180);
        const roll = Math.random() * 100;

        if (roll < tdPct) {
            if (possession === 'local') localScore += 7; else visitanteScore += 7;
        } else if (roll < tdPct + fgPct) {
            if (possession === 'local') localScore += 3; else visitanteScore += 3;
        }
        // else: punt or turnover — no score

        timeLeft -= driveTime;
        possession = possession === 'local' ? 'visitante' : 'local';
    }
    return { local: localScore, visit: visitanteScore };
}

// ── Format helpers ──
const ordinalDown = (d) => {
    if (d === 1) return '1st';
    if (d === 2) return '2nd';
    if (d === 3) return '3rd';
    if (d === 4) return '4th';
    return `${d}th`;
};

const fmtClock = (s) => {
    if (s == null || s < 0) s = 0;
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const fmtTime = (s) => {
    if (s == null) return '0m';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

const toDecimalOdds = (pct) => {
    if (pct <= 0) return '∞';
    if (pct >= 100) return '1.00';
    return (100 / pct).toFixed(2);
};

export const parseStarValue = (v) => {
    const num = parseFloat(v) || 0;
    return num > 5 ? num / 10 : num;
};



// ── Event styling ──
const EVT_CLASS = {
    touchdown: 'event-td', field_goal: 'event-fg', turnover: 'event-turnover',
    punt: 'event-punt', safety: 'event-safety', first_down: 'event-first-down',
    two_min: 'event-warning', halftime: 'event-halftime', quarter_end: 'event-quarter',
    kickoff: 'event-kickoff', commercial: 'event-commercial', game_end: 'event-game-end',
    missed_fg: 'event-missed',
};

const EVT_ICON = {
    touchdown: 'TD', field_goal: 'FG', turnover: 'TO', punt: 'P', safety: 'SAF',
    first_down: '1D', two_min: '2M', halftime: 'HT', quarter_end: 'Q',
    kickoff: 'KO', commercial: 'TV', game_end: 'FIN', missed_fg: 'NO',
};

function GameSimulator({ localTeam, visitanteTeam, isLocalHome, onFinish, onClose, readOnlyResult, liveEngine, onStartLive, onSpeedChange, onSkipToEnd, matchDateTime, onSimulateUntil }) {
    const logRef = useRef(null);
    const untilTimeRef = useRef(null);
    const [oddsMode, setOddsMode] = useState('decimal');

    // Determine phase and visible plays based on props
    let phase = 'idle';
    let visiblePlays = [];
    let speed = 1;
    let result = null;

    if (readOnlyResult) {
        phase = 'finished';
        visiblePlays = readOnlyResult.log || [];
        result = readOnlyResult;
    } else if (liveEngine) {
        result = liveEngine.result;
        speed = liveEngine.speed;
        if (liveEngine.currentIndex >= result.log.length) {
            phase = 'finished';
        } else {
            phase = 'simulating';
        }
        visiblePlays = result.log.slice(0, liveEngine.currentIndex + 1);
    }

    // Auto-scroll logic
    useEffect(() => {
        if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    }, [visiblePlays]);

    const startSimulation = () => {
        if (onStartLive) onStartLive();
    };

    const skipToEnd = () => {
        if (onSkipToEnd) onSkipToEnd();
    };

    const handleSpeedChange = (e) => {
        const newSpd = parseInt(e.target.value, 10);
        if (onSpeedChange) onSpeedChange(newSpd);
    };

    const handleSave = () => {
        if (result && onFinish) {
            const scoringPlays = result.log.filter(l =>
                ['touchdown', 'field_goal', 'safety', 'pick_six', 'game_end'].includes(l.eventType)
            );
            onFinish(result.localScore, result.visitanteScore, result.stats, scoringPlays, result.totalPlays, result.driveCount, result.broadcastTime, result.scoreByQuarter);
        }
    };

    const last = visiblePlays.length > 0 ? visiblePlays[visiblePlays.length - 1] : null;

    // Calculate dynamic real elapsed time
    const [realElapsedTime, setRealElapsedTime] = useState(last?.broadcastTime || 0);

    useEffect(() => {
        if (phase === 'simulating' && liveEngine) {
            const timer = setInterval(() => {
                const baseTime = last?.broadcastTime || 0;
                // Calculate how much real time has passed since the last play tick, multiplied by speed
                const timeSinceTick = (Date.now() - liveEngine.lastTickTime) / 1000;
                const interpolatedElapsed = baseTime + (timeSinceTick * liveEngine.speed);
                setRealElapsedTime(Math.floor(interpolatedElapsed));
            }, 100);
            return () => clearInterval(timer);
        } else {
            setRealElapsedTime(last?.broadcastTime || 0);
        }
    }, [phase, liveEngine, last?.broadcastTime]);

    const localS = last ? last.localScore : 0;
    const visitS = last ? last.visitanteScore : 0;
    const curQ = last ? (last.quarter || 1) : 1;
    const curClk = last ? (last.gameClock ?? 900) : 900;

    // Simulate until logic
    const handleSimulateUntilClick = () => {
        const untilTime = untilTimeRef.current?.value;
        if (!untilTime || !matchDateTime) return;
        const baseDate = new Date(matchDateTime);
        const [h, m] = untilTime.split(':').map(Number);
        const targetDate = new Date(baseDate);
        targetDate.setHours(h, m, 0, 0);

        // If target time is earlier than start time, assume it's the next day
        if (targetDate < baseDate) {
            targetDate.setDate(targetDate.getDate() + 1);
        }

        const targetSeconds = (targetDate.getTime() - baseDate.getTime()) / 1000;
        if (targetSeconds > realElapsedTime && onSimulateUntil) {
            onSimulateUntil(targetSeconds);
        }
    };

    const getMinTime = () => {
        if (!matchDateTime) return '';
        const minDate = new Date(new Date(matchDateTime).getTime() + (realElapsedTime * 1000));
        return `${String(minDate.getHours()).padStart(2, '0')}:${String(minDate.getMinutes()).padStart(2, '0')}`;
    };

    const fmtElapsed = (secs) => {
        const h = Math.floor(secs / 3600);
        const m = Math.floor((secs % 3600) / 60);
        const s = Math.floor(secs % 60);
        if (h > 0) return `${h}h ${m.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')}s`;
        return `${m.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')}s`;
    };

    // Get current odds from pre-computed timeline
    const playIdx = visiblePlays.length - 1;
    const currentOdds = result?.oddsTimeline?.[playIdx] || { local: 50, visit: 50 };

    return (
        <div className="sim-overlay" onClick={onClose}>
            <div className="sim-modal" onClick={(e) => e.stopPropagation()}>
                <button className="sim-close" onClick={onClose}>✕</button>

                {/* Scoreboard */}
                <div className="sim-scoreboard">
                    <div className="sim-team-side sim-team-local">
                        {localTeam?.['URL PHOTO'] && <img src={localTeam['URL PHOTO']} alt="" className="sim-team-logo" />}
                        <span className="sim-team-name">
                            {localTeam?.['Team Name'] || 'Local'}
                            {last?.possession === 'local' && phase !== 'finished' && <span className="possession-icon">🏈</span>}
                        </span>
                        {isLocalHome && <span className="sim-home-badge">LOCAL</span>}
                    </div>
                    <div className="sim-score-center">
                        <div className={`sim-score-num ${phase !== 'idle' ? 'sim-score-active' : ''}`}>
                            <span className="sim-score-local">{localS}</span>
                            <span className="sim-score-sep">–</span>
                            <span className="sim-score-visit">{visitS}</span>
                        </div>
                        {phase !== 'idle' && (
                            <div className="sim-quarter-info">
                                <span className="sim-quarter">Q{curQ}</span>
                                <span className="sim-clock">{fmtClock(curClk)}</span>
                            </div>
                        )}
                    </div>
                    <div className="sim-team-side sim-team-visit">
                        {visitanteTeam?.['URL PHOTO'] && <img src={visitanteTeam['URL PHOTO']} alt="" className="sim-team-logo" />}
                        <span className="sim-team-name">
                            {last?.possession === 'visitante' && phase !== 'finished' && <span className="possession-icon">🏈</span>}
                            {visitanteTeam?.['Team Name'] || 'Visitante'}
                        </span>
                        {!isLocalHome && <span className="sim-home-badge">LOCAL</span>}
                    </div>
                </div>

                {/* Quarter indicators */}
                {phase !== 'idle' && (
                    <div className="sim-quarters-bar">
                        {[1, 2, 3, 4].map(q => (
                            <div key={q} className={`sim-q-dot ${q <= curQ ? 'active' : ''} ${q === curQ ? 'current' : ''}`}>Q{q}</div>
                        ))}
                    </div>
                )}

                {/* Live Odds Bar */}
                {phase !== 'idle' && (
                    <div className="sim-odds-bar">
                        <div className="sim-odds-values">
                            <span className="sim-odds-local">
                                {oddsMode === 'decimal' ? toDecimalOdds(currentOdds.local) : `${currentOdds.local}%`}
                            </span>
                            <button className="sim-odds-toggle" onClick={() => setOddsMode(m => m === 'decimal' ? 'pct' : 'decimal')}>
                                {oddsMode === 'decimal' ? '📊 Cuotas' : '% Prob.'}
                            </button>
                            <span className="sim-odds-visit">
                                {oddsMode === 'decimal' ? toDecimalOdds(currentOdds.visit) : `${currentOdds.visit}%`}
                            </span>
                        </div>
                        <div className="sim-odds-track">
                            <div className="sim-odds-fill-local" style={{ width: `${currentOdds.local}%` }} />
                            <div className="sim-odds-fill-visit" style={{ width: `${currentOdds.visit}%` }} />
                        </div>
                    </div>
                )}

                {/* Idle */}
                {phase === 'idle' && (
                    <div className="sim-idle-area">
                        <div className="sim-matchup-vs">VS</div>
                        <button className="sim-start-btn" onClick={startSimulation}>Iniciar Simulación</button>
                    </div>
                )}

                {/* Play-by-play */}
                {phase !== 'idle' && (
                    <div className="sim-log-container">
                        <div className="sim-log-header">
                            <span>Jugada a Jugada</span>
                            <div className="sim-log-controls">
                                {phase === 'simulating' && (
                                    <>
                                        <div className="sim-real-time">
                                            <span>⏱️ T. Real: {fmtElapsed(realElapsedTime)}</span>
                                        </div>
                                        {matchDateTime && (
                                            <div className="sim-until-control">
                                                <input
                                                    type="time"
                                                    className="sim-until-input"
                                                    ref={untilTimeRef}
                                                    defaultValue={getMinTime()}
                                                    min={getMinTime()}
                                                />
                                                <button className="sim-until-btn" onClick={handleSimulateUntilClick}>Simular hasta</button>
                                            </div>
                                        )}
                                        <div className="sim-speed-control">
                                            <span className="sim-speed-label">{speed}x</span>
                                            <input
                                                type="range"
                                                min="1" max="100"
                                                value={speed}
                                                onChange={handleSpeedChange}
                                                className="sim-speed-slider"
                                            />
                                        </div>
                                        <button className="sim-skip-btn" onClick={skipToEnd}>Fin</button>
                                    </>
                                )}
                            </div>
                        </div>
                        <div className="sim-log" ref={logRef}>
                            {visiblePlays.map((play, i) => (
                                <div key={i} className={`sim-play-entry ${EVT_CLASS[play.eventType] || ''} sim-play-fadein`}>
                                    <span className="sim-play-icon">{EVT_ICON[play.eventType] || '▸'}</span>
                                    <div className="sim-play-content">
                                        <div className="sim-play-desc">{play.desc}</div>
                                        {play.down != null && play.eventType !== 'commercial' && play.eventType !== 'halftime' && play.eventType !== 'quarter_end' && play.eventType !== 'game_end' && play.eventType !== 'two_min' && (
                                            <div className="sim-play-meta">{ordinalDown(play.down)} & {play.yardsToGo} | Yd {play.yardLine}</div>
                                        )}
                                    </div>
                                    <div className="sim-play-clock">Q{play.quarter} {fmtClock(play.gameClock)}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Stats */}
                {phase === 'finished' && result && (
                    <div className="sim-stats-panel">
                        <h4 className="sim-stats-title">Estadísticas del Partido</h4>

                        {result.scoreByQuarter && (
                            <div className="sim-quarter-scores">
                                <div className="sq-row sq-header">
                                    <span className="sq-team"></span>
                                    <span>Q1</span><span>Q2</span><span>Q3</span><span>Q4</span><span className="sq-tot">TOT</span>
                                </div>
                                <div className="sq-row">
                                    <span className="sq-team">{localTeam?.['Team Name'] || 'Local'}</span>
                                    {result.scoreByQuarter.local.map((s, i) => <span key={`l${i}`}>{s}</span>)}
                                    <span className="sq-tot">{result.localScore}</span>
                                </div>
                                <div className="sq-row">
                                    <span className="sq-team">{visitanteTeam?.['Team Name'] || 'Visit'}</span>
                                    {result.scoreByQuarter.visitante.map((s, i) => <span key={`v${i}`}>{s}</span>)}
                                    <span className="sq-tot">{result.visitanteScore}</span>
                                </div>
                            </div>
                        )}

                        <div className="sim-stats-grid">
                            <StatRow label="Yardas totales" local={result.stats?.local?.totalYards ?? '-'} visit={result.stats?.visitante?.totalYards ?? '-'} />
                            <StatRow label="Yardas por pase" local={result.stats?.local?.passingYards ?? '-'} visit={result.stats?.visitante?.passingYards ?? '-'} />
                            <StatRow label="Yardas por carrera" local={result.stats?.local?.rushingYards ?? '-'} visit={result.stats?.visitante?.rushingYards ?? '-'} />
                            <StatRow label="Primeros downs" local={result.stats?.local?.firstDowns ?? '-'} visit={result.stats?.visitante?.firstDowns ?? '-'} />
                            <StatRow label="Turnovers" local={result.stats?.local?.turnovers ?? '-'} visit={result.stats?.visitante?.turnovers ?? '-'} neg />
                            <StatRow label="T. de posesión" local={result.stats?.local?.timeOfPossession != null ? fmtTime(result.stats.local.timeOfPossession) : '-'} visit={result.stats?.visitante?.timeOfPossession != null ? fmtTime(result.stats.visitante.timeOfPossession) : '-'} text />
                        </div>
                        <div className="sim-game-info">
                            <span>Total jugadas: {result.totalPlays ?? '-'}</span>
                            <span>Drives: {result.driveCount ?? '-'}</span>
                            <span>Duración TV: {result.broadcastTime != null ? fmtTime(result.broadcastTime) : '-'}</span>
                        </div>
                        {!readOnlyResult && (
                            <button className="sim-save-btn" onClick={handleSave}>Guardar Resultado</button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

function StatRow({ label, local, visit, neg = false, text = false }) {
    const ln = text ? 0 : Number(local);
    const vn = text ? 0 : Number(visit);
    const mx = text ? 1 : Math.max(Math.abs(ln), Math.abs(vn), 1);

    return (
        <div className="sim-stat-row">
            <span className={`sim-stat-val ${!text && !neg && ln > vn ? 'sim-stat-lead' : ''} ${neg && ln > vn ? 'sim-stat-bad' : ''}`}>{local}</span>
            <div className="sim-stat-bar-area">
                {!text && (
                    <div className="sim-stat-bars">
                        <div className="sim-stat-bar sim-bar-local" style={{ width: `${(Math.abs(ln) / mx) * 50}%` }} />
                        <div className="sim-stat-bar sim-bar-visit" style={{ width: `${(Math.abs(vn) / mx) * 50}%` }} />
                    </div>
                )}
                <span className="sim-stat-label">{label}</span>
            </div>
            <span className={`sim-stat-val ${!text && !neg && vn > ln ? 'sim-stat-lead' : ''} ${neg && vn > ln ? 'sim-stat-bad' : ''}`}>{visit}</span>
        </div>
    );
}

export default GameSimulator;
