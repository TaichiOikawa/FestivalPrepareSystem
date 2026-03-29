import { useContext } from "react";
import type { AppContextValue } from "./AppContext.tsx";
import { AppContext } from "./appContextInstance.ts";

export const useAppContext = (): AppContextValue => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useAppContext must be used within AppProvider");
  }

  return context;
};
