
import { useEffect, useState } from 'react';
import { subscribeToTeams } from '../services/db';
import './TeamsList.css';

function TeamsList() {
    const [teams, setTeams] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsubscribe = subscribeToTeams((data) => {
            setTeams(data);
            setLoading(false);
        });
        return () => unsubscribe();
    }, []);

    if (loading) return <div>Cargando equipos...</div>;

    if (teams.length === 0) {
        return (
            <div style={{ padding: '20px', border: '1px solid #333', borderRadius: '8px' }}>
                <h3>No hay equipos cargados</h3>
                <p>Por favor, crea manualmente los documentos en la colección "teams" desde la consola de Firebase.</p>
                <p>Estructura esperada por documento:</p>
                <ul style={{ textAlign: 'left', display: 'inline-block' }}>
                    <li>Team Name</li>
                    <li>Team ID (3 letras)</li>
                    <li>URL PHOTO</li>
                    <li>Offensive Stars (1-5)</li>
                    <li>Deffensive Stars (1-5)</li>
                    <li>City</li>
                    <li>League Titles (número)</li>
                </ul>
            </div>
        );
    }

    return (
        <div className="teams-grid">
            {teams.map((team) => (
                <div key={team.id} className="team-card">
                    <div className="team-header">
                        {team['URL PHOTO'] ? (
                            <img src={team['URL PHOTO']} alt={team['Team Name']} className="team-logo" />
                        ) : (
                            <div className="placeholder-logo">{team['Team ID']}</div>
                        )}
                        <h3>{team['Team Name']}</h3>
                    </div>
                    <div className="team-details">
                        <p><strong>ID:</strong> {team['Team ID']}</p>
                        <p><strong>Ciudad:</strong> {team['City']}</p>
                        <p><strong>Títulos:</strong> {team['League Titles']}</p>
                        <div className="stars">
                            <span>Ofensiva: {'★'.repeat(Math.min(5, Math.max(0, team['Offensive Stars'] || 0)))}</span>
                            <span>Defensa: {'★'.repeat(Math.min(5, Math.max(0, team['Deffensive Stars'] || 0)))}</span>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}

export default TeamsList;
