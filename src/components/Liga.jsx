import { useEffect, useState, useRef } from 'react';
import { subscribeToTeams } from '../services/db';
import { db } from '../firebase';
import { doc, setDoc, onSnapshot } from 'firebase/firestore';
import './Liga.css';
import GameSimulator, { simulateGame, parseStarValue } from './GameSimulator';

const YEARS = [2024, 2025, 2026];

const TIME_SLOTS = [
    { day: 'friday', hour: 13, minute: 0, label: 'VIE 13:00' },
    { day: 'friday', hour: 16, minute: 0, label: 'VIE 16:00' },
    { day: 'friday', hour: 19, minute: 0, label: 'VIE 19:00' },
    { day: 'saturday', hour: 11, minute: 0, label: 'SÁB 11:00' },
    { day: 'saturday', hour: 14, minute: 0, label: 'SÁB 14:00' },
    { day: 'saturday', hour: 17, minute: 0, label: 'SÁB 17:00' },
];

function Liga() {
    const [selectedYear, setSelectedYear] = useState(2026);
    const [leagueTeams, setLeagueTeams] = useState([]);
    const [standings, setStandings] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showConfig, setShowConfig] = useState(false);
    const [allTeams, setAllTeams] = useState([]);
    const [fechas, setFechas] = useState([]);
    const [selectedFechaIndex, setSelectedFechaIndex] = useState(null);
    const [showFechaDropdown, setShowFechaDropdown] = useState(false);
    const [positionLabels, setPositionLabels] = useState([]);
    const [showCalendarModal, setShowCalendarModal] = useState(false);
    const [calendarStartDate, setCalendarStartDate] = useState('');
    const [simulatingPartido, setSimulatingPartido] = useState(null); // { fechaId, partidoId }

    // Background Live Simulations
    const activeSimsRef = useRef({});
    const [liveMatchesUI, setLiveMatchesUI] = useState({});

    // Subscribe to all teams
    useEffect(() => {
        const unsubscribe = subscribeToTeams((data) => {
            setAllTeams(data);
            setLoading(false);
        });
        return () => unsubscribe();
    }, []);

    // Subscribe to league config for selected year
    useEffect(() => {
        const docRef = doc(db, 'leagueConfig', String(selectedYear));
        const unsubscribe = onSnapshot(docRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                setLeagueTeams(data.teamIds || []);
                setStandings(data.standings || []);
                setFechas(data.fechas || []);
                setPositionLabels(data.positionLabels || []);
            } else {
                setLeagueTeams([]);
                setStandings([]);
                setFechas([]);
                setPositionLabels([]);
            }
        });
        return () => unsubscribe();
    }, [selectedYear]);

    // Keep a fresh reference to updatePartidoBothScores to avoid stale closures in setInterval
    const updatePartidoBothScoresRef = useRef(null);

    // Set selected fecha to the last one when fechas change
    useEffect(() => {
        if (fechas.length > 0 && selectedFechaIndex === null) {
            setSelectedFechaIndex(fechas.length - 1);
        }
    }, [fechas, selectedFechaIndex]);

    // ── Live Simulation Engine (Centralized Ticker) ──
    const updateLiveUI = () => {
        const newState = {};
        Object.entries(activeSimsRef.current).forEach(([pid, sim]) => {
            const play = sim.result.log[Math.min(sim.currentIndex, sim.result.log.length - 1)];
            if (play) {
                newState[pid] = {
                    localScore: play.localScore,
                    visitanteScore: play.visitanteScore,
                    quarter: play.quarter,
                    clock: play.gameClock,
                    possession: play.possession,
                    speed: sim.speed,
                    isActive: true
                };
            }
        });
        setLiveMatchesUI(newState);
    };

    useEffect(() => {
        const ticker = setInterval(() => {
            const now = Date.now();
            let hasChanges = false;
            let finishedMatches = [];

            Object.entries(activeSimsRef.current).forEach(([pid, sim]) => {
                if (sim.currentIndex >= sim.result.log.length) {
                    finishedMatches.push({ pid, sim });
                    return;
                }

                const currentPlay = sim.result.log[sim.currentIndex];
                const nextPlay = sim.result.log[sim.currentIndex + 1];

                if (nextPlay) {
                    let diff = (nextPlay.broadcastTime || 0) - (currentPlay.broadcastTime || 0);
                    if (diff < 1 || isNaN(diff)) diff = 5;
                    const requiredDelayMs = (diff * 1000) / sim.speed;

                    if (now - sim.lastTickTime >= requiredDelayMs) {
                        sim.currentIndex++;
                        sim.lastTickTime = now;
                        hasChanges = true;
                    }
                } else {
                    sim.currentIndex++;
                    hasChanges = true;
                }
            });

            finishedMatches.forEach(({ pid, sim }) => {
                delete activeSimsRef.current[pid];
                const r = sim.result;
                const scoringPlays = r.log.filter(l =>
                    ['touchdown', 'field_goal', 'safety', 'pick_six', 'game_end'].includes(l.eventType)
                );

                if (updatePartidoBothScoresRef.current) {
                    updatePartidoBothScoresRef.current(
                        sim.fechaId, Number(pid), String(r.localScore), String(r.visitanteScore),
                        r.stats, scoringPlays, r.totalPlays, r.driveCount, r.broadcastTime, r.scoreByQuarter
                    );
                }

                // If this match is currently open in the GameSimulator, update it to readOnly mode
                setSimulatingPartido(prev => {
                    if (prev && prev.partidoId === Number(pid)) {
                        return { ...prev, readOnly: true };
                    }
                    return prev;
                });

                hasChanges = true;
            });

            if (hasChanges) {
                updateLiveUI();
            }
        }, 100);

        return () => clearInterval(ticker);
    }, []);

    const startLiveSimulation = (fechaId, partidoId, localTeam, visitanteTeam) => {
        const result = simulateGame(
            localTeam?.['Team Name'] || 'Local',
            visitanteTeam?.['Team Name'] || 'Visitante',
            true,
            {
                localOff: parseStarValue(localTeam?.['Offensive Stars'] || 3),
                localDef: parseStarValue(localTeam?.['Deffensive Stars'] || 3),
                visitOff: parseStarValue(visitanteTeam?.['Offensive Stars'] || 3),
                visitDef: parseStarValue(visitanteTeam?.['Deffensive Stars'] || 3),
            }
        );
        activeSimsRef.current[partidoId] = {
            fechaId,
            result,
            currentIndex: 0,
            speed: 1,
            lastTickTime: Date.now()
        };
        updateLiveUI();
    };

    // ── Auto-Simulate Headless (Background) ──
    useEffect(() => {
        const intervalId = setInterval(() => {
            const now = new Date();

            fechas.forEach(fecha => {
                fecha.partidos.forEach(partido => {
                    // Solo simular si tiene fecha programada menor o igual a AHORA, y los scores son nulos
                    if (partido.dateTime && partido.localScore === null && partido.visitanteScore === null) {
                        const matchDate = new Date(partido.dateTime);
                        if (matchDate <= now) {
                            const localT = allTeams.find(t => t.id === partido.localId);
                            const visitanteT = allTeams.find(t => t.id === partido.visitanteId);

                            if (localT && visitanteT) {
                                console.log(`[BFL Auto-Sim] Ejecutando: ${localT['Team Name']} vs ${visitanteT['Team Name']}`);

                                // Simular offline toda la partida al instante
                                const result = simulateGame(
                                    localT['Team Name'] || 'Local',
                                    visitanteT['Team Name'] || 'Visitante',
                                    true, // isLocalHome
                                    {
                                        localOff: parseStarValue(localT['Offensive Stars'] || 3),
                                        localDef: parseStarValue(localT['Deffensive Stars'] || 3),
                                        visitOff: parseStarValue(visitanteT['Offensive Stars'] || 3),
                                        visitDef: parseStarValue(visitanteT['Deffensive Stars'] || 3),
                                    }
                                );

                                const scoringPlays = result.log.filter(l =>
                                    ['touchdown', 'field_goal', 'safety', 'pick_six', 'game_end'].includes(l.eventType)
                                );

                                // Guardar el resultado en la misma DB
                                updatePartidoBothScores(
                                    fecha.id,
                                    partido.id,
                                    String(result.localScore),
                                    String(result.visitanteScore),
                                    result.stats,
                                    scoringPlays,
                                    result.totalPlays,
                                    result.driveCount,
                                    result.broadcastTime,
                                    result.scoreByQuarter
                                );
                            }
                        }
                    }
                });
            });
        }, 15000); // Chequear cada 15 segundos

        return () => clearInterval(intervalId);
    }, [fechas, allTeams]);

    // ── Team Management ──

    const toggleTeamInLeague = async (teamId) => {
        const newTeamIds = leagueTeams.includes(teamId)
            ? leagueTeams.filter(id => id !== teamId)
            : [...leagueTeams, teamId];

        const docRef = doc(db, 'leagueConfig', String(selectedYear));
        await setDoc(docRef, {
            teamIds: newTeamIds,
            standings: standings.filter(s => newTeamIds.includes(s.teamId))
        }, { merge: true });
    };

    // ── Standings Management ──

    const updateStanding = async (teamId, field, value) => {
        const existingStanding = standings.find(s => s.teamId === teamId);
        const updatedStanding = {
            teamId,
            v: 0, p: 0, pf: 0, pc: 0, lastResults: [],
            ...existingStanding,
            [field]: field === 'lastResults' ? value : (parseInt(value) || 0)
        };

        const totalGames = updatedStanding.v + updatedStanding.p;
        updatedStanding.pct = totalGames > 0 ? (updatedStanding.v / totalGames).toFixed(3) : '0.000';
        updatedStanding.np = updatedStanding.pf - updatedStanding.pc;

        const newStandings = standings.filter(s => s.teamId !== teamId);
        newStandings.push(updatedStanding);

        const docRef = doc(db, 'leagueConfig', String(selectedYear));
        await setDoc(docRef, { standings: newStandings }, { merge: true });
    };

    const addResult = async (teamId, result) => {
        const existingStanding = standings.find(s => s.teamId === teamId) || { lastResults: [] };
        const currentResults = existingStanding.lastResults || [];
        const newResults = [...currentResults, result].slice(-5);
        await updateStanding(teamId, 'lastResults', newResults);
    };

    const clearResults = async (teamId) => {
        await updateStanding(teamId, 'lastResults', []);
    };

    // ── Fechas (match days) Management ──

    const addFecha = async () => {
        const newFecha = {
            id: Date.now(),
            nombre: `Fecha ${fechas.length + 1}`,
            partidos: []
        };
        const newFechas = [...fechas, newFecha];
        const docRef = doc(db, 'leagueConfig', String(selectedYear));
        await setDoc(docRef, { fechas: newFechas }, { merge: true });
    };

    const removeFecha = async (fechaId) => {
        const newFechas = fechas.filter(f => f.id !== fechaId);
        const docRef = doc(db, 'leagueConfig', String(selectedYear));
        await setDoc(docRef, { fechas: newFechas }, { merge: true });
    };

    const updateFechaNombre = async (fechaId, nombre) => {
        const newFechas = fechas.map(f =>
            f.id === fechaId ? { ...f, nombre } : f
        );
        const docRef = doc(db, 'leagueConfig', String(selectedYear));
        await setDoc(docRef, { fechas: newFechas }, { merge: true });
    };

    const addPartido = async (fechaId, localId, visitanteId, dateTime = null) => {
        const newPartido = {
            id: Date.now(),
            localId,
            visitanteId,
            localScore: null,
            visitanteScore: null,
            dateTime
        };
        const newFechas = fechas.map(f =>
            f.id === fechaId ? { ...f, partidos: [...f.partidos, newPartido] } : f
        );
        const docRef = doc(db, 'leagueConfig', String(selectedYear));
        await setDoc(docRef, { fechas: newFechas }, { merge: true });
    };

    const removePartido = async (fechaId, partidoId) => {
        const newFechas = fechas.map(f =>
            f.id === fechaId ? { ...f, partidos: f.partidos.filter(p => p.id !== partidoId) } : f
        );
        const docRef = doc(db, 'leagueConfig', String(selectedYear));
        await setDoc(docRef, { fechas: newFechas }, { merge: true });
    };

    const updatePartidoScore = async (fechaId, partidoId, field, value) => {
        const newFechas = fechas.map(f =>
            f.id === fechaId ? {
                ...f,
                partidos: f.partidos.map(p =>
                    p.id === partidoId ? { ...p, [field]: value === '' ? null : parseInt(value) } : p
                )
            } : f
        );
        const docRef = doc(db, 'leagueConfig', String(selectedYear));
        await setDoc(docRef, { fechas: newFechas }, { merge: true });
    };

    const updatePartidoBothScores = async (fechaId, partidoId, localScore, visitanteScore, stats, scoringPlays, totalPlays, driveCount, broadcastTime, scoreByQuarter) => {
        const newFechas = fechas.map(f =>
            f.id === fechaId ? {
                ...f,
                partidos: f.partidos.map(p =>
                    p.id === partidoId ? {
                        ...p,
                        localScore: localScore === '' ? null : parseInt(localScore),
                        visitanteScore: visitanteScore === '' ? null : parseInt(visitanteScore),
                        stats: stats || p.stats || null,
                        scoringPlays: scoringPlays || p.scoringPlays || null,
                        totalPlays: totalPlays || p.totalPlays || null,
                        driveCount: driveCount || p.driveCount || null,
                        broadcastTime: broadcastTime || p.broadcastTime || null,
                        scoreByQuarter: scoreByQuarter || p.scoreByQuarter || null
                    } : p
                )
            } : f
        );
        const docRef = doc(db, 'leagueConfig', String(selectedYear));
        await setDoc(docRef, { fechas: newFechas }, { merge: true });
    };

    useEffect(() => {
        updatePartidoBothScoresRef.current = updatePartidoBothScores;
    }, [updatePartidoBothScores]);

    const updatePartidoDateTime = async (fechaId, partidoId, dateTime) => {
        const newFechas = fechas.map(f =>
            f.id === fechaId ? {
                ...f,
                partidos: f.partidos.map(p =>
                    p.id === partidoId ? { ...p, dateTime } : p
                )
            } : f
        );
        const docRef = doc(db, 'leagueConfig', String(selectedYear));
        await setDoc(docRef, { fechas: newFechas }, { merge: true });
    };

    const movePartido = async (fechaId, partidoIndex, direction) => {
        const newFechas = fechas.map(f => {
            if (f.id !== fechaId) return f;
            const newPartidos = [...f.partidos];
            const newIndex = partidoIndex + direction;
            if (newIndex < 0 || newIndex >= newPartidos.length) return f;
            [newPartidos[partidoIndex], newPartidos[newIndex]] = [newPartidos[newIndex], newPartidos[partidoIndex]];
            return { ...f, partidos: newPartidos };
        });
        const docRef = doc(db, 'leagueConfig', String(selectedYear));
        await setDoc(docRef, { fechas: newFechas }, { merge: true });
    };

    // ── Position Labels Management ──

    const savePositionLabels = async (newLabels) => {
        const docRef = doc(db, 'leagueConfig', String(selectedYear));
        await setDoc(docRef, { positionLabels: newLabels }, { merge: true });
    };

    const addPositionLabel = () => {
        const newLabels = [...positionLabels, { name: '', color: '#4caf50', fromPos: 1, toPos: 1 }];
        savePositionLabels(newLabels);
    };

    const removePositionLabel = (index) => {
        const newLabels = positionLabels.filter((_, i) => i !== index);
        savePositionLabels(newLabels);
    };

    const updatePositionLabel = (index, field, value) => {
        const newLabels = positionLabels.map((label, i) =>
            i === index ? { ...label, [field]: (field === 'fromPos' || field === 'toPos') ? (parseInt(value) || 1) : value } : label
        );
        savePositionLabels(newLabels);
    };

    // ── Automatic Calendar Generation ──

    const generateCalendar = async () => {
        if (!calendarStartDate) return;

        const teams = [...leagueTeams];
        const n = teams.length;

        if (n < 2 || n % 2 !== 0) {
            alert('Se necesita un número par de equipos (mínimo 2).');
            return;
        }

        // Shuffle teams for random assignment
        for (let i = teams.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [teams[i], teams[j]] = [teams[j], teams[i]];
        }

        // Generate round-robin using circle method
        const rounds = [];
        const teamsCopy = [...teams];

        for (let round = 0; round < n - 1; round++) {
            const matches = [];
            for (let i = 0; i < n / 2; i++) {
                matches.push({
                    localId: teamsCopy[i],
                    visitanteId: teamsCopy[n - 1 - i]
                });
            }
            rounds.push(matches);

            // Rotate: keep first team fixed, rotate the rest clockwise
            const last = teamsCopy.pop();
            teamsCopy.splice(1, 0, last);
        }

        // Generate vuelta (swap home/away, same round order)
        const vueltaRounds = rounds.map(round =>
            round.map(match => ({
                localId: match.visitanteId,
                visitanteId: match.localId
            }))
        );

        const allRounds = [...rounds, ...vueltaRounds];
        const matchesPerRound = n / 2;

        // Track how many times each team plays in each time slot for balanced distribution
        const teamSlotCount = {};
        teams.forEach(id => {
            teamSlotCount[id] = new Array(TIME_SLOTS.length).fill(0);
        });

        const startDate = new Date(calendarStartDate + 'T12:00:00');

        const baseTime = Date.now();

        const newFechas = allRounds.map((round, fechaIndex) => {
            // Calculate week offset (rest week between fecha 11 and 12)
            let weekOffset;
            if (fechaIndex < n - 1) {
                weekOffset = fechaIndex;
            } else {
                weekOffset = fechaIndex + 1; // Skip rest week after ida
            }

            const fridayDate = new Date(startDate);
            fridayDate.setDate(fridayDate.getDate() + (weekOffset * 7));

            const saturdayDate = new Date(fridayDate);
            saturdayDate.setDate(saturdayDate.getDate() + 1);

            // Assign matches to time slots using greedy algorithm for balance
            const matchIndices = round.map((_, i) => i);
            const usedSlots = new Set();
            const slotAssignments = new Array(matchesPerRound).fill(-1);

            // Sort matches by how constrained their teams are (most constrained first)
            matchIndices.sort((a, b) => {
                const matchA = round[a];
                const matchB = round[b];
                const maxA = Math.max(...teamSlotCount[matchA.localId]) + Math.max(...teamSlotCount[matchA.visitanteId]);
                const maxB = Math.max(...teamSlotCount[matchB.localId]) + Math.max(...teamSlotCount[matchB.visitanteId]);
                return maxB - maxA;
            });

            for (const mi of matchIndices) {
                const match = round[mi];
                let bestSlot = -1;
                let bestScore = Infinity;

                for (let s = 0; s < TIME_SLOTS.length; s++) {
                    if (usedSlots.has(s)) continue;
                    if (s >= matchesPerRound) continue; // Only use as many slots as matches
                    const score = teamSlotCount[match.localId][s] + teamSlotCount[match.visitanteId][s];
                    if (score < bestScore) {
                        bestScore = score;
                        bestSlot = s;
                    }
                }

                // Fallback: if no available slot within matchesPerRound, use any available
                if (bestSlot === -1) {
                    for (let s = 0; s < TIME_SLOTS.length; s++) {
                        if (!usedSlots.has(s)) { bestSlot = s; break; }
                    }
                }

                usedSlots.add(bestSlot);
                slotAssignments[mi] = bestSlot;
                teamSlotCount[match.localId][bestSlot]++;
                teamSlotCount[match.visitanteId][bestSlot]++;
            }

            // Build partidos with dateTime
            const partidos = round.map((match, i) => {
                const slotIdx = slotAssignments[i];
                const slot = TIME_SLOTS[slotIdx];
                const matchDate = slot.day === 'friday' ? new Date(fridayDate) : new Date(saturdayDate);
                matchDate.setHours(slot.hour, slot.minute, 0, 0);

                const yyyy = matchDate.getFullYear();
                const mm = String(matchDate.getMonth() + 1).padStart(2, '0');
                const dd = String(matchDate.getDate()).padStart(2, '0');
                const hh = String(matchDate.getHours()).padStart(2, '0');
                const min = String(matchDate.getMinutes()).padStart(2, '0');
                const dateTime = `${yyyy}-${mm}-${dd}T${hh}:${min}`;

                return {
                    id: baseTime + fechaIndex * 10000 + 1000 + i,
                    localId: match.localId,
                    visitanteId: match.visitanteId,
                    localScore: null,
                    visitanteScore: null,
                    dateTime
                };
            });

            // Sort partidos by dateTime
            partidos.sort((a, b) => a.dateTime.localeCompare(b.dateTime));

            return {
                id: baseTime + fechaIndex * 10000,
                nombre: `Fecha ${fechaIndex + 1}`,
                partidos
            };
        });

        const docRef = doc(db, 'leagueConfig', String(selectedYear));
        await setDoc(docRef, { fechas: newFechas }, { merge: true });
        setSelectedFechaIndex(0);
        setShowCalendarModal(false);
        setCalendarStartDate('');
    };

    // ── Helpers ──

    const getTeamById = (teamId) => allTeams.find(t => t.id === teamId);

    const getPositionColor = (position) => {
        for (const label of positionLabels) {
            if (position >= label.fromPos && position <= label.toPos) {
                return label.color;
            }
        }
        return null;
    };

    const formatDateTime = (dateTimeStr) => {
        if (!dateTimeStr) return '';
        const date = new Date(dateTimeStr);
        if (isNaN(date.getTime())) return dateTimeStr;
        const days = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];
        const day = days[date.getDay()];
        const dd = String(date.getDate()).padStart(2, '0');
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const hh = String(date.getHours()).padStart(2, '0');
        const min = String(date.getMinutes()).padStart(2, '0');
        return `${day} ${dd}/${mm} - ${hh}:${min}`;
    };

    // Compute standings dynamically from fechas
    const computedStandings = leagueTeams.map(teamId => {
        const stats = { teamId, v: 0, p: 0, e: 0, pf: 0, pc: 0, lastResults: [] };

        fechas.forEach(f => {
            f.partidos.forEach(p => {
                if (p.localScore != null && p.visitanteScore != null) {
                    if (p.localId === teamId) {
                        stats.pf += p.localScore;
                        stats.pc += p.visitanteScore;
                        if (p.localScore > p.visitanteScore) { stats.v++; stats.lastResults.push('W'); }
                        else if (p.localScore < p.visitanteScore) { stats.p++; stats.lastResults.push('L'); }
                        else { stats.e++; stats.lastResults.push('T'); }
                    } else if (p.visitanteId === teamId) {
                        stats.pf += p.visitanteScore;
                        stats.pc += p.localScore;
                        if (p.visitanteScore > p.localScore) { stats.v++; stats.lastResults.push('W'); }
                        else if (p.visitanteScore < p.localScore) { stats.p++; stats.lastResults.push('L'); }
                        else { stats.e++; stats.lastResults.push('T'); }
                    }
                }
            });
        });

        const totalGames = stats.v + stats.p + stats.e;
        stats.pct = totalGames > 0 ? (stats.v / totalGames).toFixed(3) : '0.000';
        stats.np = stats.pf - stats.pc;
        // Keep only last 5 results
        stats.lastResults = stats.lastResults.slice(-5);

        return stats;
    });

    const sortedStandings = [...computedStandings]
        .sort((a, b) => {
            const pctA = parseFloat(a.pct) || 0;
            const pctB = parseFloat(b.pct) || 0;
            if (pctB !== pctA) return pctB - pctA;
            return (b.np || 0) - (a.np || 0);
        });

    const leagueTeamsData = leagueTeams
        .map(id => getTeamById(id))
        .filter(Boolean);

    const renderLastResults = (results = []) => {
        return (
            <div className="last-results">
                {results.map((r, i) => (
                    <span key={i} className={`result-dot ${r === 'W' ? 'win' : 'loss'}`}>●</span>
                ))}
            </div>
        );
    };

    if (loading) return <div className="loading">Cargando liga...</div>;

    return (
        <div className="liga-container">
            <h2 className="liga-title">Temporada Regular</h2>

            <div className="year-selector">
                <label>Temporada:</label>
                <select
                    value={selectedYear}
                    onChange={(e) => {
                        setSelectedYear(parseInt(e.target.value));
                        setSelectedFechaIndex(null);
                    }}
                >
                    {YEARS.map(year => (
                        <option key={year} value={year}>{year}</option>
                    ))}
                </select>
                <button
                    className="config-btn"
                    onClick={() => setShowConfig(!showConfig)}
                >
                    {showConfig ? 'Cerrar Config' : '⚙️ Configurar'}
                </button>
            </div>

            {showConfig && (
                <div className="config-panel">
                    <h3>Seleccionar Equipos para {selectedYear}</h3>
                    <div className="teams-selector">
                        {allTeams.map(team => (
                            <label key={team.id} className="team-checkbox">
                                <input
                                    type="checkbox"
                                    checked={leagueTeams.includes(team.id)}
                                    onChange={() => toggleTeamInLeague(team.id)}
                                />
                                <span>{team['Team Name']}</span>
                            </label>
                        ))}
                    </div>

                    {/* Position Labels Config */}
                    <div className="labels-config">
                        <h4>Etiquetas de Posición</h4>
                        <p className="labels-config-desc">Asigna colores a rangos de posiciones para indicar clasificación</p>
                        {positionLabels.map((label, i) => (
                            <div key={i} className="label-config-row">
                                <input
                                    type="color"
                                    value={label.color}
                                    onChange={(e) => updatePositionLabel(i, 'color', e.target.value)}
                                    className="label-color-picker"
                                />
                                <input
                                    type="text"
                                    placeholder="Nombre (ej: Clasificados)"
                                    value={label.name}
                                    onChange={(e) => updatePositionLabel(i, 'name', e.target.value)}
                                    className="label-name-input"
                                />
                                <label className="label-pos-input">
                                    Desde
                                    <input
                                        type="number"
                                        min="1"
                                        value={label.fromPos}
                                        onChange={(e) => updatePositionLabel(i, 'fromPos', e.target.value)}
                                    />
                                </label>
                                <label className="label-pos-input">
                                    Hasta
                                    <input
                                        type="number"
                                        min="1"
                                        value={label.toPos}
                                        onChange={(e) => updatePositionLabel(i, 'toPos', e.target.value)}
                                    />
                                </label>
                                <button className="remove-label-btn" onClick={() => removePositionLabel(i)}>✕</button>
                            </div>
                        ))}
                        <button className="add-label-btn" onClick={addPositionLabel}>+ Agregar Etiqueta</button>
                    </div>
                </div>
            )}

            {leagueTeamsData.length === 0 ? (
                <div className="no-teams">
                    <p>No hay equipos configurados para la temporada {selectedYear}.</p>
                    <p>Haz clic en "Configurar" para agregar equipos.</p>
                </div>
            ) : (
                <div className="standings-wrapper">
                    <table className="standings-table">
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>Equipo</th>
                                <th>PCT</th>
                                <th>V</th>
                                <th>P</th>
                                <th>NP</th>
                                <th>Últ. Resultados</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sortedStandings.length > 0 ? (
                                sortedStandings.map((standing, index) => {
                                    const team = getTeamById(standing.teamId);
                                    if (!team) return null;
                                    const labelColor = getPositionColor(index + 1);
                                    return (
                                        <tr
                                            key={standing.teamId}
                                            style={labelColor ? { backgroundColor: labelColor + '15' } : {}}
                                        >
                                            <td className="position">
                                                {labelColor && (
                                                    <span
                                                        className="position-label-bar"
                                                        style={{ backgroundColor: labelColor }}
                                                    />
                                                )}
                                                {index + 1}
                                            </td>
                                            <td className="team-cell">
                                                {team['URL PHOTO'] && (
                                                    <img src={team['URL PHOTO']} alt="" className="mini-logo" />
                                                )}
                                                {team['Team Name']}
                                            </td>
                                            <td className="pct">{standing.pct || '0.000'}</td>
                                            <td>{standing.v || 0}</td>
                                            <td>{standing.p || 0}</td>
                                            <td className={standing.np > 0 ? 'positive' : standing.np < 0 ? 'negative' : ''}>
                                                {standing.np > 0 ? '+' : ''}{standing.np || 0}
                                            </td>
                                            <td>{renderLastResults(standing.lastResults)}</td>
                                        </tr>
                                    );
                                })
                            ) : (
                                leagueTeamsData.map((team, index) => {
                                    const labelColor = getPositionColor(index + 1);
                                    return (
                                        <tr
                                            key={team.id}
                                            style={labelColor ? { backgroundColor: labelColor + '15' } : {}}
                                        >
                                            <td className="position">
                                                {labelColor && (
                                                    <span
                                                        className="position-label-bar"
                                                        style={{ backgroundColor: labelColor }}
                                                    />
                                                )}
                                                {index + 1}
                                            </td>
                                            <td className="team-cell">
                                                {team['URL PHOTO'] && (
                                                    <img src={team['URL PHOTO']} alt="" className="mini-logo" />
                                                )}
                                                {team['Team Name']}
                                            </td>
                                            <td className="pct">0.000</td>
                                            <td>0</td>
                                            <td>0</td>
                                            <td>0</td>
                                            <td></td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>

                    {/* Position Labels Legend */}
                    {positionLabels.length > 0 && (
                        <div className="labels-legend">
                            {positionLabels.map((label, i) => (
                                <div key={i} className="legend-item">
                                    <span className="legend-color" style={{ backgroundColor: label.color }} />
                                    <span className="legend-text">
                                        {label.name || 'Sin nombre'} (Pos. {label.fromPos}{label.toPos > label.fromPos ? `-${label.toPos}` : ''})
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}

                    {showConfig && (
                        <div className="edit-standings">
                            <h4>Editar Estadísticas</h4>
                            <div className="stats-editor">
                                {leagueTeamsData.map(team => {
                                    const standing = standings.find(s => s.teamId === team.id) || {};
                                    return (
                                        <div key={team.id} className="team-stats-row">
                                            <span className="team-name">{team['Team Name']}</span>
                                            <div className="stats-inputs">
                                                <label>V<input type="number" min="0" value={standing.v || 0} onChange={(e) => updateStanding(team.id, 'v', e.target.value)} /></label>
                                                <label>P<input type="number" min="0" value={standing.p || 0} onChange={(e) => updateStanding(team.id, 'p', e.target.value)} /></label>
                                                <label>PF<input type="number" min="0" value={standing.pf || 0} onChange={(e) => updateStanding(team.id, 'pf', e.target.value)} /></label>
                                                <label>PC<input type="number" min="0" value={standing.pc || 0} onChange={(e) => updateStanding(team.id, 'pc', e.target.value)} /></label>
                                            </div>
                                            <div className="results-buttons">
                                                <button className="win-btn" onClick={() => addResult(team.id, 'W')}>+ Victoria</button>
                                                <button className="loss-btn" onClick={() => addResult(team.id, 'L')}>+ Derrota</button>
                                                <button className="clear-btn" onClick={() => clearResults(team.id)}>Limpiar</button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Fechas Section */}
                    <div className="fechas-section">
                        <div className="fechas-header">
                            <h3>Calendario</h3>
                            <div className="fechas-header-actions">
                                {selectedYear === 2026 && leagueTeams.length > 0 && (
                                    <button
                                        className="generate-calendar-btn"
                                        onClick={() => setShowCalendarModal(true)}
                                    >
                                        📅 Generar Calendario
                                    </button>
                                )}
                                <button className="add-fecha-btn" onClick={addFecha}>+ Agregar Fecha</button>
                            </div>
                        </div>

                        {fechas.length === 0 ? (
                            <p className="no-fechas">No hay fechas configuradas. Haz clic en "+ Agregar Fecha" para comenzar.</p>
                        ) : (
                            <div className="fechas-carousel">
                                {/* Carousel Navigation */}
                                <div className="carousel-nav">
                                    <button
                                        className="carousel-arrow"
                                        onClick={() => setSelectedFechaIndex(Math.max(0, selectedFechaIndex - 1))}
                                        disabled={selectedFechaIndex === 0}
                                    >
                                        ‹
                                    </button>

                                    <div className="fecha-selector" onClick={() => setShowFechaDropdown(!showFechaDropdown)}>
                                        <input
                                            type="text"
                                            className="fecha-nombre-input"
                                            value={fechas[selectedFechaIndex]?.nombre || ''}
                                            onChange={(e) => updateFechaNombre(fechas[selectedFechaIndex]?.id, e.target.value)}
                                            onClick={(e) => e.stopPropagation()}
                                        />
                                        <span className="dropdown-arrow">{showFechaDropdown ? '▲' : '▼'}</span>

                                        {showFechaDropdown && (
                                            <div className="fecha-dropdown">
                                                {fechas.map((fecha, index) => (
                                                    <div
                                                        key={fecha.id}
                                                        className={`fecha-dropdown-item ${index === selectedFechaIndex ? 'active' : ''}`}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setSelectedFechaIndex(index);
                                                            setShowFechaDropdown(false);
                                                        }}
                                                    >
                                                        {fecha.nombre}
                                                        <span className="partidos-badge">{fecha.partidos.length}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    <button
                                        className="carousel-arrow"
                                        onClick={() => setSelectedFechaIndex(Math.min(fechas.length - 1, selectedFechaIndex + 1))}
                                        disabled={selectedFechaIndex === fechas.length - 1}
                                    >
                                        ›
                                    </button>

                                    <button
                                        className="remove-fecha-btn"
                                        onClick={() => {
                                            removeFecha(fechas[selectedFechaIndex]?.id);
                                            setSelectedFechaIndex(Math.max(0, selectedFechaIndex - 1));
                                        }}
                                    >
                                        ✕
                                    </button>
                                </div>

                                {/* Selected Fecha Content */}
                                {fechas[selectedFechaIndex] && (
                                    <div className="fecha-content">
                                        {fechas[selectedFechaIndex].partidos.length === 0 ? (
                                            <p className="no-partidos">No hay partidos en esta fecha</p>
                                        ) : (
                                            fechas[selectedFechaIndex].partidos.map((partido, partidoIdx) => {
                                                const local = getTeamById(partido.localId);
                                                const visitante = getTeamById(partido.visitanteId);
                                                const totalPartidos = fechas[selectedFechaIndex].partidos.length;
                                                return (
                                                    <div
                                                        key={partido.id}
                                                        className={`partido-card ${!showConfig ? 'clickable' : ''}`}
                                                        onClick={() => {
                                                            if (!showConfig) {
                                                                if (liveMatchesUI[partido.id]) {
                                                                    setSimulatingPartido({ fechaId: fechas[selectedFechaIndex].id, partidoId: partido.id, liveState: true });
                                                                } else if (partido.localScore === null) {
                                                                    setSimulatingPartido({ fechaId: fechas[selectedFechaIndex].id, partidoId: partido.id, readOnly: false });
                                                                } else {
                                                                    setSimulatingPartido({ fechaId: fechas[selectedFechaIndex].id, partidoId: partido.id, readOnly: true });
                                                                }
                                                            }
                                                        }}
                                                    >
                                                        <div className="partido-row">
                                                            <div className="partido-left-side">
                                                                {showConfig && (
                                                                    <div className="partido-reorder">
                                                                        <button
                                                                            className="reorder-btn"
                                                                            disabled={partidoIdx === 0}
                                                                            onClick={(e) => { e.stopPropagation(); movePartido(fechas[selectedFechaIndex].id, partidoIdx, -1); }}
                                                                        >
                                                                            ▲
                                                                        </button>
                                                                        <button
                                                                            className="reorder-btn"
                                                                            disabled={partidoIdx === totalPartidos - 1}
                                                                            onClick={(e) => { e.stopPropagation(); movePartido(fechas[selectedFechaIndex].id, partidoIdx, 1); }}
                                                                        >
                                                                            ▼
                                                                        </button>
                                                                    </div>
                                                                )}
                                                                <div className="partido-team local">
                                                                    {local?.['URL PHOTO'] && (
                                                                        <img src={local['URL PHOTO']} alt="" className="partido-logo" />
                                                                    )}
                                                                    <span>{local?.['Team Name'] || 'Equipo'}</span>
                                                                    {liveMatchesUI[partido.id]?.possession === 'local' && (
                                                                        <span className="possession-icon">🏈</span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            <div className="partido-center">
                                                                {showConfig ? (
                                                                    /* Admin mode: manual score editing */
                                                                    <>
                                                                        <div className="partido-score" onClick={(e) => e.stopPropagation()}>
                                                                            <input
                                                                                type="number"
                                                                                min="0"
                                                                                className="score-input"
                                                                                value={partido.localScore ?? ''}
                                                                                onChange={(e) => updatePartidoScore(fechas[selectedFechaIndex].id, partido.id, 'localScore', e.target.value)}
                                                                            />
                                                                            <span className="score-separator">-</span>
                                                                            <input
                                                                                type="number"
                                                                                min="0"
                                                                                className="score-input"
                                                                                value={partido.visitanteScore ?? ''}
                                                                                onChange={(e) => updatePartidoScore(fechas[selectedFechaIndex].id, partido.id, 'visitanteScore', e.target.value)}
                                                                            />
                                                                        </div>
                                                                        <input
                                                                            type="datetime-local"
                                                                            className="datetime-edit-input"
                                                                            value={partido.dateTime || ''}
                                                                            onChange={(e) => updatePartidoDateTime(fechas[selectedFechaIndex].id, partido.id, e.target.value)}
                                                                            onClick={(e) => e.stopPropagation()}
                                                                        />
                                                                    </>
                                                                ) : (
                                                                    /* Normal mode: display score or VS entirely dictated by click state above */
                                                                    <>
                                                                        {liveMatchesUI[partido.id] ? (
                                                                            <div className="live-match-card-display">
                                                                                <div className="live-badge-row">
                                                                                    <span className="live-pulse"></span>
                                                                                    <span className="live-text-badge">EN VIVO Q{liveMatchesUI[partido.id].quarter} {Math.floor(liveMatchesUI[partido.id].clock / 60)}:{(liveMatchesUI[partido.id].clock % 60).toString().padStart(2, '0')}</span>
                                                                                </div>
                                                                                <div className="score-display-final">
                                                                                    <span className="score-num">{liveMatchesUI[partido.id].localScore}</span>
                                                                                    <span className="score-separator">-</span>
                                                                                    <span className="score-num">{liveMatchesUI[partido.id].visitanteScore}</span>
                                                                                </div>
                                                                            </div>
                                                                        ) : partido.localScore !== null && partido.visitanteScore !== null ? (
                                                                            <div className="score-display-final">
                                                                                <span className={`score-num ${Number(partido.localScore) < Number(partido.visitanteScore) ? 'loser-score' : ''}`}>
                                                                                    {partido.localScore}
                                                                                </span>
                                                                                <span className="score-separator">-</span>
                                                                                <span className={`score-num ${Number(partido.visitanteScore) < Number(partido.localScore) ? 'loser-score' : ''}`}>
                                                                                    {partido.visitanteScore}
                                                                                </span>
                                                                            </div>
                                                                        ) : (
                                                                            <div className="partido-vs-area">
                                                                                <span className="vs-badge">VS</span>
                                                                            </div>
                                                                        )}
                                                                        {partido.dateTime && !liveMatchesUI[partido.id] && (
                                                                            <div className="partido-datetime">
                                                                                {formatDateTime(partido.dateTime)}
                                                                            </div>
                                                                        )}
                                                                    </>
                                                                )}
                                                            </div>
                                                            <div className="partido-right-side">
                                                                <div className="partido-team visitante">
                                                                    {liveMatchesUI[partido.id]?.possession === 'visitante' && (
                                                                        <span className="possession-icon">🏈</span>
                                                                    )}
                                                                    <span>{visitante?.['Team Name'] || 'Equipo'}</span>
                                                                    {visitante?.['URL PHOTO'] && (
                                                                        <img src={visitante['URL PHOTO']} alt="" className="partido-logo" />
                                                                    )}
                                                                </div>
                                                                <button
                                                                    className="remove-partido-btn"
                                                                    onClick={(e) => { e.stopPropagation(); removePartido(fechas[selectedFechaIndex].id, partido.id); }}
                                                                >
                                                                    ✕
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })
                                        )}

                                        <div className="add-partido-form">
                                            <select id={`local-${fechas[selectedFechaIndex].id}`} defaultValue="">
                                                <option value="" disabled>Local</option>
                                                {leagueTeamsData.map(team => (
                                                    <option key={team.id} value={team.id}>{team['Team Name']}</option>
                                                ))}
                                            </select>
                                            <span className="vs-text">vs</span>
                                            <select id={`visitante-${fechas[selectedFechaIndex].id}`} className="team-select">
                                                <option value="">Visitante...</option>
                                                {allTeams.filter(t => leagueTeams.includes(t.id)).map(team => (
                                                    <option key={team.id} value={team.id}>{team['Team Name']}</option>
                                                ))}
                                            </select>
                                            <input
                                                type="datetime-local"
                                                id={`datetime-${fechas[selectedFechaIndex].id}`}
                                                className="add-partido-datetime-new"
                                            />
                                            <button
                                                className="add-partido-btn"
                                                onClick={() => {
                                                    const localSelect = document.getElementById(`local-${fechas[selectedFechaIndex].id}`);
                                                    const visitanteSelect = document.getElementById(`visitante-${fechas[selectedFechaIndex].id}`);
                                                    const dateTimeInput = document.getElementById(`datetime-${fechas[selectedFechaIndex].id}`);
                                                    if (localSelect.value && visitanteSelect.value) {
                                                        addPartido(fechas[selectedFechaIndex].id, localSelect.value, visitanteSelect.value, dateTimeInput.value || null);
                                                        localSelect.value = '';
                                                        visitanteSelect.value = '';
                                                        dateTimeInput.value = '';
                                                    }
                                                }}
                                            >
                                                + Partido
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Game Simulator Modal */}
            {simulatingPartido && (() => {
                const fecha = fechas.find(f => f.id === simulatingPartido.fechaId);
                const partido = fecha?.partidos.find(p => p.id === simulatingPartido.partidoId);
                if (!fecha || !partido) return null;
                const localT = getTeamById(partido.localId);
                const visitanteT = getTeamById(partido.visitanteId);

                const readOnlyData = simulatingPartido.readOnly ? {
                    localScore: partido.localScore,
                    visitanteScore: partido.visitanteScore,
                    stats: partido.stats,
                    log: partido.scoringPlays || [],
                    totalPlays: partido.totalPlays || 0,
                    driveCount: partido.driveCount || 0,
                    broadcastTime: partido.broadcastTime || 0,
                    scoreByQuarter: partido.scoreByQuarter || null,
                } : null;

                const liveEngine = activeSimsRef.current[simulatingPartido.partidoId];

                return (
                    <GameSimulator
                        localTeam={localT}
                        visitanteTeam={visitanteT}
                        isLocalHome={true}
                        matchDateTime={partido.dateTime}
                        readOnlyResult={readOnlyData}
                        liveEngine={liveEngine}
                        onStartLive={() => startLiveSimulation(simulatingPartido.fechaId, simulatingPartido.partidoId, localT, visitanteT)}
                        onSpeedChange={(newSpeed) => {
                            if (liveEngine) {
                                liveEngine.speed = newSpeed;
                                liveEngine.lastTickTime = Date.now();
                                updateLiveUI();
                            }
                        }}
                        onSkipToEnd={() => {
                            if (liveEngine) {
                                liveEngine.currentIndex = liveEngine.result.log.length;
                                updateLiveUI();
                            }
                        }}
                        onSimulateUntil={(targetSeconds) => {
                            if (liveEngine) {
                                let targetIdx = liveEngine.result.log.findIndex(p => p.broadcastTime >= targetSeconds);
                                if (targetIdx === -1) {
                                    targetIdx = liveEngine.result.log.length;
                                }
                                liveEngine.currentIndex = Math.max(liveEngine.currentIndex, targetIdx);
                                liveEngine.lastTickTime = Date.now();
                                updateLiveUI();
                            }
                        }}
                        onFinish={(lScore, vScore, stats, scoringPlays, totalPlays, driveCount, broadcastTime, scoreByQuarter) => {
                            updatePartidoBothScores(simulatingPartido.fechaId, simulatingPartido.partidoId, String(lScore), String(vScore), stats, scoringPlays, totalPlays, driveCount, broadcastTime, scoreByQuarter);
                            setSimulatingPartido(null);
                        }}
                        onClose={() => setSimulatingPartido(null)}
                    />
                );
            })()}

            {/* Calendar Generation Modal */}
            {showCalendarModal && (
                <div className="calendar-modal-overlay" onClick={() => setShowCalendarModal(false)}>
                    <div className="calendar-modal" onClick={(e) => e.stopPropagation()}>
                        <h3>Generar Calendario Automáticamente</h3>
                        <p className="modal-subtitle">Todos contra todos, ida y vuelta</p>

                        {fechas.length > 0 && (
                            <div className="calendar-warning">
                                ⚠️ Se reemplazarán las {fechas.length} fechas existentes
                            </div>
                        )}

                        <div className="modal-info">
                            <p>• {leagueTeams.length} equipos → {(leagueTeams.length - 1) * 2} fechas</p>
                            <p>• Viernes: 13:00, 16:00, 19:00</p>
                            <p>• Sábados: 11:00, 14:00, 17:00</p>
                            <p>• Semana de descanso entre ida y vuelta</p>
                        </div>

                        <label className="modal-date-label">
                            ¿A partir de qué viernes comienza el torneo?
                            <input
                                type="date"
                                value={calendarStartDate}
                                onChange={(e) => setCalendarStartDate(e.target.value)}
                                className="modal-date-input"
                            />
                        </label>

                        <div className="modal-buttons">
                            <button className="modal-cancel-btn" onClick={() => setShowCalendarModal(false)}>
                                Cancelar
                            </button>
                            <button
                                className="modal-generate-btn"
                                onClick={generateCalendar}
                                disabled={!calendarStartDate}
                            >
                                Generar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default Liga;
