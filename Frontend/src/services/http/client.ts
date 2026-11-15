import axios from 'axios';
import { env } from '../../config/env';

export const http = axios.create({ baseURL: env.apiBaseUrl, timeout: 12000, headers: { 'Content-Type': 'application/json' } });

/** FastAPI sends `detail` as a string (HTTPException) or as a list of {loc, msg} (422 validation).
 *  A list used to become "[object Object]"; this turns it into readable text like "steps: Input should be ...". */
function readDetail(detail: unknown): string | null {
  if (!detail) return null;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d) => {
        const item = d as { loc?: unknown[]; msg?: string };
        const field = (item.loc ?? []).filter((p) => p !== 'body').join('.');
        return field ? `${field}: ${item.msg ?? 'invalid value'}` : item.msg ?? 'invalid value';
      })
      .join(' | ');
  }
  return String(detail);
}

http.interceptors.response.use(
  (r) => r,
  (e) => {
    const message = readDetail(e.response?.data?.detail) || e.message || 'Request failed';
    return Promise.reject(new Error(String(message)));
  },
);