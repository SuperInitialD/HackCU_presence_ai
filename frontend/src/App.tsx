import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import SetupScreen from './pages/SetupScreen';
import InterviewRoom from './pages/InterviewRoom';
import ResultsDashboard from './pages/ResultsDashboard';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<SetupScreen />} />
        <Route path="/interview" element={<InterviewRoom />} />
        <Route path="/results" element={<ResultsDashboard />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
