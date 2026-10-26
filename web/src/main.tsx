import { createRoot } from 'react-dom/client';
import { Guest } from './guest/Guest';
import { Host } from './host/Host';
import './styles.css';

const path = window.location.pathname;
const guestMatch = path.match(/^\/s\/([A-Za-z0-9]+)/);

function App() {
  if (guestMatch) return <Guest code={guestMatch[1].toUpperCase()} />;
  if (path === '/' || path.startsWith('/host') || path.startsWith('/callback')) return <Host />;
  return <p className="center">Page not found</p>;
}

createRoot(document.getElementById('root')!).render(<App />);
