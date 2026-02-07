
import { useEffect, useState } from 'react';
import { subscribeToMatches } from '../services/db';
import './Fixture.css';

function MatchList() {
    const [matches, setMatches] = useState([]);

    useEffect(() => {
        const unsubscribe = subscribeToMatches((data) => {
            setMatches(data);
        });
        return () => unsubscribe();
    }, []);

    if (matches.length === 0) {
        return <p className="no-matches">No hay partidos programados.</p>;
    }

    return (
        <div className="match-list">
            <h2>Calendario de Partidos</h2>
            {matches.map(match => (
                <div key={match.id} className="match-card">
                    <div className="match-date">
                        {new Date(match.date).toLocaleString()}
                    </div>
                    <div className="match-teams">
                        <span className="home-team">{match.homeTeamName}</span>
                        <span className="vs">vs</span>
                        <span className="away-team">{match.awayTeamName}</span>
                    </div>
                </div>
            ))}
        </div>
    );
}

export default MatchList;
