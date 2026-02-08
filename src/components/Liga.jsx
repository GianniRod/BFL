import { useEffect, useState } from 'react';
import { subscribeToTeams } from '../services/db';
import { db } from '../firebase';
import { doc, setDoc, onSnapshot } from 'firebase/firestore';
import './Liga.css';

const YEARS = [2024, 2025, 2026];

function Liga() {
    const [selectedYear, setSelectedYear] = useState(2026);
    const [leagueTeams, setLeagueTeams] = useState([]);
    const [standings, setStandings] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showConfig, setShowConfig] = useState(false);
    const [allTeams, setAllTeams] = useState([]);
    const [fechas, setFechas] = useState([]);
    const [expandedFecha, setExpandedFecha] = useState(null);

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
            } else {
                setLeagueTeams([]);
                setStandings([]);
                setFechas([]);
            }
        });
        return () => unsubscribe();
    }, [selectedYear]);

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

    const updateStanding = async (teamId, field, value) => {
        const existingStanding = standings.find(s => s.teamId === teamId);
        const updatedStanding = {
            teamId,
            v: 0, p: 0, pf: 0, pc: 0, lastResults: [],
            ...existingStanding,
            [field]: field === 'lastResults' ? value : (parseInt(value) || 0)
        };

        // Calculate derived values
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
        const newResults = [...currentResults, result].slice(-5); // Keep last 5
        await updateStanding(teamId, 'lastResults', newResults);
    };

    const clearResults = async (teamId) => {
        await updateStanding(teamId, 'lastResults', []);
    };

    // Fechas (match days) management
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

    const addPartido = async (fechaId, localId, visitanteId) => {
        const newPartido = {
            id: Date.now(),
            localId,
            visitanteId,
            localScore: null,
            visitanteScore: null
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

    const getTeamById = (teamId) => allTeams.find(t => t.id === teamId);

    // Get sorted standings for display (by PCT descending, then by NP)
    const sortedStandings = [...standings]
        .sort((a, b) => {
            const pctA = parseFloat(a.pct) || 0;
            const pctB = parseFloat(b.pct) || 0;
            if (pctB !== pctA) return pctB - pctA;
            return (b.np || 0) - (a.np || 0);
        });

    const leagueTeamsData = leagueTeams
        .map(id => getTeamById(id))
        .filter(Boolean);

    // Render last results as colored dots
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
                    onChange={(e) => setSelectedYear(parseInt(e.target.value))}
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
                                    return (
                                        <tr key={standing.teamId} className={index < 4 ? 'playoff' : ''}>
                                            <td className="position">{index + 1}</td>
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
                                leagueTeamsData.map((team, index) => (
                                    <tr key={team.id}>
                                        <td className="position">{index + 1}</td>
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
                                ))
                            )}
                        </tbody>
                    </table>

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
                            <h3>Calendario de Partidos</h3>
                            {showConfig && (
                                <button className="add-fecha-btn" onClick={addFecha}>+ Agregar Fecha</button>
                            )}
                        </div>

                        {fechas.length === 0 ? (
                            <p className="no-fechas">No hay fechas configuradas. {showConfig && 'Haz clic en "+ Agregar Fecha" para comenzar.'}</p>
                        ) : (
                            <div className="fechas-list">
                                {fechas.map((fecha) => (
                                    <div key={fecha.id} className="fecha-card">
                                        <div
                                            className="fecha-header-row"
                                            onClick={() => setExpandedFecha(expandedFecha === fecha.id ? null : fecha.id)}
                                        >
                                            {showConfig ? (
                                                <input
                                                    type="text"
                                                    className="fecha-nombre-input"
                                                    value={fecha.nombre}
                                                    onChange={(e) => updateFechaNombre(fecha.id, e.target.value)}
                                                    onClick={(e) => e.stopPropagation()}
                                                />
                                            ) : (
                                                <span className="fecha-nombre">{fecha.nombre}</span>
                                            )}
                                            <div className="fecha-actions">
                                                <span className="partidos-count">{fecha.partidos.length} partidos</span>
                                                <span className="expand-icon">{expandedFecha === fecha.id ? '▼' : '▶'}</span>
                                                {showConfig && (
                                                    <button
                                                        className="remove-fecha-btn"
                                                        onClick={(e) => { e.stopPropagation(); removeFecha(fecha.id); }}
                                                    >
                                                        ✕
                                                    </button>
                                                )}
                                            </div>
                                        </div>

                                        {expandedFecha === fecha.id && (
                                            <div className="fecha-partidos">
                                                {fecha.partidos.length === 0 ? (
                                                    <p className="no-partidos">No hay partidos en esta fecha</p>
                                                ) : (
                                                    fecha.partidos.map((partido) => {
                                                        const local = getTeamById(partido.localId);
                                                        const visitante = getTeamById(partido.visitanteId);
                                                        return (
                                                            <div key={partido.id} className="partido-row">
                                                                <div className="partido-team local">
                                                                    {local?.['URL PHOTO'] && (
                                                                        <img src={local['URL PHOTO']} alt="" className="partido-logo" />
                                                                    )}
                                                                    <span>{local?.['Team Name'] || 'Equipo'}</span>
                                                                </div>
                                                                <div className="partido-score">
                                                                    {showConfig ? (
                                                                        <>
                                                                            <input
                                                                                type="number"
                                                                                min="0"
                                                                                className="score-input"
                                                                                value={partido.localScore ?? ''}
                                                                                onChange={(e) => updatePartidoScore(fecha.id, partido.id, 'localScore', e.target.value)}
                                                                            />
                                                                            <span className="score-separator">-</span>
                                                                            <input
                                                                                type="number"
                                                                                min="0"
                                                                                className="score-input"
                                                                                value={partido.visitanteScore ?? ''}
                                                                                onChange={(e) => updatePartidoScore(fecha.id, partido.id, 'visitanteScore', e.target.value)}
                                                                            />
                                                                        </>
                                                                    ) : (
                                                                        <span className="score-display">
                                                                            {partido.localScore ?? '-'} - {partido.visitanteScore ?? '-'}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <div className="partido-team visitante">
                                                                    <span>{visitante?.['Team Name'] || 'Equipo'}</span>
                                                                    {visitante?.['URL PHOTO'] && (
                                                                        <img src={visitante['URL PHOTO']} alt="" className="partido-logo" />
                                                                    )}
                                                                </div>
                                                                {showConfig && (
                                                                    <button
                                                                        className="remove-partido-btn"
                                                                        onClick={() => removePartido(fecha.id, partido.id)}
                                                                    >
                                                                        ✕
                                                                    </button>
                                                                )}
                                                            </div>
                                                        );
                                                    })
                                                )}

                                                {showConfig && (
                                                    <div className="add-partido-form">
                                                        <select id={`local-${fecha.id}`} defaultValue="">
                                                            <option value="" disabled>Local</option>
                                                            {leagueTeamsData.map(team => (
                                                                <option key={team.id} value={team.id}>{team['Team Name']}</option>
                                                            ))}
                                                        </select>
                                                        <span className="vs-text">vs</span>
                                                        <select id={`visitante-${fecha.id}`} defaultValue="">
                                                            <option value="" disabled>Visitante</option>
                                                            {leagueTeamsData.map(team => (
                                                                <option key={team.id} value={team.id}>{team['Team Name']}</option>
                                                            ))}
                                                        </select>
                                                        <button
                                                            className="add-partido-btn"
                                                            onClick={() => {
                                                                const localSelect = document.getElementById(`local-${fecha.id}`);
                                                                const visitanteSelect = document.getElementById(`visitante-${fecha.id}`);
                                                                if (localSelect.value && visitanteSelect.value) {
                                                                    addPartido(fecha.id, localSelect.value, visitanteSelect.value);
                                                                    localSelect.value = '';
                                                                    visitanteSelect.value = '';
                                                                }
                                                            }}
                                                        >
                                                            + Agregar Partido
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

export default Liga;
