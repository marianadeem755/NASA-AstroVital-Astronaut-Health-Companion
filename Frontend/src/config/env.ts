// "/api/v1" goes through the Vite proxy (see vite.config.ts) to the backend on port 8000,
// so the browser never hits a CORS problem.
export const env = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || '/api/v1',
  useMocks: false,
  defaultAstronautId: Number(import.meta.env.VITE_DEFAULT_ASTRONAUT_ID || 1),
};
