import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/popup/app.component';
import styles from '@/popup/app.module.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Popup root element #root not found');
}

document.body.className = styles.body;

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
