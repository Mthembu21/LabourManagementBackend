/**
 * One-time fix: update WorkingDayScheduleConfig to new productive-hours values.
 * Mon-Thu: 7.5 productive (was 7), Friday: 6 productive (was 5.5).
 * Run once: node scripts/fix_schedule_productive_hours.js
 */
const mongoose = require('mongoose');
const WorkingDayScheduleConfig = require('../models/WorkingDayScheduleConfig');

async function fixScheduleProductiveHours() {
    console.log('🔧 Updating WorkingDayScheduleConfig productive hours...\n');

    const mondayThursday = await WorkingDayScheduleConfig.findOneAndUpdate(
        { day_type: 'monday_thursday' },
        {
            total_scheduled_hours: 9,
            total_fixed_hours: 1.5,
            available_productive_hours: 7.5
        },
        { new: true }
    );

    if (mondayThursday) {
        console.log(`  ✅ Mon-Thu: available_productive_hours = ${mondayThursday.available_productive_hours}`);
    } else {
        console.log('  ⚠️  Mon-Thu schedule not found in DB — will use code fallback (7.5)');
    }

    const friday = await WorkingDayScheduleConfig.findOneAndUpdate(
        { day_type: 'friday' },
        {
            total_scheduled_hours: 7.5,
            total_fixed_hours: 1.5,
            available_productive_hours: 6
        },
        { new: true }
    );

    if (friday) {
        console.log(`  ✅ Friday: available_productive_hours = ${friday.available_productive_hours}`);
    } else {
        console.log('  ⚠️  Friday schedule not found in DB — will use code fallback (6)');
    }

    console.log('\n✨ Done.');
    process.exit(0);
}

if (require.main === module) {
    require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
    require('../config/database')();
    setTimeout(fixScheduleProductiveHours, 2000);
}

module.exports = fixScheduleProductiveHours;
