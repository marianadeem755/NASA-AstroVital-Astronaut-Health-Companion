import type { ComponentType } from 'react';
import type { NavItem } from '../../shared/types/navigation';
import { OverviewPage } from '../../modules/overview/pages/OverviewPage';
import { VitalsPage } from '../../modules/vitals/pages/VitalsPage';
import { RadiationPage } from '../../modules/radiation/pages/RadiationPage';
import { WellbeingPage } from '../../modules/wellbeing/pages/WellbeingPage';
import { SleepPage } from '../../modules/sleep/pages/SleepPage';
import { BoneMusclePage } from '../../modules/bone-muscle/pages/BoneMusclePage';
import { AnalyticsPage } from '../../modules/analytics/pages/AnalyticsPage';
import { AlertsPage } from '../../modules/alerts/pages/AlertsPage';
import { InsightsPage } from '../../modules/insights/pages/InsightsPage';
import { CheckinPage } from '../../modules/checkin/pages/CheckinPage';
import { MissionPage } from '../../modules/mission/pages/MissionPage';
import { MedicalPage } from '../../modules/medical/pages/MedicalPage';

export type AppRoute = NavItem & { element: ComponentType<any> };

export const appRoutes: AppRoute[] = [
  { label: 'Overview', path: '/', element: OverviewPage },
  { label: 'Vitals & Physical', path: '/vitals', element: VitalsPage },
  { label: 'Radiation Monitor', path: '/radiation', element: RadiationPage },
  { label: 'Mental Wellbeing', path: '/wellbeing', element: WellbeingPage },
  { label: 'Sleep Tracker', path: '/sleep', element: SleepPage },
  { label: 'Bone & Muscle', path: '/bone-muscle', element: BoneMusclePage },
  { label: 'Trends & Analytics', path: '/analytics', element: AnalyticsPage },
  { label: 'Risk Alerts', path: '/alerts', element: AlertsPage },
  { label: 'Insights & Actions', path: '/insights', element: InsightsPage },
  { label: 'Daily Check-in', path: '/checkin', element: CheckinPage },
  { label: 'Mission Profile', path: '/mission', element: MissionPage },
  { label: 'Medical View', path: '/medical', element: MedicalPage },
];
