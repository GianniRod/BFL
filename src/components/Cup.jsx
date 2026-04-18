import { useEffect, useState, useRef } from 'react';
import { subscribeToTeams } from '../services/db';
import { db } from '../firebase';
import { doc, setDoc, onSnapshot } from 'firebase/firestore';
import './Cup.css';
import './Liga.css';
import GameSimulator, { simulateGame, simulateOvertime, parseStarValue } from './GameSimulator';

const YEARS = [2024, 2025, 2026];
const PHASE_KEYS = ['octavos', 'cuartos', 'semis', 'final'];
const PHASE_NAMES = {
    octavos: 'Octavos',
    cuartos: 'Cuartos',
    semis: 'Semis',
    final: 'Final',
};

function Cup() {
    const [selectedYear, setSelectedYear] = useState(2026);
    const [allTeams, setAllTeams] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showConfig, setShowConfig] = useState(false);
    const [phases, setPhases] = useState({});
    const [selectedPhase, setSelectedPhase] = useState('octavos');
    const [simulatingMatch, setSimulatingMatch] = useState(null);
    const [viewMode, setViewMode] = useState('list');

    const activeSimsRef = useRef({});
    const [liveMatchesUI, setLiveMatchesUI] = useState({});
    const phasesRef = useRef({});
    const phasesLoadedRef = useRef(false);
    const updateLegBothScoresRef = useRef(null);

    useEffect(() => {
        const unsub = subscribeToTeams((data) => { setAllTeams(data); setLoading(false); });
        return () => unsub();
    }, []);

    useEffect(() => {
        phasesLoadedRef.current = false;
        const docRef = doc(db, 'cupConfig', String(selectedYear));
        const unsub = onSnapshot(docRef, (snap) => {
            if (snap.exists()) {
                const data = snap.data();
                setPhases(data.phases || {});
                phasesRef.current = data.phases || {};
            } else {
                setPhases({});
                phasesRef.current = {};
            }
            phasesLoadedRef.current = true;
        });
        return () => unsub();
    }, [selectedYear]);

    useEffect(() => { phasesRef.current = phases; }, [phases]);

    // ── Live Simulation Engine ──
    const updateLiveUI = () => {
        const newState = {};
        Object.entries(activeSimsRef.current).forEach(([pid, sim]) => {
            const play = sim.result.log[Math.min(sim.currentIndex, sim.result.log.length - 1)];
            if (play) {
                newState[pid] = {
                    localScore: play.localScore, visitanteScore: play.visitanteScore,
                    quarter: play.quarter, clock: play.gameClock,
                    possession: play.possession, down: play.down,
                    yardsToGo: play.yardsToGo, speed: sim.speed, isActive: true,
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
                if (sim.currentIndex >= sim.result.log.length) { finishedMatches.push({ pid, sim }); return; }
                const cur = sim.result.log[sim.currentIndex];
                const next = sim.result.log[sim.currentIndex + 1];
                if (sim.targetIndex != null && sim.currentIndex < sim.targetIndex) {
                    const adv = Math.max(1, Math.min(15, Math.floor((sim.targetIndex - sim.currentIndex) / 3)));
                    sim.currentIndex += adv;
                    if (sim.currentIndex >= sim.targetIndex) { sim.currentIndex = sim.targetIndex; sim.targetIndex = null; sim.lastTickTime = now; }
                    hasChanges = true; return;
                }
                if (next) {
                    let diff = (next.broadcastTime || 0) - (cur.broadcastTime || 0);
                    if (diff < 1 || isNaN(diff)) diff = 5;
                    if (now - sim.lastTickTime >= (diff * 1000) / sim.speed) { sim.currentIndex++; sim.lastTickTime = now; hasChanges = true; }
                } else { sim.currentIndex++; hasChanges = true; }
            });
            finishedMatches.forEach(({ pid, sim }) => {
                delete activeSimsRef.current[pid];
                const r = sim.result;
                const scoringPlays = r.log.filter(l => ['touchdown', 'field_goal', 'safety', 'pick_six', 'game_end'].includes(l.eventType));
                if (updateLegBothScoresRef.current) {
                    updateLegBothScoresRef.current(sim.phaseKey, sim.matchupId, sim.legKey, String(r.localScore), String(r.visitanteScore), r.stats, scoringPlays, r.totalPlays, r.driveCount, r.broadcastTime, r.scoreByQuarter);
                }
                setSimulatingMatch(prev => prev && prev.simId === pid ? { ...prev, readOnly: true } : prev);
                hasChanges = true;
            });
            if (hasChanges) updateLiveUI();
        }, 100);
        return () => clearInterval(ticker);
    }, []);

    const startLiveSimulation = (phaseKey, matchupId, legKey, localTeam, visitanteTeam, simId) => {
        const result = simulateGame(
            localTeam?.['Team Name'] || 'Local', visitanteTeam?.['Team Name'] || 'Visitante', true,
            {
                localOff: parseStarValue(localTeam?.['Offensive Stars'] || 3),
                localDef: parseStarValue(localTeam?.['Deffensive Stars'] || 3),
                visitOff: parseStarValue(visitanteTeam?.['Offensive Stars'] || 3),
                visitDef: parseStarValue(visitanteTeam?.['Deffensive Stars'] || 3),
            }
        );
        activeSimsRef.current[simId] = { phaseKey, matchupId, legKey, result, currentIndex: 0, speed: 1, lastTickTime: Date.now() };
        updateLiveUI();
    };

    // ── Firestore ──
    const savePhases = async (newPhases) => {
        const docRef = doc(db, 'cupConfig', String(selectedYear));
        await setDoc(docRef, { phases: newPhases }, { merge: true });
    };

    const addMatchup = async (phaseKey, team1Id, team2Id) => {
        const current = { ...phasesRef.current };
        if (!current[phaseKey]) current[phaseKey] = { matchups: [] };
        const matchups = [...(current[phaseKey].matchups || [])];
        const isBye = !team2Id || team2Id === 'BYE';
        const newMatchup = { id: Date.now(), team1Id, team2Id: isBye ? null : team2Id, isBye, winnerId: isBye ? team1Id : null };
        if (!isBye) {
            newMatchup.ida = { localId: team1Id, visitanteId: team2Id, localScore: null, visitanteScore: null, dateTime: null };
            if (phaseKey !== 'final') {
                newMatchup.vuelta = { localId: team2Id, visitanteId: team1Id, localScore: null, visitanteScore: null, dateTime: null };
            }
        }
        matchups.push(newMatchup);
        current[phaseKey] = { ...current[phaseKey], matchups };
        await savePhases(current);
    };

    const removeMatchup = async (phaseKey, matchupId) => {
        const current = { ...phasesRef.current };
        if (!current[phaseKey]) return;
        current[phaseKey] = { ...current[phaseKey], matchups: current[phaseKey].matchups.filter(m => m.id !== matchupId) };
        await savePhases(current);
    };

    const updateLegBothScores = async (phaseKey, matchupId, legKey, localScore, visitanteScore, stats, scoringPlays, totalPlays, driveCount, broadcastTime, scoreByQuarter) => {
        const current = { ...phasesRef.current };
        if (!phasesLoadedRef.current || !current[phaseKey]) return;
        const matchups = current[phaseKey].matchups.map(m => {
            if (m.id !== matchupId) return m;
            const updatedLeg = {
                ...m[legKey],
                localScore: localScore === '' ? null : parseInt(localScore),
                visitanteScore: visitanteScore === '' ? null : parseInt(visitanteScore),
                stats: stats || null, scoringPlays: scoringPlays || null,
                totalPlays: totalPlays || null, driveCount: driveCount || null,
                broadcastTime: broadcastTime || null, scoreByQuarter: scoreByQuarter || null,
            };
            const updated = { ...m, [legKey]: updatedLeg };
            updated.winnerId = computeWinner(updated, phaseKey);
            return updated;
        });
        current[phaseKey] = { ...current[phaseKey], matchups };
        await savePhases(current);
    };

    useEffect(() => { updateLegBothScoresRef.current = updateLegBothScores; }, [updateLegBothScores]);

    const updateLegDateTime = async (phaseKey, matchupId, legKey, dateTime) => {
        const current = { ...phasesRef.current };
        if (!current[phaseKey]) return;
        const matchups = current[phaseKey].matchups.map(m => m.id !== matchupId ? m : { ...m, [legKey]: { ...m[legKey], dateTime } });
        current[phaseKey] = { ...current[phaseKey], matchups };
        await savePhases(current);
    };

    const resetLeg = async (phaseKey, matchupId, legKey) => {
        if (!window.confirm('¿Resetear este partido? Se borrarán los scores y estadísticas.')) return;
        const current = { ...phasesRef.current };
        if (!current[phaseKey]) return;
        const matchups = current[phaseKey].matchups.map(m => {
            if (m.id !== matchupId) return m;
            return { ...m, [legKey]: { ...m[legKey], localScore: null, visitanteScore: null, stats: null, scoringPlays: null, totalPlays: null, driveCount: null, broadcastTime: null, scoreByQuarter: null }, winnerId: null };
        });
        current[phaseKey] = { ...current[phaseKey], matchups };
        await savePhases(current);
    };

    // ── Winner computation ──
    const computeWinner = (matchup, phaseKey) => {
        if (matchup.isBye) return matchup.team1Id;
        if (phaseKey === 'final') {
            const leg = matchup.ida;
            if (!leg || leg.localScore == null || leg.visitanteScore == null) return null;
            if (leg.localScore > leg.visitanteScore) return leg.localId;
            if (leg.visitanteScore > leg.localScore) return leg.visitanteId;
            return matchup.team1Id;
        }
        const ida = matchup.ida;
        const vuelta = matchup.vuelta;
        if (!ida || !vuelta) return null;
        if (ida.localScore == null || ida.visitanteScore == null || vuelta.localScore == null || vuelta.visitanteScore == null) return null;
        const t1Agg = (ida.localScore || 0) + (vuelta.visitanteScore || 0);
        const t2Agg = (ida.visitanteScore || 0) + (vuelta.localScore || 0);
        if (t1Agg > t2Agg) return matchup.team1Id;
        if (t2Agg > t1Agg) return matchup.team2Id;
        const t1Away = vuelta.visitanteScore || 0;
        const t2Away = ida.visitanteScore || 0;
        if (t1Away > t2Away) return matchup.team1Id;
        if (t2Away > t1Away) return matchup.team2Id;
        return matchup.team1Id;
    };

    // ── Helpers ──
    const getTeamById = (id) => allTeams.find(t => t.id === id);
    const formatDateTime = (s) => {
        if (!s) return '';
        const d = new Date(s);
        if (isNaN(d.getTime())) return s;
        const days = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];
        return `${days[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} - ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    };
    const getPhaseMatchups = (k) => phases[k]?.matchups || [];
    const getAgg = (m) => {
        if (m.isBye || !m.ida || !m.vuelta) return null;
        if (m.ida.localScore == null || m.vuelta.localScore == null) return null;
        return { t1: (m.ida.localScore || 0) + (m.vuelta.visitanteScore || 0), t2: (m.ida.visitanteScore || 0) + (m.vuelta.localScore || 0) };
    };
    const getAvailableTeams = (phaseKey) => {
        const idx = PHASE_KEYS.indexOf(phaseKey);
        if (idx === 0) return allTeams;
        const prev = PHASE_KEYS[idx - 1];
        const winners = getPhaseMatchups(prev).filter(m => m.winnerId).map(m => m.winnerId);
        return allTeams.filter(t => winners.includes(t.id));
    };
    const getChampion = () => {
        const fm = getPhaseMatchups('final');
        return fm.length === 1 && fm[0].winnerId ? getTeamById(fm[0].winnerId) : null;
    };

    if (loading) return <div className="loading">Cargando copa...</div>;

    const champion = getChampion();
    const currentMatchups = getPhaseMatchups(selectedPhase);

    // ── Build list of all leg cards to render (like Liga's partido list) ──
    const legCards = [];
    currentMatchups.forEach((matchup, mIdx) => {
        if (matchup.isBye) {
            legCards.push({ type: 'bye', matchup, mIdx });
        } else {
            if (matchup.ida) legCards.push({ type: 'leg', matchup, mIdx, legKey: 'ida', label: selectedPhase === 'final' ? null : 'IDA', leg: matchup.ida });
            if (matchup.vuelta && selectedPhase !== 'final') legCards.push({ type: 'leg', matchup, mIdx, legKey: 'vuelta', label: 'VUELTA', leg: matchup.vuelta });
        }
        if (!matchup.isBye && selectedPhase !== 'final') {
            const agg = getAgg(matchup);
            if (agg) legCards.push({ type: 'aggregate', matchup, mIdx, agg });
        }
    });

    // Group legCards by matchup for visual separation
    const matchupGroups = [];
    let currentGroup = null;
    legCards.forEach(item => {
        if (!currentGroup || currentGroup.matchupId !== item.matchup.id) {
            currentGroup = { matchupId: item.matchup.id, items: [] };
            matchupGroups.push(currentGroup);
        }
        currentGroup.items.push(item);
    });

    return (
        <div className="cup-container">
            <h2 className="cup-title">CUP</h2>
            <p className="cup-subtitle">Torneo de Eliminación Directa</p>

            <div className="cup-year-selector">
                <label>Temporada:</label>
                <select value={selectedYear} onChange={(e) => setSelectedYear(parseInt(e.target.value))}>
                    {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
                <button className="cup-config-btn" onClick={() => setShowConfig(!showConfig)}>
                    {showConfig ? 'Cerrar Config' : 'Configurar'}
                </button>
            </div>

            {champion && (
                <div className="cup-champion-banner">
                    <span className="trophy">🏆</span>
                    <div className="champion-title">Campeón</div>
                    <div className="champion-name">
                        {champion['URL PHOTO'] && <img src={champion['URL PHOTO']} alt="" />}
                        {champion['Team Name']}
                    </div>
                </div>
            )}

            {/* Phase Carousel (identical to Liga's fecha carousel) */}
            <div className="cup-carousel">
                <div className="cup-carousel-nav">
                    <div className="cup-phase-pills-strip">
                        {PHASE_KEYS.map(key => {
                            const matchups = getPhaseMatchups(key);
                            const doneCount = matchups.filter(m => m.winnerId).length;
                            const complete = matchups.length > 0 && matchups.every(m => m.winnerId);
                            return (
                                <button
                                    key={key}
                                    className={`cup-phase-pill ${selectedPhase === key ? 'active' : ''} ${complete ? 'completed' : ''}`}
                                    onClick={() => setSelectedPhase(key)}
                                >
                                    <span className="pill-label">{PHASE_NAMES[key]}</span>
                                    {matchups.length > 0 && <span className="pill-count-badge">{doneCount}/{matchups.length}</span>}
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div className="cup-view-toggle">
                    <button className={`cup-view-btn ${viewMode === 'list' ? 'active' : ''}`} onClick={() => setViewMode('list')}>Lista</button>
                    <button className={`cup-view-btn ${viewMode === 'bracket' ? 'active' : ''}`} onClick={() => setViewMode('bracket')}>Bracket</button>
                </div>

                {viewMode === 'list' ? (
                    <div className="fecha-content">
                        {matchupGroups.length === 0 && (
                            <div className="cup-empty-state">
                                <span className="empty-icon">🏟️</span>
                                <p>No hay llaves en {PHASE_NAMES[selectedPhase]}.</p>
                                <p>Activa "Configurar" para agregar.</p>
                            </div>
                        )}

                        {matchupGroups.map((group, gIdx) => (
                            <div key={group.matchupId} className="cup-matchup-group">
                                {group.items.map((item, idx) => {
                                    if (item.type === 'bye') {
                                        const team1 = getTeamById(item.matchup.team1Id);
                                        return (
                                            <div key={`bye-${item.matchup.id}`} className="partido-card" style={{ opacity: 0.55, borderStyle: 'dashed' }}>
                                                <div className="partido-row">
                                                    <div className="partido-left-side">
                                                        <div className="partido-team local">
                                                            {team1?.['URL PHOTO'] && <img src={team1['URL PHOTO']} alt="" className="partido-logo" />}
                                                            <span>{team1?.['Team Name'] || '???'}</span>
                                                        </div>
                                                    </div>
                                                    <div className="partido-center">
                                                        <div className="cup-bye-text" style={{ color: '#4caf50', fontWeight: 600, fontSize: '0.8rem' }}>
                                                            BYE – Clasificado
                                                        </div>
                                                    </div>
                                                    <div className="partido-right-side">
                                                        {showConfig && (
                                                            <button className="cup-remove-matchup-btn" onClick={() => removeMatchup(selectedPhase, item.matchup.id)}>✕</button>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    }

                                    if (item.type === 'aggregate') {
                                        const team1 = getTeamById(item.matchup.team1Id);
                                        const team2 = getTeamById(item.matchup.team2Id);
                                        const winner = item.matchup.winnerId ? getTeamById(item.matchup.winnerId) : null;
                                        return (
                                            <div key={`agg-${item.matchup.id}`} className="cup-aggregate-bar">
                                                Global: <strong>{item.agg.t1}</strong> ({team1?.['Team Name']}) - <strong>{item.agg.t2}</strong> ({team2?.['Team Name']})
                                                {winner && <span> · 🏅 Clasifica <strong>{winner['Team Name']}</strong></span>}
                                            </div>
                                        );
                                    }

                                    const { matchup, legKey, label, leg } = item;
                                    const local = getTeamById(leg.localId);
                                    const visitante = getTeamById(leg.visitanteId);
                                    const simId = `cup_${matchup.id}_${legKey}`;
                                    const liveData = liveMatchesUI[simId];

                                    return (
                                        <div key={`${matchup.id}-${legKey}`}>
                                            {legKey === 'ida' && (
                                                <div className="cup-matchup-header-bar">
                                                    <span className="cup-matchup-label">Llave {item.mIdx + 1}{label ? ` · ${label}` : ''}</span>
                                                    <div className="cup-matchup-badge">
                                                        {matchup.winnerId && (() => {
                                                            const w = getTeamById(matchup.winnerId);
                                                            return w ? <span className="winner-text">{w['URL PHOTO'] && <img src={w['URL PHOTO']} alt="" />}🏅 {w['Team Name']}</span> : null;
                                                        })()}
                                                        {showConfig && <button className="cup-remove-matchup-btn" onClick={() => removeMatchup(selectedPhase, matchup.id)}>✕</button>}
                                                    </div>
                                                </div>
                                            )}
                                            {legKey === 'vuelta' && (
                                                <div className="cup-matchup-header-bar">
                                                    <span className="cup-matchup-label">Llave {item.mIdx + 1} · {label}</span>
                                                    <span></span>
                                                </div>
                                            )}

                                            <div
                                                className={`partido-card ${!showConfig ? 'clickable' : ''}`}
                                                onClick={() => {
                                                    if (showConfig) return;
                                                    if (liveData) {
                                                        setSimulatingMatch({ phaseKey: selectedPhase, matchupId: matchup.id, legKey, simId, readOnly: false, liveState: true });
                                                    } else if (leg.localScore === null) {
                                                        setSimulatingMatch({ phaseKey: selectedPhase, matchupId: matchup.id, legKey, simId, readOnly: false });
                                                    } else {
                                                        setSimulatingMatch({ phaseKey: selectedPhase, matchupId: matchup.id, legKey, simId, readOnly: true });
                                                    }
                                                }}
                                            >
                                                <div className="partido-row">
                                                    <div className="partido-left-side">
                                                        <div className="partido-team local">
                                                            {local?.['URL PHOTO'] && <img src={local['URL PHOTO']} alt="" className="partido-logo" />}
                                                            <span>{local?.['Team Name'] || 'Equipo'}</span>
                                                            {liveData?.possession === 'local' && <span className="possession-icon">🏈</span>}
                                                        </div>
                                                    </div>
                                                    <div className="partido-center">
                                                        {showConfig ? (
                                                            <>
                                                                <div className="partido-score" onClick={(e) => e.stopPropagation()}>
                                                                    <input type="number" min="0" className="score-input" value={leg.localScore ?? ''} readOnly />
                                                                    <span className="score-separator">-</span>
                                                                    <input type="number" min="0" className="score-input" value={leg.visitanteScore ?? ''} readOnly />
                                                                </div>
                                                                <input
                                                                    type="datetime-local"
                                                                    className="datetime-edit-input"
                                                                    value={leg.dateTime || ''}
                                                                    onChange={(e) => updateLegDateTime(selectedPhase, matchup.id, legKey, e.target.value)}
                                                                    onClick={(e) => e.stopPropagation()}
                                                                />
                                                            </>
                                                        ) : (
                                                            <>
                                                                {liveData ? (
                                                                    <div className="live-match-card-display">
                                                                        <div className="live-badge-row">
                                                                            <span className="live-pulse"></span>
                                                                            <span className="live-text-badge">EN VIVO Q{liveData.quarter} {Math.floor(liveData.clock / 60)}:{(liveData.clock % 60).toString().padStart(2, '0')}</span>
                                                                        </div>
                                                                        <div className="score-display-final">
                                                                            <span className="score-num">{liveData.localScore}</span>
                                                                            <span className="score-separator">-</span>
                                                                            <span className="score-num">{liveData.visitanteScore}</span>
                                                                        </div>
                                                                        {liveData.down && (
                                                                            <div className="live-down-distance">
                                                                                {['1st', '2nd', '3rd', '4th'][liveData.down - 1] || `${liveData.down}th`} & {liveData.yardsToGo}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                ) : leg.localScore !== null && leg.visitanteScore !== null ? (
                                                                    <div className="score-display-final">
                                                                        <span className={`score-num ${Number(leg.localScore) < Number(leg.visitanteScore) ? 'loser-score' : ''}`}>{leg.localScore}</span>
                                                                        <span className="score-separator">-</span>
                                                                        <span className={`score-num ${Number(leg.visitanteScore) < Number(leg.localScore) ? 'loser-score' : ''}`}>{leg.visitanteScore}</span>
                                                                    </div>
                                                                ) : (
                                                                    <div className="partido-vs-area">
                                                                        <span className="vs-badge">VS</span>
                                                                    </div>
                                                                )}
                                                                {leg.dateTime && !liveData && (
                                                                    <div className="partido-datetime">{formatDateTime(leg.dateTime)}</div>
                                                                )}
                                                            </>
                                                        )}
                                                    </div>
                                                    <div className="partido-right-side">
                                                        <div className="partido-team visitante">
                                                            {liveData?.possession === 'visitante' && <span className="possession-icon">🏈</span>}
                                                            <span>{visitante?.['Team Name'] || 'Equipo'}</span>
                                                            {visitante?.['URL PHOTO'] && <img src={visitante['URL PHOTO']} alt="" className="partido-logo" />}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ))}
                    </div>
                ) : (
                    /* ── BRACKET VIEW ── */
                    <div className="bracket-scroll-wrapper">
                        <div className="bracket-view">
                            {(() => {
                                const phasesToShow = PHASE_KEYS.slice(PHASE_KEYS.indexOf(selectedPhase));
                                // Calculate expected slots per round based on first round
                                const firstRoundMatchups = getPhaseMatchups(phasesToShow[0]);
                                const firstCount = Math.max(firstRoundMatchups.length, 1);

                                // Build slots for each round: real matchups + TBD placeholders
                                const roundsData = phasesToShow.map((pk, colIdx) => {
                                    const expectedCount = Math.max(1, Math.ceil(firstCount / Math.pow(2, colIdx)));
                                    const realMatchups = getPhaseMatchups(pk);
                                    const slots = [];
                                    for (let i = 0; i < expectedCount; i++) {
                                        if (i < realMatchups.length) {
                                            slots.push({ type: 'real', matchup: realMatchups[i] });
                                        } else {
                                            slots.push({ type: 'tbd', id: `tbd-${pk}-${i}` });
                                        }
                                    }
                                    return { pk, slots, isLast: colIdx === phasesToShow.length - 1 };
                                });

                                const renderTbdCard = () => (
                                    <div className="bracket-card bracket-empty-card">
                                        <div className="bracket-team-row"><span className="bracket-team-name tbd">TBD</span></div>
                                        <div className="bracket-team-row"><span className="bracket-team-name tbd">TBD</span></div>
                                    </div>
                                );

                                const renderBracketCard = (m, pk) => {
                                    const team1 = getTeamById(m.team1Id);
                                    const team2 = m.team2Id ? getTeamById(m.team2Id) : null;
                                    if (m.isBye) {
                                        return (
                                            <div className="bracket-card bracket-bye">
                                                <div className="bracket-team-row winner">
                                                    {team1?.['URL PHOTO'] && <img src={team1['URL PHOTO']} alt="" />}
                                                    <span className="bracket-team-name">{team1?.['Team Name'] || '???'}</span>
                                                    <span className="bracket-bye-label">BYE</span>
                                                </div>
                                            </div>
                                        );
                                    }
                                    const agg = getAgg(m);
                                    let t1Score = null, t2Score = null;
                                    if (pk === 'final' && m.ida) {
                                        t1Score = m.ida.localScore;
                                        t2Score = m.ida.visitanteScore;
                                    } else if (agg) {
                                        t1Score = agg.t1;
                                        t2Score = agg.t2;
                                    }
                                    const isW1 = m.winnerId === m.team1Id;
                                    const isW2 = m.winnerId === m.team2Id;
                                    return (
                                        <div
                                            className="bracket-card clickable"
                                            onClick={() => {
                                                if (showConfig || !m.ida) return;
                                                const legKey = 'ida';
                                                const simId = `cup_${m.id}_${legKey}`;
                                                const ld = liveMatchesUI[simId];
                                                if (ld) {
                                                    setSimulatingMatch({ phaseKey: pk, matchupId: m.id, legKey, simId, readOnly: false, liveState: true });
                                                } else if (m.ida.localScore === null) {
                                                    setSimulatingMatch({ phaseKey: pk, matchupId: m.id, legKey, simId, readOnly: false });
                                                } else {
                                                    setSimulatingMatch({ phaseKey: pk, matchupId: m.id, legKey, simId, readOnly: true });
                                                }
                                            }}
                                        >
                                            <div className={`bracket-team-row ${isW1 ? 'winner' : ''} ${m.winnerId && !isW1 ? 'loser' : ''}`}>
                                                {team1?.['URL PHOTO'] && <img src={team1['URL PHOTO']} alt="" />}
                                                <span className="bracket-team-name">{team1?.['Team Name'] || 'TBD'}</span>
                                                {t1Score !== null && <span className="bracket-team-score">{t1Score}</span>}
                                            </div>
                                            <div className={`bracket-team-row ${isW2 ? 'winner' : ''} ${m.winnerId && !isW2 ? 'loser' : ''}`}>
                                                {team2?.['URL PHOTO'] && <img src={team2['URL PHOTO']} alt="" />}
                                                <span className="bracket-team-name">{team2?.['Team Name'] || 'TBD'}</span>
                                                {t2Score !== null && <span className="bracket-team-score">{t2Score}</span>}
                                            </div>
                                        </div>
                                    );
                                };

                                return roundsData.map(({ pk, slots, isLast }, colIdx) => {
                                    // Group into pairs for connector lines (except last round)
                                    const hasPairs = !isLast && slots.length > 1;
                                    const pairs = [];
                                    if (hasPairs) {
                                        for (let i = 0; i < slots.length; i += 2) {
                                            pairs.push(slots.slice(i, i + 2));
                                        }
                                    }

                                    return (
                                        <div key={pk} className={`bracket-round ${colIdx === 0 ? 'bracket-round-first' : ''} ${isLast ? 'bracket-round-last' : ''}`}>
                                            <div className="bracket-round-title">{PHASE_NAMES[pk]}</div>
                                            <div className="bracket-matchups">
                                                {hasPairs ? (
                                                    pairs.map((pair, pIdx) => (
                                                        <div key={pIdx} className="bracket-pair">
                                                            {pair.map(slot => (
                                                                <div key={slot.type === 'real' ? slot.matchup.id : slot.id} className="bracket-slot">
                                                                    {slot.type === 'real' ? renderBracketCard(slot.matchup, pk) : renderTbdCard()}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    ))
                                                ) : (
                                                    slots.map(slot => (
                                                        <div key={slot.type === 'real' ? slot.matchup.id : slot.id} className="bracket-slot">
                                                            {slot.type === 'real' ? renderBracketCard(slot.matchup, pk) : renderTbdCard()}
                                                        </div>
                                                    ))
                                                )}
                                            </div>
                                        </div>
                                    );
                                });
                            })()}
                        </div>
                    </div>
                )}

                {/* Add matchup form */}
                {showConfig && (
                    <div className="cup-add-form">
                        <select id={`cup-t1-${selectedPhase}`} defaultValue="">
                            <option value="" disabled>Equipo 1</option>
                            {getAvailableTeams(selectedPhase).map(t => <option key={t.id} value={t.id}>{t['Team Name']}</option>)}
                        </select>
                        <span className="vs-text">vs</span>
                        <select id={`cup-t2-${selectedPhase}`} defaultValue="">
                            <option value="" disabled>Equipo 2</option>
                            {selectedPhase === 'octavos' && <option value="BYE">🔄 BYE</option>}
                            {getAvailableTeams(selectedPhase).map(t => <option key={t.id} value={t.id}>{t['Team Name']}</option>)}
                        </select>
                        <button className="cup-add-btn" onClick={() => {
                            const s1 = document.getElementById(`cup-t1-${selectedPhase}`);
                            const s2 = document.getElementById(`cup-t2-${selectedPhase}`);
                            if (s1.value) { addMatchup(selectedPhase, s1.value, s2.value || null); s1.value = ''; s2.value = ''; }
                        }}>+ Agregar Llave</button>
                    </div>
                )}
            </div>

            {/* Game Simulator Modal */}
            {simulatingMatch && (() => {
                const phaseData = phases[simulatingMatch.phaseKey];
                const matchup = phaseData?.matchups?.find(m => m.id === simulatingMatch.matchupId);
                if (!matchup) return null;
                const leg = matchup[simulatingMatch.legKey];
                if (!leg) return null;
                const localT = getTeamById(leg.localId);
                const visitanteT = getTeamById(leg.visitanteId);
                const simId = simulatingMatch.simId;
                const readOnlyData = simulatingMatch.readOnly ? {
                    localScore: leg.localScore, visitanteScore: leg.visitanteScore,
                    stats: leg.stats, log: leg.scoringPlays || [],
                    totalPlays: leg.totalPlays || 0, driveCount: leg.driveCount || 0,
                    broadcastTime: leg.broadcastTime || 0, scoreByQuarter: leg.scoreByQuarter || null,
                } : null;
                const liveEngine = activeSimsRef.current[simId];

                return (
                    <GameSimulator
                        localTeam={localT} visitanteTeam={visitanteT} isLocalHome={true}
                        matchDateTime={leg.dateTime} readOnlyResult={readOnlyData} liveEngine={liveEngine}
                        onStartLive={() => startLiveSimulation(simulatingMatch.phaseKey, simulatingMatch.matchupId, simulatingMatch.legKey, localT, visitanteT, simId)}
                        onSpeedChange={(s) => { if (liveEngine) { liveEngine.speed = s; liveEngine.lastTickTime = Date.now(); updateLiveUI(); } }}
                        onSkipToEnd={() => { if (liveEngine) { liveEngine.currentIndex = liveEngine.result.log.length; updateLiveUI(); } }}
                        onSimulateUntil={(ts) => { if (liveEngine) { let ti = liveEngine.result.log.findIndex(p => p.broadcastTime >= ts); if (ti === -1) ti = liveEngine.result.log.length; liveEngine.targetIndex = ti; } }}
                        onFinish={(lS, vS, st, sp, tp, dc, bt, sbq) => {
                            updateLegBothScores(simulatingMatch.phaseKey, simulatingMatch.matchupId, simulatingMatch.legKey, String(lS), String(vS), st, sp, tp, dc, bt, sbq);
                            setSimulatingMatch(null);
                        }}
                        onClose={() => setSimulatingMatch(null)}
                        onReset={async () => {
                            if (activeSimsRef.current[simId]) delete activeSimsRef.current[simId];
                            updateLiveUI();
                            await resetLeg(simulatingMatch.phaseKey, simulatingMatch.matchupId, simulatingMatch.legKey);
                            setSimulatingMatch(null);
                        }}
                        onStartOvertime={() => {
                            const prevResult = {
                                localScore: leg.localScore,
                                visitanteScore: leg.visitanteScore,
                                stats: leg.stats || null,
                                scoreByQuarter: leg.scoreByQuarter || null,
                                totalPlays: leg.totalPlays || 0,
                                driveCount: leg.driveCount || 0,
                                broadcastTime: leg.broadcastTime || 0,
                            };
                            const otResult = simulateOvertime(
                                localT?.['Team Name'] || 'Local',
                                visitanteT?.['Team Name'] || 'Visitante',
                                true,
                                {
                                    localOff: parseStarValue(localT?.['Offensive Stars'] || 3),
                                    localDef: parseStarValue(localT?.['Deffensive Stars'] || 3),
                                    visitOff: parseStarValue(visitanteT?.['Offensive Stars'] || 3),
                                    visitDef: parseStarValue(visitanteT?.['Deffensive Stars'] || 3),
                                },
                                prevResult
                            );
                            activeSimsRef.current[simId] = {
                                phaseKey: simulatingMatch.phaseKey,
                                matchupId: simulatingMatch.matchupId,
                                legKey: simulatingMatch.legKey,
                                result: otResult,
                                currentIndex: 0,
                                speed: 1,
                                lastTickTime: Date.now(),
                            };
                            setSimulatingMatch(prev => ({ ...prev, readOnly: false }));
                            updateLiveUI();
                        }}
                    />
                );
            })()}
        </div>
    );
}

export default Cup;
