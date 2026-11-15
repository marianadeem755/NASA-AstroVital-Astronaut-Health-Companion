import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { MainLayout } from '../layouts/MainLayout';
import { appRoutes } from './routes.config';

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<MainLayout />}>
          {appRoutes.map(({ path, element: Page, ...item }) => (
            <Route
              key={path}
              path={path}
              element={<Page {...(path === '/' ? {} : { item })} />}
            />
          ))}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
