const normalizeDayOnly = (d) => {
    const dt = new Date(d);
    dt.setHours(0, 0, 0, 0);
    return dt;
};

const addDays = (dateObj, days) => {
    const d = new Date(dateObj);
    d.setDate(d.getDate() + days);
    return d;
};

// Meeus/Jones/Butcher Gregorian algorithm
const easterSunday = (year) => {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=March, 4=April
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return normalizeDayOnly(new Date(year, month - 1, day));
};

const getFixedHoliday = (year, monthIndex, day, name) => ({
    date: normalizeDayOnly(new Date(year, monthIndex, day)),
    name
});

const buildHolidayMapForYear = (year) => {
    const holidays = [];

    holidays.push(getFixedHoliday(year, 0, 1, "New Year's Day"));
    holidays.push(getFixedHoliday(year, 2, 21, 'Human Rights Day'));
    holidays.push(getFixedHoliday(year, 3, 27, 'Freedom Day'));
    holidays.push(getFixedHoliday(year, 4, 1, "Workers' Day"));
    holidays.push(getFixedHoliday(year, 5, 16, 'Youth Day'));
    holidays.push(getFixedHoliday(year, 7, 9, "National Women's Day"));
    holidays.push(getFixedHoliday(year, 8, 24, 'Heritage Day'));
    holidays.push(getFixedHoliday(year, 11, 16, 'Day of Reconciliation'));
    holidays.push(getFixedHoliday(year, 11, 25, 'Christmas Day'));
    holidays.push(getFixedHoliday(year, 11, 26, 'Day of Goodwill'));

    const easter = easterSunday(year);
    holidays.push({ date: addDays(easter, -2), name: 'Good Friday' });
    holidays.push({ date: addDays(easter, 1), name: 'Family Day' });

    const map = new Map();
    for (const h of holidays) {
        map.set(h.date.toISOString().slice(0, 10), h.name);
        // Observed Monday if holiday falls on Sunday
        if (h.date.getDay() === 0) {
            const observed = addDays(h.date, 1);
            map.set(observed.toISOString().slice(0, 10), `${h.name} (Observed)`);
        }
    }
    return map;
};

const getSouthAfricanHolidayInfo = (dateObj) => {
    const d = normalizeDayOnly(dateObj);
    const year = d.getFullYear();

    const map = buildHolidayMapForYear(year);
    const key = d.toISOString().slice(0, 10);
    const name = map.get(key);

    return {
        is_public_holiday: Boolean(name),
        public_holiday_name: name || null
    };
};

module.exports = {
    getSouthAfricanHolidayInfo,
    normalizeDayOnly
};
