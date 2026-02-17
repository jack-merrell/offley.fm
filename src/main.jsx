import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import TuneStationPage from './TuneStationPage';
import AllStationsPage from './AllStationsPage';
import './styles.css';

const isTuneStationRoute = window.location.pathname === '/tune-station' || window.location.pathname === '/tune-station/';
const isAllStationsRoute = window.location.pathname === '/all-stations' || window.location.pathname === '/all-stations/';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isTuneStationRoute ? <TuneStationPage /> : isAllStationsRoute ? <AllStationsPage /> : <App />}
  </React.StrictMode>
);
