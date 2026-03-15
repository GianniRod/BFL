
import { useEffect, useState, useRef } from 'react';
import { subscribeToMatches, subscribeToTeams, updateMatch } from '../services/db';
import GameSimulator, { simulateGame } from './GameSimulator';
import './Fixture.css';
import './Liga.css';

function MatchList() {
    const [matches, setMatches] = useState([]);
    const [allTeams, setAllTeams] = useState([]);
    const [simulatingMatch, setSimulatingMatch] = useState(null);

    // Live simulation engine (same pattern as Liga)
    const activeSimsRef = useRef({});
    const [liveMatchesUI, setLiveMatchesUI] = useState({});

    useEffect(() => {
        const unsubscribe = subscribeToMatches((data) => {
            setMatches(data);
        });
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        const unsubscribe = subscribeToTeams((data) => {
            setAllTeams(data);
        });
        return () => unsubscribe();
    }, []);

    const getTeamById = (id) => allTeams.find(t => t.id === id);

    const parseStarValue = (val) => {
        if (typeof val === 'number') return val;
        const n = parseFloat(val);
        return isNaN(n) ? 3 : n;
    };

    const updateLiveUI = () => {
        const newState = {};
        Object.entries(activeSimsRef.current).forEach(([mid, sim]) => {
            const play = sim.result.log[Math.min(sim.currentIndex, sim.result.log.length - 1)];
            if (play) {
                newState[mid] = {
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

    // Background ticker (same logic as Liga)
    useEffect(() => {
        const ticker = setInterval(() => {
            const now = Date.now();
            let hasChanges = false;
            let finishedMatches = [];

            Object.entries(activeSimsRef.current).forEach(([mid, sim]) => {
                if (sim.currentIndex >= sim.result.log.length) {
                    finishedMatches.push({ mid, sim });
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

            finishedMatches.forEach(({ mid, sim }) => {
                if (!sim.finished) {
                    sim.finished = true;
                    const scoringPlays = sim.result.log.filter(l =>
                        ['touchdown', 'field_goal', 'safety', 'pick_six', 'game_end'].includes(l.eventType)
                    );

                    updateMatch(mid, {
                        localScore: sim.result.localScore,
                        visitanteScore: sim.result.visitanteScore,
                        stats: sim.result.stats || null,
                        scoringPlays: scoringPlays || null,
                        totalPlays: sim.result.totalPlays || null,
                        driveCount: sim.result.driveCount || null,
                        broadcastTime: sim.result.broadcastTime || null,
                        scoreByQuarter: sim.result.scoreByQuarter || null
                    }).catch(err => console.error("Error auto-saving fixture:", err));

                    try {
                        const saved = JSON.parse(localStorage.getItem('bfl_fixture_sims') || '{}');
                        delete saved[mid];
                        if (Object.keys(saved).length > 0) {
                            localStorage.setItem('bfl_fixture_sims', JSON.stringify(saved));
                        } else {
                            localStorage.removeItem('bfl_fixture_sims');
                        }
                    } catch (e) { }
                }

                delete activeSimsRef.current[mid];
                setSimulatingMatch(prev => {
                    if (prev && prev.matchId === mid) {
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

    const startLiveSimulation = (matchId, localTeam, visitanteTeam) => {
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
        activeSimsRef.current[matchId] = {
            result,
            currentIndex: 0,
            speed: 1,
            lastTickTime: Date.now()
        };
        updateLiveUI();
    };

    const formatMatchDate = (dateStr) => {
        if (!dateStr) return '';
        const d = new Date(dateStr);
        const dias = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];
        const day = dias[d.getDay()];
        const dd = d.getDate().toString().padStart(2, '0');
        const mm = (d.getMonth() + 1).toString().padStart(2, '0');
        const hh = d.getHours().toString().padStart(2, '0');
        const min = d.getMinutes().toString().padStart(2, '0');
        return `${day} ${dd}/${mm} - ${hh}:${min}`;
    };

    if (matches.length === 0) {
        return <p className="no-matches">No hay partidos programados.</p>;
    }

    const currentMatch = simulatingMatch ? matches.find(m => m.id === simulatingMatch.matchId) : null;
    const localTeam = currentMatch ? getTeamById(currentMatch.homeTeamId) : null;
    const visitanteTeam = currentMatch ? getTeamById(currentMatch.awayTeamId) : null;
    const liveEngine = simulatingMatch ? activeSimsRef.current[simulatingMatch.matchId] : null;

    return (
        <div className="fixture-match-list">
            <h2 style={{ textAlign: 'center', marginBottom: '20px', fontSize: '1.5rem' }}>Partidos Programados</h2>
            <div className="fixture-matches-container">
                {matches.map(match => {
                    const home = getTeamById(match.homeTeamId);
                    const away = getTeamById(match.awayTeamId);
                    const live = liveMatchesUI[match.id];

                    return (
                        <div
                            key={match.id}
                            className="partido-card clickable"
                            onClick={() => {
                                if (live) {
                                    setSimulatingMatch({ matchId: match.id, liveState: true });
                                } else if (match.localScore !== null && match.localScore !== undefined) {
                                    setSimulatingMatch({ matchId: match.id, readOnly: true });
                                } else {
                                    setSimulatingMatch({ matchId: match.id, readOnly: false });
                                }
                            }}
                        >
                            <div className="partido-row">
                                <div className="partido-left-side">
                                    <div className="partido-team local">
                                        {home?.['URL PHOTO'] && (
                                            <img src={home['URL PHOTO']} alt="" className="partido-logo" />
                                        )}
                                        <span>{home?.['Team Name'] || match.homeTeamName}</span>
                                        {live?.possession === 'local' && (
                                            <span className="possession-icon">🏈</span>
                                        )}
                                    </div>
                                </div>
                                <div className="partido-center">
                                    {live ? (
                                        <div className="live-match-card-display">
                                            <div className="live-badge-row">
                                                <span className="live-pulse"></span>
                                                <span className="live-text-badge">EN VIVO Q{live.quarter} {Math.floor(live.clock / 60)}:{(live.clock % 60).toString().padStart(2, '0')}</span>
                                            </div>
                                            <div className="score-display-final">
                                                <span className="score-num">{live.localScore}</span>
                                                <span className="score-separator">-</span>
                                                <span className="score-num">{live.visitanteScore}</span>
                                            </div>
                                            {live.down != null && (
                                                <div className="live-down-distance">
                                                    {['1st', '2nd', '3rd', '4th'][live.down - 1] || `${live.down}th`} & {live.yardsToGo} | Yd {live.yardLine}
                                                </div>
                                            )}
                                        </div>
                                    ) : match.localScore !== null && match.visitanteScore !== null && match.localScore !== undefined ? (
                                        <div className="score-display-final">
                                            <span className={`score-num ${Number(match.localScore) < Number(match.visitanteScore) ? 'loser-score' : ''}`}>
                                                {match.localScore}
                                            </span>
                                            <span className="score-separator">-</span>
                                            <span className={`score-num ${Number(match.visitanteScore) < Number(match.localScore) ? 'loser-score' : ''}`}>
                                                {match.visitanteScore}
                                            </span>
                                        </div>
                                    ) : match.localScore !== null && match.visitanteScore !== null && match.localScore !== undefined ? (
                                        <div className="score-display-final">
                                            <span className={`score-num ${Number(match.localScore) < Number(match.visitanteScore) ? 'loser-score' : ''}`}>
                                                {match.localScore}
                                            </span>
                                            <span className="score-separator">-</span>
                                            <span className={`score-num ${Number(match.visitanteScore) < Number(match.localScore) ? 'loser-score' : ''}`}>
                                                {match.visitanteScore}
                                            </span>
                                        </div>
                                    ) : (
                                        <div className="partido-vs-area">
                                            <span className="vs-badge">VS</span>
                                            {match.date && (
                                                <div className="partido-datetime">
                                                    {formatMatchDate(match.date)}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                                <div className="partido-right-side">
                                    <div className="partido-team visitante">
                                        {live?.possession === 'visitante' && (
                                            <span className="possession-icon">🏈</span>
                                        )}
                                        <span>{away?.['Team Name'] || match.awayTeamName}</span>
                                        {away?.['URL PHOTO'] && (
                                            <img src={away['URL PHOTO']} alt="" className="partido-logo" />
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Game Simulator Modal */}
            {simulatingMatch && localTeam && visitanteTeam && (
                <GameSimulator
                    localTeam={localTeam}
                    visitanteTeam={visitanteTeam}
                    isLocalHome={true}
                    readOnlyResult={simulatingMatch.readOnly ? currentMatch : null}
                    liveEngine={simulatingMatch.liveState ? liveEngine : null}
                    matchDateTime={currentMatch?.date || null}
                    onClose={() => setSimulatingMatch(null)}
                    onStartLive={() => {
                        startLiveSimulation(simulatingMatch.matchId, localTeam, visitanteTeam);
                        setSimulatingMatch(prev => ({ ...prev, liveState: true }));
                    }}
                    onSpeedChange={(newSpeed) => {
                        if (activeSimsRef.current[simulatingMatch.matchId]) {
                            activeSimsRef.current[simulatingMatch.matchId].speed = newSpeed;
                        }
                    }}
                    onSkipToEnd={() => {
                        const engine = activeSimsRef.current[simulatingMatch.matchId];
                        if (engine) {
                            engine.currentIndex = engine.result.log.length;
                            updateLiveUI();
                        }
                    }}
                    onSimulateUntil={(targetSeconds) => {
                        const engine = activeSimsRef.current[simulatingMatch.matchId];
                        if (engine) {
                            let targetIdx = engine.result.log.findIndex(p => p.broadcastTime >= targetSeconds);
                            if (targetIdx === -1) targetIdx = engine.result.log.length;
                            engine.targetIndex = targetIdx;
                        }
                    }}
                    onFinish={async (lScore, vScore, stats, scoringPlays, totalPlays, driveCount, broadcastTime, scoreByQuarter) => {
                        await updateMatch(simulatingMatch.matchId, {
                            localScore: lScore,
                            visitanteScore: vScore,
                            stats: stats || null,
                            scoringPlays: scoringPlays || null,
                            totalPlays: totalPlays || null,
                            driveCount: driveCount || null,
                            broadcastTime: broadcastTime || null,
                            scoreByQuarter: scoreByQuarter || null
                        });
                        setSimulatingMatch(null);
                    }}
                    onReset={async () => {
                        if (activeSimsRef.current[simulatingMatch.matchId]) {
                            delete activeSimsRef.current[simulatingMatch.matchId];
                        }
                        try {
                            const saved = JSON.parse(localStorage.getItem('bfl_fixture_sims') || '{}');
                            delete saved[simulatingMatch.matchId];
                            if (Object.keys(saved).length > 0) {
                                localStorage.setItem('bfl_fixture_sims', JSON.stringify(saved));
                            } else {
                                localStorage.removeItem('bfl_fixture_sims');
                            }
                        } catch (e) { }
                        updateLiveUI();

                        await updateMatch(simulatingMatch.matchId, {
                            localScore: null,
                            visitanteScore: null,
                            stats: null,
                            scoringPlays: null,
                            totalPlays: null,
                            driveCount: null,
                            broadcastTime: null,
                            scoreByQuarter: null
                        });
                        setSimulatingMatch(null);
                    }}
                />
            )}
        </div>
    );
}

export default MatchList;
