import { useEffect, useState } from 'react';
import { subscribeToTeams } from '../services/db';
import { getTitleYears, getTitleCount, getUntaggedTitles, getTitleFinal, hasScore } from '../services/titles';
import './Palmares.css';

const TROPHY_IMG = 'https://i.postimg.cc/nLdpF6pY/IMG-7422.png';

function Palmares() {
    const [teams, setTeams] = useState([]);
    const [allTeams, setAllTeams] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsubscribe = subscribeToTeams((data) => {
            setAllTeams(data);
            // Only teams with titles, most titles first (ties: most recent title first)
            const sortedTeams = data
                .filter(team => getTitleCount(team) > 0)
                .sort((a, b) =>
                    getTitleCount(b) - getTitleCount(a) ||
                    (getTitleYears(b).at(-1) || 0) - (getTitleYears(a).at(-1) || 0)
                );
            setTeams(sortedTeams);
            setLoading(false);
        });
        return () => unsubscribe();
    }, []);

    if (loading) return <div className="loading">Cargando palmares...</div>;

    if (teams.length === 0) {
        return (
            <div className="palmares-empty">
                <h2>🏆 Palmarés</h2>
                <p>Aún no hay equipos con títulos de liga.</p>
            </div>
        );
    }

    // "Máximo ganador" only when one team has strictly more titles than the rest
    const topCount = getTitleCount(teams[0]);
    const hasSoleLeader = teams.length === 1 || getTitleCount(teams[1]) < topCount;

    return (
        <div className="palmares-container">
            <div className="page-eyebrow">Historial</div>
            <h2 className="palmares-title">Palmarés</h2>
            <p className="palmares-subtitle">Campeones de la BFL</p>

            <div className="palmares-grid">
                {teams.map((team, index) => {
                    const count = getTitleCount(team);
                    const years = getTitleYears(team);
                    const untagged = getUntaggedTitles(team);
                    return (
                        <div key={team.id} className={`palmares-card ${index === 0 && hasSoleLeader ? 'champion' : ''}`}>
                            <div className="palmares-crest">
                                <div className="palmares-logo">
                                    {team['URL PHOTO'] ? (
                                        <img src={team['URL PHOTO']} alt={team['Team Name']} />
                                    ) : (
                                        <div className="placeholder-logo">{team['Team ID']}</div>
                                    )}
                                </div>
                                <div className="palmares-trophies" aria-label={`${count} ${count === 1 ? 'título' : 'títulos'}`}>
                                    {Array.from({ length: count }, (_, i) => (
                                        <img
                                            key={i}
                                            src={TROPHY_IMG}
                                            alt=""
                                            className="palmares-trophy"
                                            title={years[i] ? `Campeón ${years[i]}` : 'Campeón'}
                                        />
                                    ))}
                                </div>
                            </div>
                            <div className="palmares-info">
                                <h3 className="team-name">{team['Team Name']}</h3>
                                <div className="titles-count">{count}</div>
                                <span className="titles-label">
                                    {count === 1 ? 'TÍTULO' : 'TÍTULOS'}
                                </span>
                                {years.length > 0 && (
                                    <div className="palmares-years">
                                        {years.map(year => {
                                            const final = getTitleFinal(team, year);
                                            const rival = allTeams.find(t => t.id === final?.rivalId);
                                            return (
                                                <div key={year} className="palmares-final">
                                                    <span className="palmares-year">{year}</span>
                                                    {rival && (
                                                        <span className="palmares-final-rival">
                                                            <span className="palmares-vs">vs</span>
                                                            {rival['URL PHOTO'] && <img src={rival['URL PHOTO']} alt="" />}
                                                            <span className="palmares-final-name">{rival['Team Name']}</span>
                                                        </span>
                                                    )}
                                                    {hasScore(final) && (
                                                        <span className="palmares-final-score">{final.score}-{final.rivalScore}</span>
                                                    )}
                                                </div>
                                            );
                                        })}
                                        {untagged > 0 && (
                                            <span className="palmares-year untagged">+{untagged} sin año</span>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export default Palmares;
