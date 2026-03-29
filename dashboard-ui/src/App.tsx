import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Layout from './components/Layout';
import Overview from './pages/Overview';
import Emails from './pages/Emails';
import Finance from './pages/Finance';
import CalendarPage from './pages/CalendarPage';
import Documents from './pages/Documents';
import Subscriptions from './pages/Subscriptions';
import Chat from './pages/Chat';
import Settings from './pages/Settings';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30000, refetchOnWindowFocus: false } },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
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
      </BrowserRouter>
    </QueryClientProvider>
  );
}
