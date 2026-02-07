import { useEffect, useState } from 'react';
import { subscribeToTeams } from '../services/db';
import { db } from '../firebase';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import './Liga.css';

const YEARS = [2024, 2025, 2026];

function Liga() {
    const [teams, setTeams] = useState([]);
    const [selectedYear, setSelectedYear] = useState(2026);
    const [leagueTeams, setLeagueTeams] = useState([]);
    const [standings, setStandings] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showConfig, setShowConfig] = useState(false);
    const [allTeams, setAllTeams] = useState([]);

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
            } else {
                setLeagueTeams([]);
                setStandings([]);
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
            pj: 0, pg: 0, pe: 0, pp: 0, pf: 0, pc: 0,
            ...existingStanding,
            [field]: parseInt(value) || 0
        };

        // Calculate derived values
        updatedStanding.dif = updatedStanding.pf - updatedStanding.pc;
        updatedStanding.pts = (updatedStanding.pg * 3) + updatedStanding.pe;

        const newStandings = standings.filter(s => s.teamId !== teamId);
        newStandings.push(updatedStanding);

        const docRef = doc(db, 'leagueConfig', String(selectedYear));
        await setDoc(docRef, { standings: newStandings }, { merge: true });
    };

    const getTeamById = (teamId) => allTeams.find(t => t.id === teamId);

    // Get sorted standings for display
    const sortedStandings = [...standings]
        .sort((a, b) => {
            if (b.pts !== a.pts) return b.pts - a.pts;
            if (b.dif !== a.dif) return b.dif - a.dif;
            return b.pf - a.pf;
        });

    const leagueTeamsData = leagueTeams
        .map(id => getTeamById(id))
        .filter(Boolean);

    if (loading) return <div className="loading">Cargando liga...</div>;

    return (
        <div className="liga-container">
            <h2 className="liga-title">⚽ Liga BFL</h2>

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
                    {showConfig ? 'Cerrar Config' : '⚙️ Configurar Equipos'}
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
                    <p>Haz clic en "Configurar Equipos" para agregar equipos.</p>
                </div>
            ) : (
                <div className="standings-wrapper">
                    <table className="standings-table">
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>Equipo</th>
                                <th>PJ</th>
                                <th>PG</th>
                                <th>PE</th>
                                <th>PP</th>
                                <th>PF</th>
                                <th>PC</th>
                                <th>DIF</th>
                                <th>PTS</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sortedStandings.length > 0 ? (
                                sortedStandings.map((standing, index) => {
                                    const team = getTeamById(standing.teamId);
                                    if (!team) return null;
                                    return (
                                        <tr key={standing.teamId} className={index < 3 ? 'top-three' : ''}>
                                            <td className="position">{index + 1}</td>
                                            <td className="team-cell">
                                                {team['URL PHOTO'] && (
                                                    <img src={team['URL PHOTO']} alt="" className="mini-logo" />
                                                )}
                                                {team['Team Name']}
                                            </td>
                                            <td>{standing.pj || 0}</td>
                                            <td>{standing.pg || 0}</td>
                                            <td>{standing.pe || 0}</td>
                                            <td>{standing.pp || 0}</td>
                                            <td>{standing.pf || 0}</td>
                                            <td>{standing.pc || 0}</td>
                                            <td className={standing.dif > 0 ? 'positive' : standing.dif < 0 ? 'negative' : ''}>
                                                {standing.dif > 0 ? '+' : ''}{standing.dif || 0}
                                            </td>
                                            <td className="points">{standing.pts || 0}</td>
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
                                        <td>0</td>
                                        <td>0</td>
                                        <td>0</td>
                                        <td>0</td>
                                        <td>0</td>
                                        <td>0</td>
                                        <td>0</td>
                                        <td className="points">0</td>
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
                                                <label>PJ<input type="number" value={standing.pj || 0} onChange={(e) => updateStanding(team.id, 'pj', e.target.value)} /></label>
                                                <label>PG<input type="number" value={standing.pg || 0} onChange={(e) => updateStanding(team.id, 'pg', e.target.value)} /></label>
                                                <label>PE<input type="number" value={standing.pe || 0} onChange={(e) => updateStanding(team.id, 'pe', e.target.value)} /></label>
                                                <label>PP<input type="number" value={standing.pp || 0} onChange={(e) => updateStanding(team.id, 'pp', e.target.value)} /></label>
                                                <label>PF<input type="number" value={standing.pf || 0} onChange={(e) => updateStanding(team.id, 'pf', e.target.value)} /></label>
                                                <label>PC<input type="number" value={standing.pc || 0} onChange={(e) => updateStanding(team.id, 'pc', e.target.value)} /></label>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

export default Liga;
