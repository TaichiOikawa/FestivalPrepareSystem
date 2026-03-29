import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, Route, Routes } from "react-router-dom";
import App from "./App.tsx";
import { AppProvider } from "./context/AppContext";
import "./index.css";
import RoomPlanPage from "./pages/RoomPlanPage";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProvider>
      <HashRouter>
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/room-plans" element={<RoomPlanPage />} />
        </Routes>
      </HashRouter>
    </AppProvider>
  </StrictMode>,
);
