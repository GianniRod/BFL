import { useEffect, useState } from 'react';
import { subscribeToTeams } from '../services/db';
import './Palmares.css';

function Palmares() {
    const [teams, setTeams] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsubscribe = subscribeToTeams((data) => {
            // Sort by titles descending, filter only teams with titles > 0
            const sortedTeams = data
                .filter(team => team['League Titles'] > 0)
                .sort((a, b) => b['League Titles'] - a['League Titles']);
            setTeams(sortedTeams);
            setLoading(false);
        });
        return () => unsubscribe();
    }, []);

    if (loading) return <div className="loading">Cargando palmares...</div>;

    if (teams.length === 0) {
        return (
            <div className="palmares-empty">
                <h2>🏆 Palmares</h2>
                <p>Aún no hay equipos con títulos de liga.</p>
            </div>
        );
    }

    return (
        <div className="palmares-container">
            <h2 className="palmares-title">🏆 Palmares</h2>
            <p className="palmares-subtitle">Campeones de la BFL</p>

            <div className="palmares-grid">
                {teams.map((team, index) => (
                    <div key={team.id} className={`palmares-card ${index === 0 ? 'champion' : ''}`}>
                        <div className="palmares-logo">
                            {team['URL PHOTO'] ? (
                                <img src={team['URL PHOTO']} alt={team['Team Name']} />
                            ) : (
                                <div className="placeholder-logo">{team['Team ID']}</div>
                            )}
                        </div>
                        <div className="palmares-info">
                            <h3 className="team-name">{team['Team Name']}</h3>
                            <div className="titles-count">{team['League Titles']}</div>
                            <span className="titles-label">
                                {team['League Titles'] === 1 ? 'TÍTULO' : 'TÍTULOS'}
                            </span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default Palmares;
