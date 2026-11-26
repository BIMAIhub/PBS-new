import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { BrandingProvider } from './live/Branding';
import { MobileAppProvider } from './live/MobileApp';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrandingProvider><MobileAppProvider><App /></MobileAppProvider></BrandingProvider>
  </StrictMode>,
);
