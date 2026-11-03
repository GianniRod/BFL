
import { useEffect, useState } from 'react';
import { subscribeToTeams } from '../services/db';
import { db } from '../firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { getTitleYears, getTitleCount, getUntaggedTitles } from '../services/titles';
import './TeamsList.css';

const CURRENT_YEAR = new Date().getFullYear();

function TeamsList() {
    const [teams, setTeams] = useState([]);
    const [loading, setLoading] = useState(true);
    const [titleYearInput, setTitleYearInput] = useState({}); // { [teamId]: '2026' }

    useEffect(() => {
        const unsubscribe = subscribeToTeams((data) => {
            setTeams(data);
            setLoading(false);
        });
        return () => unsubscribe();
    }, []);

    if (loading) return <div className="loading">Cargando equipos...</div>;

    if (teams.length === 0) {
        const seedTeams = async () => {
            const { addDoc, collection } = await import("firebase/firestore");
            const { db } = await import("../firebase");
            const teamsCollection = collection(db, "teams");

            setLoading(true);
            try {
                for (let i = 1; i <= 12; i++) {
                    await addDoc(teamsCollection, {
                        "Team Name": `Team ${i}`,
                        "Team ID": `TM${i}`,
                        "URL PHOTO": "",
                        "Offensive Stars": 3,
                        "Deffensive Stars": 3,
                        "City": "City Name",
                        "League Titles": 0
                    });
                }
                alert("Equipos creados exitosamente. ¡Recarga la página!");
            } catch (error) {
                console.error(error);
                alert("Error creando equipos. Asegúrate de que las reglas de Firebase permitan escritura en 'teams' temporalmente (allow write: if true).");
            } finally {
                setLoading(false);
            }
        };

        return (
            <div className="teams-empty">
                <h3>No hay equipos cargados</h3>
                <p>La colección "teams" está vacía o no existe.</p>
                <div className="teams-empty-setup">
                    <strong>Modo Configuración</strong>
                    <p>Como es la primera vez, puedes crear los 12 equipos iniciales automáticamente.</p>
                    <button onClick={seedTeams} className="btn-primary">
                        Inicializar Base de Datos (12 Equipos)
                    </button>
                    <p className="teams-empty-note">
                        Nota: Esto requiere que las reglas de seguridad permitan escritura en "teams" temporalmente.
                        <br />
                        <code>match /teams/&#123;team&#125; &#123; allow write: if true; &#125;</code>
                    </p>
                </div>
            </div>
        );
    }

    const updateStars = async (teamId, field, newVal) => {
        // We save the actual decimal value (e.g. 4.5) to the DB from the UI.
        // It's only manually entered DB integers (e.g. 45) that get divided by 10 on read.
        const clamped = Math.min(5, Math.max(0, newVal));
        try {
            await updateDoc(doc(db, 'teams', teamId), { [field]: clamped });
        } catch (e) {
            console.error('Error updating stars:', e);
        }
    };

    // assignExisting: give a year to a title that was loaded without one
    // (the total doesn't change). Otherwise it's a new title.
    const addTitle = async (team, assignExisting = false) => {
        const year = parseInt(titleYearInput[team.id] ?? CURRENT_YEAR, 10);
        if (!year || year < 1900 || year > 2100) {
            alert('Ingresa un año válido.');
            return;
        }
        const years = getTitleYears(team);
        if (years.includes(year)) {
            alert(`${team['Team Name']} ya tiene un título en ${year}.`);
            return;
        }
        const count = getTitleCount(team);
        try {
            await updateDoc(doc(db, 'teams', team.id), {
                'Title Years': [...years, year].sort((a, b) => a - b),
                'League Titles': assignExisting ? count : count + 1,
            });
        } catch (e) {
            console.error('Error adding title:', e);
        }
    };

    const removeTitle = async (team, year) => {
        if (!window.confirm(`¿Quitar el título ${year} de ${team['Team Name']}?`)) return;
        try {
            await updateDoc(doc(db, 'teams', team.id), {
                'Title Years': getTitleYears(team).filter(y => y !== year),
                'League Titles': Math.max(0, getTitleCount(team) - 1),
            });
        } catch (e) {
            console.error('Error removing title:', e);
        }
    };

    const parseStarValue = (v) => {
        const num = parseFloat(v) || 0;
        return num > 5 ? num / 10 : num;
    };

    const renderStars = (rating) => {
        const val = Math.min(5, Math.max(0, parseStarValue(rating)));
        const full = Math.floor(val);
        const hasHalf = val % 1 >= 0.5;
        const stars = [];
        for (let i = 0; i < 5; i++) {
            if (i < full) {
                stars.push(<span key={i} className="star-icon full">★</span>);
            } else if (i === full && hasHalf) {
                stars.push(
                    <span key={i} className="star-icon half-wrap">
                        <span className="star-empty">☆</span>
                        <span className="star-half-fill">★</span>
                    </span>
                );
            } else {
                stars.push(<span key={i} className="star-icon empty">☆</span>);
            }
        }
        return stars;
    };

    const StarEditor = ({ teamId, field, value }) => {
        const val = parseStarValue(value);
        return (
            <div className="star-editor">
                <button className="star-adj-btn" onClick={() => updateStars(teamId, field, val - 0.5)}>−</button>
                <span className="star-display">{renderStars(val)}</span>
                <span className="star-value">{val}</span>
                <button className="star-adj-btn" onClick={() => updateStars(teamId, field, val + 0.5)}>+</button>
            </div>
        );
    };

    return (
        <div className="teams-page">
            <div className="page-header">
                <div>
                    <div className="page-eyebrow">BFL</div>
                    <h2 className="page-title">Equipos</h2>
                </div>
                <span className="page-meta">{teams.length} equipos</span>
            </div>
            <div className="teams-grid">
                {teams.map((team) => (
                    <div key={team.id} className="team-card">
                        <div className="team-header">
                            {team['URL PHOTO'] ? (
                                <img src={team['URL PHOTO']} alt={team['Team Name']} className="team-logo" />
                            ) : (
                                <div className="placeholder-logo">{team['Team ID']}</div>
                            )}
                            <div className="team-heading">
                                <h3>{team['Team Name']}</h3>
                                <span className="team-city">{team['City']}</span>
                            </div>
                        </div>
                        <div className="team-details">
                            <div className="team-meta">
                                <div className="team-meta-item">
                                    <span className="team-meta-label">ID</span>
                                    <span className="team-meta-value">{team['Team ID']}</span>
                                </div>
                                <div className="team-meta-item">
                                    <span className="team-meta-label">Títulos</span>
                                    <span className="team-meta-value">{getTitleCount(team)}</span>
                                </div>
                            </div>
                            <div className="team-titles">
                                {getTitleCount(team) > 0 && (
                                    <div className="title-chips">
                                        {getTitleYears(team).map(year => (
                                            <span key={year} className="title-chip">
                                                🏆 {year}
                                                <button
                                                    className="title-chip-remove"
                                                    onClick={() => removeTitle(team, year)}
                                                    aria-label={`Quitar título ${year}`}
                                                >
                                                    ✕
                                                </button>
                                            </span>
                                        ))}
                                        {getUntaggedTitles(team) > 0 && (
                                            <span className="title-chip untagged">
                                                {getUntaggedTitles(team)} sin año
                                            </span>
                                        )}
                                    </div>
                                )}
                                <div className="title-add">
                                    <input
                                        type="number"
                                        className="title-year-input"
                                        min="1900"
                                        max="2100"
                                        value={titleYearInput[team.id] ?? CURRENT_YEAR}
                                        onChange={(e) => setTitleYearInput(prev => ({ ...prev, [team.id]: e.target.value }))}
                                        aria-label="Año del título"
                                    />
                                    <button className="title-add-btn" onClick={() => addTitle(team)}>
                                        + Título
                                    </button>
                                </div>
                                {getUntaggedTitles(team) > 0 && (
                                    <button className="title-assign-btn" onClick={() => addTitle(team, true)}>
                                        Asignar este año a un título sin año
                                    </button>
                                )}
                            </div>
                            <div className="stars">
                                <div className="star-row">
                                    <span className="star-label">Ofensiva</span>
                                    <StarEditor teamId={team.id} field="Offensive Stars" value={team['Offensive Stars']} />
                                </div>
                                <div className="star-row">
                                    <span className="star-label">Defensa</span>
                                    <StarEditor teamId={team.id} field="Deffensive Stars" value={team['Deffensive Stars']} />
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default TeamsList;
