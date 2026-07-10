import ReactDOM from "react-dom/client";
import App from "./App";
import "./App.css";
import { initTheme } from "./theme/theme";

initTheme(); // aplica el tema guardado antes del render (evita flash)

// Sin StrictMode a propósito: en dev, StrictMode monta el efecto dos veces,
// lo que spawnearía (y mataría) dos PTYs. Con una terminal real por tile,
// queremos exactamente un montaje.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<App />);
