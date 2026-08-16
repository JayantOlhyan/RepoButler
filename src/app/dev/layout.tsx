import { redirect } from 'next/navigation';
import { isSimulatorAllowed } from '@/lib/simulator/guard';

export default function DevLayout({ children }: { children: React.ReactNode }) {
  // Enforce server-side security checks
  if (!isSimulatorAllowed()) {
    redirect('/');
  }

  return <>{children}</>;
}
