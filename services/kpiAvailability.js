// Central availability denominator rules shared by KPI calculations.
// NOTE: This module is intentionally dependency-free.

const AVAILABLE_PRODUCTIVE_HOURS = {
  weekday: 7,
  friday: 5.5
};

const AVAILABLE_HOURS = {
  weekday: 8.5,
  friday: 7
};

function _middayUTC(date) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function _isFridayUTC(date) {
  return _middayUTC(date).getUTCDay() === 5; // 0=Sun..5=Fri
}

function getAvailability(date) {
  const isFriday = _isFridayUTC(date);
  return {
    available_hours: isFriday ? AVAILABLE_HOURS.friday : AVAILABLE_HOURS.weekday,
    available_productive_hours: isFriday
      ? AVAILABLE_PRODUCTIVE_HOURS.friday
      : AVAILABLE_PRODUCTIVE_HOURS.weekday
  };
}

module.exports = { getAvailability };

