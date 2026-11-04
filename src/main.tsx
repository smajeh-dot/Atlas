import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// KaTeX fonts must be declared on the page: Chromium ignores @font-face inside a shadow root.
import 'katex/dist/katex.min.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
