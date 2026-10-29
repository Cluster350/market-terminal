import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { retry } from "./lib/queries";
import { WorkspaceProvider } from "./state/workspace";
import App from "./App";
import "./theme/terminal.css";

const client = new QueryClient({
  defaultOptions: {
    queries: { retry, refetchOnWindowFocus: false, staleTime: 15_000 },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <WorkspaceProvider>
        <App />
      </WorkspaceProvider>
    </QueryClientProvider>
  </StrictMode>,
);
