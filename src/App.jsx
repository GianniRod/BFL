
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Header from './components/Header';
import TeamsList from './components/TeamsList';
import FixtureBuilder from './components/FixtureBuilder';
import MatchList from './components/MatchList';
import Palmares from './components/Palmares';
import Liga from './components/Liga';

function App() {
  return (
    <Router>
      <div className="app-container">
        <Header />
        <main style={{ padding: '20px' }}>
          <Routes>
            <Route path="/" element={<TeamsList />} />
            <Route path="/fixture" element={
              <div className="fixture-page">
                <FixtureBuilder />
                <hr style={{ borderColor: '#333', margin: '30px 0' }} />
                <MatchList />
              </div>
            } />
            <Route path="/palmares" element={<Palmares />} />
            <Route path="/liga" element={<Liga />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;

