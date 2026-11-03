
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Header from './components/Header';
import TeamsList from './components/TeamsList';
import FixtureBuilder from './components/FixtureBuilder';
import MatchList from './components/MatchList';
import Palmares from './components/Palmares';
import Liga from './components/Liga';
import Cup from './components/Cup';
import Playoffs from './components/Playoffs';

function App() {
  return (
    <Router>
      <div className="app-container">
        <Header />
        <main className="app-main">
          <Routes>
            <Route path="/" element={<TeamsList />} />
            <Route path="/fixture" element={
              <div className="fixture-page">
                <FixtureBuilder />
                <MatchList />
              </div>
            } />
            <Route path="/palmares" element={<Palmares />} />
            <Route path="/liga" element={<Liga />} />
            <Route path="/cup" element={<Cup />} />
            <Route path="/playoffs" element={<Playoffs />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
