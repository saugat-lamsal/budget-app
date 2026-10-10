import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.js';
import { LOGIN_PATH, pathOf, routeOf } from './app/routes.js';
import { LoginScreen } from './screens/Login.js';
import './ui/tokens.css';
import './ui/base.css';
import './ui/blocks.css';

// The login page (Step 2) is its own screen, outside the tabs.
const login = window.location.pathname === LOGIN_PATH;
// An address that is not one of the app's screens (the bare address) opens Home, and says so.
if (!login && routeOf(window.location.pathname) === null) window.history.replaceState(null, '', pathOf('home'));

const root = document.getElementById('root');
if (root === null) throw new Error('index.html has no #root');
createRoot(root).render(<StrictMode>{login ? <LoginScreen /> : <App />}</StrictMode>);
