
import { Link } from 'react-router-dom';
import './Header.css';

function Header() {
    return (
        <header className="app-header">
            <div className="logo">BFL</div>
            <nav>
                <Link to="/">Equipos</Link>
                <Link to="/fixture">Fixture</Link>
                <Link to="/palmares">Palmares</Link>
                <Link to="/liga">Liga</Link>
            </nav>
        </header>
    );
}

export default Header;

