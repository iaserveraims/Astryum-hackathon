'use client';

/**
 * LA PORTADA — dos ficheros, una regla.
 *
 * Fundador, al preparar el release de la ventana a `main`: «en
 * staging se han hecho modificaciones a la landing sobre legacy e
 * institutional. Estas dos no deben aparecer en main production, debe
 * quedarse la landing tal cual está actualmente en main production».
 */

import dynamic from 'next/dynamic';
import { isProductionDeploy } from '@/lib/nav/hackathonHub';

const LandingPage = dynamic(() => import('@/components/landing/LandingPage'));
const LandingPageProduction = dynamic(() => import('@/components/landing/LandingPageProduction'));

export default function Page() {
  return isProductionDeploy() ? <LandingPageProduction /> : <LandingPage />;
}
