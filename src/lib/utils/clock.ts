let simulatedTime: Date | null = null;

export const Clock = {
  /**
   * Returns the current date/time. If a simulated time is configured, 
   * returns that mock date. Otherwise, returns a new Date().
   */
  now(): Date {
    return simulatedTime ? new Date(simulatedTime.getTime()) : new Date();
  },

  /**
   * Overrides the current time returned by Clock.now().
   * Only permitted in development or test environments.
   */
  setSimulatedTime(time: Date | string | null) {
    if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
      if (typeof time === 'string') {
        simulatedTime = new Date(time);
      } else {
        simulatedTime = time;
      }
    }
  },

  /**
   * Resets the simulated time override, returning Clock.now() to real time.
   */
  reset() {
    simulatedTime = null;
  }
};
