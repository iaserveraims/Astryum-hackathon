import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Minimal vitest bootstrap (was referenced by frontend-ci.yml as `test:vitest` but the
// script did not exist — a green CI that ran zero tests). Node env; tests stub `window`
// where they need the DOM, so no jsdom dependency is required for the current suite.
//
// El alias `@` se resuelve como en Next (tsconfig paths): sin esto, cualquier
// módulo que importe `@/services/...` era INTESTEABLE — y eso dejaba fuera de
// la red justo a los ficheros más cableados, como portfolioMerge.
export default defineConfig({
  // Vite 8 (rolldown) no transforma JSX por sí solo en el pipeline SSR de
  // vitest: cualquier módulo .tsx reventaba al parsearse. Algunos módulos con
  // lógica PURA viven en .tsx porque llevan un icono al lado
  // (templateCatalog: las plantillas de MoneyFlows) — sin este plugin esa
  // lógica, la que CONSTRUYE las reglas, era intesteable por un detalle de
  // presentación.
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
