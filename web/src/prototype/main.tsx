import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/schibsted-grotesk/latin-400.css';
import '@fontsource/schibsted-grotesk/latin-600.css';
import '@fontsource/instrument-serif/latin-400.css';
import './proto.css';
import { Prototype } from './Prototype.tsx';

const root = document.getElementById('root');
if (root)
  createRoot(root).render(
    <StrictMode>
      <Prototype />
    </StrictMode>,
  );
