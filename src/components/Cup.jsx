import { useEffect, useState, useRef } from 'react';
import { subscribeToTeams } from '../services/db';
import { db } from '../firebase';
import { doc, setDoc, onSnapshot } from 'firebase/firestore';
import './Cup.css';
import GameSimulator, { simulateGame, parseStarValue } from './GameSimulator';

const YEARS = [2024, 2025, 2026];
const PHASE_KEYS = ['octavos', 'cuartos', 'semis', 'final'];
const PHASE_NAMES = {
    octavos: 'Octavos de Final',
    cuartos: 'Cuartos de Final',
    semis: 'Semifinales',
    final: 'Final',
};
const PHASE_MATCHUP_COUNT = { octavos: 8, cuartos: 4, semis: 2, final: 1 };

function Cup() {
    const [selectedYear, setSelectedYear] = useState(2026);
    const [allTeams, setAllTeams] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showConfig, setShowConfig] = useState(false);
    const [phases, setPhases] = useState({});
    const [selectedPhase, setSelectedPhase] = useState('octavos');
    const [simulatingMatch, setSimulatingMatch] = useState(null);

    // Live simulations
    const activeSimsRef = useRef({});
    const [liveMatchesUI, setLiveMatchesUI] = useState({});
    const phasesRef = useRef({});
    const phasesLoadedRef = useRef(false);

    // Ref for updateLegBothScores to avoid stale closures
    const updateLegBothScoresRef = useRef(null);

    // Subscribe to teams
    useEffect(() => {
        const unsub = subscribeToTeams((data) => {
            setAllTeams(data);
            setLoading(false);
        });
        return () => unsub();
    }, []);

    // Subscribe to cup config
    useEffect(() => {
        phasesLoadedRef.current = false;
        const docRef = doc(db, 'cupConfig', String(selectedYear));
        const unsub = onSnapshot(docRef, (snap) => {
            if (snap.exists()) {
                const data = snap.data();
                const loadedPhases = data.phases || {};
                setPhases(loadedPhases);
                phasesRef.current = loadedPhases;
            } else {
                setPhases({});
                phasesRef.current = {};
            }
            phasesLoadedRef.current = true;
        });
        return () => unsub();
    }, [selectedYear]);

    useEffect(() => {
        phasesRef.current = phases;
    }, [phases]);

    // ── Live Simulation Engine (same pattern as Liga) ──
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
                    down: play.down,
                    yardsToGo: play.yardsToGo,
                    speed: sim.speed,
                    isActive: true,
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

                if (sim.targetIndex != null && sim.currentIndex < sim.targetIndex) {
                    const advanceAmount = Math.max(1, Math.min(15, Math.floor((sim.targetIndex - sim.currentIndex) / 3)));
                    sim.currentIndex += advanceAmount;
                    if (sim.currentIndex >= sim.targetIndex) {
                        sim.currentIndex = sim.targetIndex;
                        sim.targetIndex = null;
                        sim.lastTickTime = now;
                    }
                    hasChanges = true;
                    return;
                }

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
                if (updateLegBothScoresRef.current) {
                    updateLegBothScoresRef.current(
                        sim.phaseKey, sim.matchupId, sim.legKey,
                        String(r.localScore), String(r.visitanteScore),
                        r.stats, scoringPlays, r.totalPlays, r.driveCount, r.broadcastTime, r.scoreByQuarter
                    );
                }
                setSimulatingMatch(prev => {
                    if (prev && prev.simId === pid) return { ...prev, readOnly: true };
                    return prev;
                });
                hasChanges = true;
            });

            if (hasChanges) updateLiveUI();
        }, 100);
        return () => clearInterval(ticker);
    }, []);

    const startLiveSimulation = (phaseKey, matchupId, legKey, localTeam, visitanteTeam, simId) => {
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
        activeSimsRef.current[simId] = {
            phaseKey, matchupId, legKey,
            result, currentIndex: 0, speed: 1, lastTickTime: Date.now(),
        };
        updateLiveUI();
    };

    // ── Firestore persistence ──
    const savePhases = async (newPhases) => {
        const docRef = doc(db, 'cupConfig', String(selectedYear));
        await setDoc(docRef, { phases: newPhases }, { merge: true });
    };

    const addMatchup = async (phaseKey, team1Id, team2Id) => {
        const current = { ...phasesRef.current };
        if (!current[phaseKey]) current[phaseKey] = { matchups: [] };
        const matchups = [...(current[phaseKey].matchups || [])];
        const isBye = !team2Id || team2Id === 'BYE';

        const newMatchup = {
            id: Date.now(),
            team1Id,
            team2Id: isBye ? null : team2Id,
            isBye,
            winnerId: isBye ? team1Id : null,
        };

        if (!isBye) {
            if (phaseKey === 'final') {
                newMatchup.ida = {
                    localId: team1Id, visitanteId: team2Id,
                    localScore: null, visitanteScore: null, dateTime: null,
                };
            } else {
                newMatchup.ida = {
                    localId: team1Id, visitanteId: team2Id,
                    localScore: null, visitanteScore: null, dateTime: null,
                };
                newMatchup.vuelta = {
                    localId: team2Id, visitanteId: team1Id,
                    localScore: null, visitanteScore: null, dateTime: null,
                };
            }
        }

        matchups.push(newMatchup);
        current[phaseKey] = { ...current[phaseKey], matchups };
        await savePhases(current);
    };

    const removeMatchup = async (phaseKey, matchupId) => {
        const current = { ...phasesRef.current };
        if (!current[phaseKey]) return;
        const matchups = current[phaseKey].matchups.filter(m => m.id !== matchupId);
        current[phaseKey] = { ...current[phaseKey], matchups };
        await savePhases(current);
    };

    const updateLegBothScores = async (phaseKey, matchupId, legKey, localScore, visitanteScore, stats, scoringPlays, totalPlays, driveCount, broadcastTime, scoreByQuarter) => {
        const current = { ...phasesRef.current };
        if (!phasesLoadedRef.current) return;
        if (!current[phaseKey]) return;

        const matchups = current[phaseKey].matchups.map(m => {
            if (m.id !== matchupId) return m;
            const updatedLeg = {
                ...m[legKey],
                localScore: localScore === '' ? null : parseInt(localScore),
                visitanteScore: visitanteScore === '' ? null : parseInt(visitanteScore),
                stats: stats || null,
                scoringPlays: scoringPlays || null,
                totalPlays: totalPlays || null,
                driveCount: driveCount || null,
                broadcastTime: broadcastTime || null,
                scoreByQuarter: scoreByQuarter || null,
            };
            const updated = { ...m, [legKey]: updatedLeg };
            // Re-compute winner
            updated.winnerId = computeWinner(updated, phaseKey);
            return updated;
        });

        current[phaseKey] = { ...current[phaseKey], matchups };
        await savePhases(current);
    };

    useEffect(() => {
        updateLegBothScoresRef.current = updateLegBothScores;
    }, [updateLegBothScores]);

    const updateLegDateTime = async (phaseKey, matchupId, legKey, dateTime) => {
        const current = { ...phasesRef.current };
        if (!current[phaseKey]) return;
        const matchups = current[phaseKey].matchups.map(m => {
            if (m.id !== matchupId) return m;
            return { ...m, [legKey]: { ...m[legKey], dateTime } };
        });
        current[phaseKey] = { ...current[phaseKey], matchups };
        await savePhases(current);
    };

    const resetLeg = async (phaseKey, matchupId, legKey) => {
        if (!window.confirm('¿Resetear este partido? Se borrarán los scores y estadísticas.')) return;
        const current = { ...phasesRef.current };
        if (!current[phaseKey]) return;
        const matchups = current[phaseKey].matchups.map(m => {
            if (m.id !== matchupId) return m;
            const updated = {
                ...m,
                [legKey]: {
                    ...m[legKey],
                    localScore: null, visitanteScore: null,
                    stats: null, scoringPlays: null, totalPlays: null,
                    driveCount: null, broadcastTime: null, scoreByQuarter: null,
                },
                winnerId: null,
            };
            return updated;
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
            // Tie in final → team1 wins (higher seed)
            return matchup.team1Id;
        }
        // Two legs
        const ida = matchup.ida;
        const vuelta = matchup.vuelta;
        if (!ida || !vuelta) return null;
        if (ida.localScore == null || ida.visitanteScore == null) return null;
        if (vuelta.localScore == null || vuelta.visitanteScore == null) return null;

        // team1 scored: ida.localScore (as home) + vuelta.visitanteScore (as away)
        const team1Agg = (ida.localScore || 0) + (vuelta.visitanteScore || 0);
        // team2 scored: ida.visitanteScore (as away) + vuelta.localScore (as home)
        const team2Agg = (ida.visitanteScore || 0) + (vuelta.localScore || 0);

        if (team1Agg > team2Agg) return matchup.team1Id;
        if (team2Agg > team1Agg) return matchup.team2Id;
        // Aggregate tie → away goals rule: team with more away points
        const team1Away = vuelta.visitanteScore || 0; // team1 scored as visitor in vuelta
        const team2Away = ida.visitanteScore || 0;     // team2 scored as visitor in ida
        if (team1Away > team2Away) return matchup.team1Id;
        if (team2Away > team1Away) return matchup.team2Id;
        // Still tied → team1 (higher seed) advances
        return matchup.team1Id;
    };

    // ── Helpers ──
    const getTeamById = (teamId) => allTeams.find(t => t.id === teamId);

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

    const getPhaseMatchups = (phaseKey) => {
        return phases[phaseKey]?.matchups || [];
    };

    const getAggregateText = (matchup) => {
        if (matchup.isBye || !matchup.ida || !matchup.vuelta) return null;
        const ida = matchup.ida;
        const vuelta = matchup.vuelta;
        if (ida.localScore == null || vuelta.localScore == null) return null;
        const t1 = (ida.localScore || 0) + (vuelta.visitanteScore || 0);
        const t2 = (ida.visitanteScore || 0) + (vuelta.localScore || 0);
        return { team1Agg: t1, team2Agg: t2 };
    };

    // Get teams that already won in a given phase and could play the next
    const getAvailableTeamsForPhase = (phaseKey) => {
        const phaseIdx = PHASE_KEYS.indexOf(phaseKey);
        if (phaseIdx === 0) return allTeams; // octavos - all teams available
        const prevPhase = PHASE_KEYS[phaseIdx - 1];
        const prevMatchups = getPhaseMatchups(prevPhase);
        const winners = prevMatchups.filter(m => m.winnerId).map(m => m.winnerId);
        // Return only teams that won in the previous phase
        return allTeams.filter(t => winners.includes(t.id));
    };

    // Check if a phase is complete (all matchups have winners)
    const isPhaseComplete = (phaseKey) => {
        const matchups = getPhaseMatchups(phaseKey);
        const expected = PHASE_MATCHUP_COUNT[phaseKey];
        if (matchups.length < expected) return false;
        return matchups.every(m => m.winnerId);
    };

    // Get the champion
    const getChampion = () => {
        const finalMatchups = getPhaseMatchups('final');
        if (finalMatchups.length === 1 && finalMatchups[0].winnerId) {
            return getTeamById(finalMatchups[0].winnerId);
        }
        return null;
    };

    if (loading) return <div className="loading">Cargando copa...</div>;

    const champion = getChampion();

    return (
        <div className="cup-container">
            <h2 className="cup-title">🏆 CUP</h2>
            <p className="cup-subtitle">Torneo de Eliminación Directa</p>

            <div className="cup-year-selector">
                <label>Temporada:</label>
                <select value={selectedYear} onChange={(e) => setSelectedYear(parseInt(e.target.value))}>
                    {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
                <button className="cup-config-btn" onClick={() => setShowConfig(!showConfig)}>
                    {showConfig ? 'Cerrar Config' : '⚙️ Configurar'}
                </button>
            </div>

            {/* Champion Banner */}
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

            {/* Phase Tabs */}
            <div className="cup-phase-tabs">
                {PHASE_KEYS.map(key => {
                    const matchups = getPhaseMatchups(key);
                    const complete = isPhaseComplete(key);
                    return (
                        <button
                            key={key}
                            className={`cup-phase-tab ${selectedPhase === key ? 'active' : ''} ${complete ? 'completed' : ''}`}
                            onClick={() => setSelectedPhase(key)}
                        >
                            {PHASE_NAMES[key]}
                            {matchups.length > 0 && (
                                <span className="tab-count">{matchups.filter(m => m.winnerId).length}/{matchups.length}</span>
                            )}
                        </button>
                    );
                })}
            </div>

            {/* Current Phase Content */}
            <div className="cup-matchups-container">
                {getPhaseMatchups(selectedPhase).length === 0 ? (
                    <div className="cup-empty-state">
                        <span className="empty-icon">🏟️</span>
                        <p>No hay llaves configuradas para {PHASE_NAMES[selectedPhase]}.</p>
                        <p>Activa "Configurar" para agregar matchups.</p>
                    </div>
                ) : (
                    getPhaseMatchups(selectedPhase).map((matchup, idx) => {
                        const team1 = getTeamById(matchup.team1Id);
                        const team2 = matchup.team2Id ? getTeamById(matchup.team2Id) : null;
                        const winnerTeam = matchup.winnerId ? getTeamById(matchup.winnerId) : null;
                        const agg = selectedPhase !== 'final' ? getAggregateText(matchup) : null;

                        return (
                            <div key={matchup.id} className={`cup-matchup-card ${matchup.isBye ? 'bye-card' : ''} ${matchup.winnerId ? 'winner-decided' : ''}`}>
                                <div className="cup-matchup-header">
                                    <span className="cup-matchup-number">Llave {idx + 1}</span>
                                    <div className="cup-matchup-teams">
                                        <span className={`cup-matchup-team ${matchup.winnerId === matchup.team1Id ? 'winner-team' : ''} ${matchup.winnerId && matchup.winnerId !== matchup.team1Id ? 'loser-team' : ''}`}>
                                            {team1?.['URL PHOTO'] && <img src={team1['URL PHOTO']} alt="" />}
                                            {team1?.['Team Name'] || '???'}
                                        </span>
                                        <span className="cup-matchup-vs">vs</span>
                                        <span className={`cup-matchup-team ${matchup.winnerId === matchup.team2Id ? 'winner-team' : ''} ${matchup.winnerId && matchup.winnerId !== matchup.team2Id ? 'loser-team' : ''}`}>
                                            {matchup.isBye ? (
                                                <span className="cup-bye-badge">BYE</span>
                                            ) : (
                                                <>
                                                    {team2?.['URL PHOTO'] && <img src={team2['URL PHOTO']} alt="" />}
                                                    {team2?.['Team Name'] || '???'}
                                                </>
                                            )}
                                        </span>
                                    </div>
                                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                        {matchup.winnerId && winnerTeam && (
                                            <span className="cup-winner-badge">
                                                🏅 {winnerTeam['Team Name']}
                                            </span>
                                        )}
                                        {showConfig && (
                                            <button className="cup-remove-matchup-btn" onClick={() => removeMatchup(selectedPhase, matchup.id)}>✕</button>
                                        )}
                                    </div>
                                </div>

                                {/* Legs */}
                                {!matchup.isBye && (
                                    <div className="cup-legs-container">
                                        {/* IDA */}
                                        {matchup.ida && (
                                            <LegCard
                                                label="IDA"
                                                leg={matchup.ida}
                                                phaseKey={selectedPhase}
                                                matchupId={matchup.id}
                                                legKey="ida"
                                                getTeamById={getTeamById}
                                                formatDateTime={formatDateTime}
                                                showConfig={showConfig}
                                                liveMatchesUI={liveMatchesUI}
                                                onUpdateDateTime={(dt) => updateLegDateTime(selectedPhase, matchup.id, 'ida', dt)}
                                                onClick={() => {
                                                    if (showConfig) return;
                                                    const simId = `cup_${matchup.id}_ida`;
                                                    if (liveMatchesUI[simId]) {
                                                        setSimulatingMatch({ phaseKey: selectedPhase, matchupId: matchup.id, legKey: 'ida', simId, readOnly: false, liveState: true });
                                                    } else if (matchup.ida.localScore === null) {
                                                        setSimulatingMatch({ phaseKey: selectedPhase, matchupId: matchup.id, legKey: 'ida', simId, readOnly: false });
                                                    } else {
                                                        setSimulatingMatch({ phaseKey: selectedPhase, matchupId: matchup.id, legKey: 'ida', simId, readOnly: true });
                                                    }
                                                }}
                                            />
                                        )}
                                        {/* VUELTA (not for final) */}
                                        {matchup.vuelta && selectedPhase !== 'final' && (
                                            <LegCard
                                                label="VUELTA"
                                                leg={matchup.vuelta}
                                                phaseKey={selectedPhase}
                                                matchupId={matchup.id}
                                                legKey="vuelta"
                                                getTeamById={getTeamById}
                                                formatDateTime={formatDateTime}
                                                showConfig={showConfig}
                                                liveMatchesUI={liveMatchesUI}
                                                onUpdateDateTime={(dt) => updateLegDateTime(selectedPhase, matchup.id, 'vuelta', dt)}
                                                onClick={() => {
                                                    if (showConfig) return;
                                                    const simId = `cup_${matchup.id}_vuelta`;
                                                    if (liveMatchesUI[simId]) {
                                                        setSimulatingMatch({ phaseKey: selectedPhase, matchupId: matchup.id, legKey: 'vuelta', simId, readOnly: false, liveState: true });
                                                    } else if (matchup.vuelta.localScore === null) {
                                                        setSimulatingMatch({ phaseKey: selectedPhase, matchupId: matchup.id, legKey: 'vuelta', simId, readOnly: false });
                                                    } else {
                                                        setSimulatingMatch({ phaseKey: selectedPhase, matchupId: matchup.id, legKey: 'vuelta', simId, readOnly: true });
                                                    }
                                                }}
                                            />
                                        )}
                                    </div>
                                )}

                                {/* Aggregate */}
                                {agg && (
                                    <div className="cup-aggregate">
                                        Global: <strong>{agg.team1Agg}</strong> - <strong>{agg.team2Agg}</strong>
                                    </div>
                                )}

                                {matchup.isBye && (
                                    <div className="cup-aggregate">
                                        Clasificado directo a {PHASE_NAMES[PHASE_KEYS[PHASE_KEYS.indexOf(selectedPhase) + 1]] || 'siguiente fase'}
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}

                {/* Add matchup form */}
                {showConfig && (
                    <div className="cup-add-matchup-form">
                        <select id={`cup-team1-${selectedPhase}`} defaultValue="">
                            <option value="" disabled>Equipo 1</option>
                            {getAvailableTeamsForPhase(selectedPhase).map(t => (
                                <option key={t.id} value={t.id}>{t['Team Name']}</option>
                            ))}
                        </select>
                        <span className="vs-text">vs</span>
                        <select id={`cup-team2-${selectedPhase}`} defaultValue="">
                            <option value="" disabled>Equipo 2</option>
                            {selectedPhase === 'octavos' && <option value="BYE">🔄 BYE (Clasificado)</option>}
                            {getAvailableTeamsForPhase(selectedPhase).map(t => (
                                <option key={t.id} value={t.id}>{t['Team Name']}</option>
                            ))}
                        </select>
                        <button
                            className="cup-add-matchup-btn"
                            onClick={() => {
                                const s1 = document.getElementById(`cup-team1-${selectedPhase}`);
                                const s2 = document.getElementById(`cup-team2-${selectedPhase}`);
                                if (s1.value) {
                                    addMatchup(selectedPhase, s1.value, s2.value || null);
                                    s1.value = '';
                                    s2.value = '';
                                }
                            }}
                        >
                            + Agregar Llave
                        </button>
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
                    localScore: leg.localScore,
                    visitanteScore: leg.visitanteScore,
                    stats: leg.stats,
                    log: leg.scoringPlays || [],
                    totalPlays: leg.totalPlays || 0,
                    driveCount: leg.driveCount || 0,
                    broadcastTime: leg.broadcastTime || 0,
                    scoreByQuarter: leg.scoreByQuarter || null,
                } : null;

                const liveEngine = activeSimsRef.current[simId];

                return (
                    <GameSimulator
                        localTeam={localT}
                        visitanteTeam={visitanteT}
                        isLocalHome={true}
                        matchDateTime={leg.dateTime}
                        readOnlyResult={readOnlyData}
                        liveEngine={liveEngine}
                        onStartLive={() => startLiveSimulation(
                            simulatingMatch.phaseKey, simulatingMatch.matchupId,
                            simulatingMatch.legKey, localT, visitanteT, simId
                        )}
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
                                if (targetIdx === -1) targetIdx = liveEngine.result.log.length;
                                liveEngine.targetIndex = targetIdx;
                            }
                        }}
                        onFinish={(lScore, vScore, stats, scoringPlays, totalPlays, driveCount, broadcastTime, scoreByQuarter) => {
                            updateLegBothScores(
                                simulatingMatch.phaseKey, simulatingMatch.matchupId, simulatingMatch.legKey,
                                String(lScore), String(vScore), stats, scoringPlays, totalPlays, driveCount, broadcastTime, scoreByQuarter
                            );
                            setSimulatingMatch(null);
                        }}
                        onClose={() => setSimulatingMatch(null)}
                        onReset={async () => {
                            if (activeSimsRef.current[simId]) {
                                delete activeSimsRef.current[simId];
                            }
                            updateLiveUI();
                            await resetLeg(simulatingMatch.phaseKey, simulatingMatch.matchupId, simulatingMatch.legKey);
                            setSimulatingMatch(null);
                        }}
                    />
                );
            })()}
        </div>
    );
}

// ── Leg Card Sub-component ──
function LegCard({ label, leg, phaseKey, matchupId, legKey, getTeamById, formatDateTime, showConfig, liveMatchesUI, onUpdateDateTime, onClick }) {
    const localTeam = getTeamById(leg.localId);
    const visitanteTeam = getTeamById(leg.visitanteId);
    const simId = `cup_${matchupId}_${legKey}`;
    const liveData = liveMatchesUI[simId];

    return (
        <div className={`cup-leg-card ${!showConfig ? 'clickable' : ''}`} onClick={showConfig ? undefined : onClick}>
            <div className="cup-leg-label">{label}</div>
            <div className="cup-leg-teams">
                <div className="cup-leg-team local-team">
                    {localTeam?.['URL PHOTO'] && <img src={localTeam['URL PHOTO']} alt="" />}
                    <span>{localTeam?.['Team Name'] || '???'}</span>
                </div>
                <div className="cup-leg-score">
                    {liveData ? (
                        <div className="cup-live-badge">
                            <span className="cup-live-pulse"></span>
                            <span className="cup-live-text">Q{liveData.quarter} {Math.floor(liveData.clock / 60)}:{(liveData.clock % 60).toString().padStart(2, '0')}</span>
                            <span className="score-num" style={{ margin: '0 4px' }}>{liveData.localScore}</span>
                            <span className="score-sep">-</span>
                            <span className="score-num" style={{ margin: '0 4px' }}>{liveData.visitanteScore}</span>
                        </div>
                    ) : leg.localScore !== null && leg.visitanteScore !== null ? (
                        <>
                            <span className={`score-num ${leg.localScore < leg.visitanteScore ? 'loser-score' : ''}`}>{leg.localScore}</span>
                            <span className="score-sep">-</span>
                            <span className={`score-num ${leg.visitanteScore < leg.localScore ? 'loser-score' : ''}`}>{leg.visitanteScore}</span>
                        </>
                    ) : (
                        <span className="cup-leg-vs">VS</span>
                    )}
                </div>
                <div className="cup-leg-team" style={{ justifyContent: 'flex-end' }}>
                    <span>{visitanteTeam?.['Team Name'] || '???'}</span>
                    {visitanteTeam?.['URL PHOTO'] && <img src={visitanteTeam['URL PHOTO']} alt="" />}
                </div>
            </div>
            {showConfig ? (
                <input
                    type="datetime-local"
                    className="cup-datetime-edit"
                    value={leg.dateTime || ''}
                    onChange={(e) => onUpdateDateTime(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                />
            ) : (
                leg.dateTime && !liveData && (
                    <div className="cup-leg-datetime">{formatDateTime(leg.dateTime)}</div>
                )
            )}
        </div>
    );
}

export default Cup;
