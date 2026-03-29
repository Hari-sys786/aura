import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Overview from './pages/Overview';
import Emails from './pages/Emails';
import Finance from './pages/Finance';
import CalendarPage from './pages/CalendarPage';
import Documents from './pages/Documents';
import Subscriptions from './pages/Subscriptions';
import Chat from './pages/Chat';
import Settings from './pages/Settings';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Overview />} />
        <Route path="/emails" element={<Emails />} />
        <Route path="/finance" element={<Finance />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/documents" element={<Documents />} />
        <Route path="/subscriptions" element={<Subscriptions />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
