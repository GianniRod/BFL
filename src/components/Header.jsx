
import { NavLink } from 'react-router-dom';
import './Header.css';

const icon = (paths) => (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {paths}
    </svg>
);

const NAV_ITEMS = [
    {
        to: '/', label: 'Equipos', end: true,
        icon: icon(<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>)
    },
    {
        to: '/fixture', label: 'Fixture',
        icon: icon(<><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>)
    },
    {
        to: '/liga', label: 'Liga',
        icon: icon(<><path d="M3 3v18h18" /><path d="M7 15v2M11 11v6M15 7v10M19 13v4" /></>)
    },
    {
        to: '/cup', label: 'Cup',
        icon: icon(<><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" /><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" /><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" /></>)
    },
    {
        to: '/playoffs', label: 'Playoffs',
        icon: icon(<><path d="M3 5h5v4H3zM3 15h5v4H3zM16 10h5v4h-5z" /><path d="M8 7h3v10H8M11 12h5" /></>)
    },
    {
        to: '/palmares', label: 'Palmarés',
        icon: icon(<><circle cx="12" cy="8" r="6" /><path d="M15.48 12.89 17 22l-5-3-5 3 1.52-9.11" /></>)
    },
];

function Header() {
    return (
        <>
            <header className="app-header">
                <div className="app-header-inner">
                    <NavLink to="/" className="logo" aria-label="Inicio">
                        <img src="https://i.postimg.cc/ZYx0Dhqb/BRASIL-2.png" alt="BFL" className="header-logo" />
                    </NavLink>
                    <nav className="top-nav">
                        {NAV_ITEMS.map(item => (
                            <NavLink key={item.to} to={item.to} end={item.end} className="nav-link">
                                {item.label}
                            </NavLink>
                        ))}
                    </nav>
                </div>
            </header>

            <nav className="tab-bar" aria-label="Navegación principal">
                {NAV_ITEMS.map(item => (
                    <NavLink key={item.to} to={item.to} end={item.end} className="tab-link">
                        {item.icon}
                        <span>{item.label}</span>
                    </NavLink>
                ))}
            </nav>
        </>
    );
}

export default Header;
