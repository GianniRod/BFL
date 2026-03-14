
import { useEffect, useState } from 'react';
import { subscribeToTeams } from '../services/db';
import { db } from '../firebase';
import { doc, updateDoc } from 'firebase/firestore';
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
            <div style={{ padding: '20px', border: '1px solid #333', borderRadius: '8px' }}>
                <h3>No hay equipos cargados</h3>
                <p>La colección "teams" está vacía o no existe.</p>
                <div style={{ margin: '20px 0', padding: '15px', background: '#220', border: '1px solid #550' }}>
                    <strong>Modo Configuración:</strong>
                    <p>Como es la primera vez, puedes crear los 12 equipos iniciales automáticamente.</p>
                    <button onClick={seedTeams} style={{ background: '#d4af37', color: 'black', fontWeight: 'bold' }}>
                        Inicializar Base de Datos (12 Equipos)
                    </button>
                    <p style={{ fontSize: '0.8em', marginTop: '10px' }}>
                        Nota: Esto requiere que las reglas de seguridad permitan escritura en "teams" temporalmente.
                        <br />
                        <code>match /teams/&#123;team&#125; &#123; allow write: if true; &#125;</code>
                    </p>
                </div>
            </div>
        );
    }

    const updateStars = async (teamId, field, newVal) => {
        const clamped = Math.min(5, Math.max(0, newVal));
        try {
            await updateDoc(doc(db, 'teams', teamId), { [field]: clamped });
        } catch (e) {
            console.error('Error updating stars:', e);
        }
    };

    const renderStars = (rating) => {
        const val = Math.min(5, Math.max(0, parseFloat(rating) || 0));
        const full = Math.floor(val);
        const hasHalf = val % 1 >= 0.5;
        const empty = 5 - full - (hasHalf ? 1 : 0);
        return (
            <>
                {'★'.repeat(full)}
                {hasHalf && <span className="half-star">★</span>}
                {'☆'.repeat(empty)}
            </>
        );
    };

    const StarEditor = ({ teamId, field, value }) => {
        const val = parseFloat(value) || 0;
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
                            <div className="star-row">
                                <span className="star-label">Ofensiva:</span>
                                <StarEditor teamId={team.id} field="Offensive Stars" value={team['Offensive Stars']} />
                            </div>
                            <div className="star-row">
                                <span className="star-label">Defensa:</span>
                                <StarEditor teamId={team.id} field="Deffensive Stars" value={team['Deffensive Stars']} />
                            </div>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}

export default TeamsList;
