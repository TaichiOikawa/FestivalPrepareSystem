import { createContext } from "react";
import type { AppContextValue } from "./AppContext.tsx";

export const AppContext = createContext<AppContextValue | null>(null);
