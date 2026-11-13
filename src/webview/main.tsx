import { createRoot } from 'react-dom/client';
import { App, type HostBridge } from './App';
import './style.css';
declare function acquireVsCodeApi(): HostBridge;
const bridge = acquireVsCodeApi();
const root = document.getElementById('root');
if (root) createRoot(root).render(<App bridge={bridge} />);
