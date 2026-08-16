/**
 * Backend security guard for the simulator features.
 * 
 * Enforces development/testing bounds:
 * 1. NODE_ENV must be "development" or "test"
 * 2. DEV_SIMULATOR_ENABLED must be "true"
 * 
 * If either condition fails, the simulator will be blocked.
 */
export function isSimulatorAllowed(): boolean {
  const isDevOrTest = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
  const isEnabled = process.env.DEV_SIMULATOR_ENABLED === 'true';
  return isDevOrTest && isEnabled;
}
