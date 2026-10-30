import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './ErrorBoundary';
import { I18nProvider } from './i18n';
import { loadBuiltinLibrary, loadUserLibrary } from './editor/library';
import './styles.css';
import { applyTheme, loadTheme } from './theme';

// Library parts must be registered before the first render: the palette and the example circuits look them up.
applyTheme(loadTheme());
loadBuiltinLibrary();
loadUserLibrary();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </I18nProvider>
  </StrictMode>,
);
