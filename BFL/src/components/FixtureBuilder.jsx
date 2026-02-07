
import { useState, useEffect } from 'react';
import { getTeams, addMatch } from '../services/db';
import './Fixture.css';

function FixtureBuilder({ onMatchAdded }) {
    const [teams, setTeams] = useState([]);
    const [homeTeamId, setHomeTeamId] = useState('');
    const [awayTeamId, setAwayTeamId] = useState('');
    const [date, setDate] = useState('');
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('');

    useEffect(() => {
        const fetchTeams = async () => {
            const data = await getTeams();
            setTeams(data);
        };
        fetchTeams();
    }, []);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setMessage('');

        if (!homeTeamId || !awayTeamId || !date) {
            setMessage('Por favor completa todos los campos.');
            return;
        }

        if (homeTeamId === awayTeamId) {
            setMessage('El equipo local y visitante no pueden ser el mismo.');
            return;
        }

        setLoading(true);
        try {
            const homeTeam = teams.find(t => t.id === homeTeamId);
            const awayTeam = teams.find(t => t.id === awayTeamId);

            await addMatch({
                homeTeamId,
                homeTeamName: homeTeam['Team Name'],
                awayTeamId,
                awayTeamName: awayTeam['Team Name'],
                date,
                status: 'scheduled'
            });

            setMessage('¡Partido programado exitosamente!');
            setHomeTeamId('');
            setAwayTeamId('');
            setDate('');
            if (onMatchAdded) onMatchAdded();
        } catch (error) {
            console.error(error);
            setMessage('Error al programar el partido.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixture-builder">
            <h2>Programar Partido</h2>
            <form onSubmit={handleSubmit} className="fixture-form">
                <div className="form-group">
                    <label>Local:</label>
                    <select value={homeTeamId} onChange={(e) => setHomeTeamId(e.target.value)}>
                        <option value="">Seleccionar Equipo</option>
                        {teams.map(team => (
                            <option key={team.id} value={team.id}>{team['Team Name']}</option>
                        ))}
                    </select>
                </div>

                <div className="form-group">
                    <label>Visitante:</label>
                    <select value={awayTeamId} onChange={(e) => setAwayTeamId(e.target.value)}>
                        <option value="">Seleccionar Equipo</option>
                        {teams.map(team => (
                            <option key={team.id} value={team.id}>{team['Team Name']}</option>
                        ))}
                    </select>
                </div>

                <div className="form-group">
                    <label>Fecha y Hora:</label>
                    <input
                        type="datetime-local"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                    />
                </div>

                <button type="submit" disabled={loading}>
                    {loading ? 'Programando...' : 'Programar'}
                </button>
            </form>
            {message && <p className="message">{message}</p>}
        </div>
    );
}

export default FixtureBuilder;
