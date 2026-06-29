const mongoose = require('mongoose');
const WorkingDayScheduleConfig = require('../models/WorkingDayScheduleConfig');
const AttendanceRecord = require('../models/AttendanceRecord');
const TimeLog = require('../models/TimeLog');
const DayEntry = require('../models/DayEntry');

async function migrateToNewSchedule() {
    console.log('🚀 Starting migration to new time allocation model...\n');

    try {
        // Step 1: Create default WorkingDayScheduleConfig entries
        console.log('📋 Step 1: Creating WorkingDayScheduleConfig entries...');

        const mondayThursday = await WorkingDayScheduleConfig.findOneAndUpdate(
            { day_type: 'monday_thursday' },
            {
                day_type: 'monday_thursday',
                total_scheduled_hours: 9,
                fixed_non_productive_blocks: [
                    { name: 'Meeting', duration_hours: 0.25 },
                    { name: 'Tea Break', duration_hours: 0.25 },
                    { name: 'Lunch', duration_hours: 0.5 },
                    { name: 'Housekeeping', duration_hours: 0.5 }
                ],
                total_fixed_hours: 1.5,
                available_productive_hours: 7.5,
                is_active: true,
                effective_from: new Date()
            },
            { upsert: true, new: true }
        );
        console.log('  ✅ Created Monday-Thursday schedule (9 hours total, 7.5 hours productive)');

        const friday = await WorkingDayScheduleConfig.findOneAndUpdate(
            { day_type: 'friday' },
            {
                day_type: 'friday',
                total_scheduled_hours: 7.5,
                fixed_non_productive_blocks: [
                    { name: 'Meeting', duration_hours: 0.25 },
                    { name: 'Tea Break', duration_hours: 0.25 },
                    { name: 'Lunch', duration_hours: 0.5 },
                    { name: 'Housekeeping', duration_hours: 0.5 }
                ],
                total_fixed_hours: 1.5,
                available_productive_hours: 6,
                is_active: true,
                effective_from: new Date()
            },
            { upsert: true, new: true }
        );
        console.log('  ✅ Created Friday schedule (7.5 hours total, 6 hours productive)\n');

        // Step 2: Convert existing leave/sick entries in TimeLog to AttendanceRecord
        console.log('📋 Step 2: Converting TimeLog leave/sick entries to AttendanceRecord...');

        const leaveEntries = await TimeLog.find({ is_leave: true });
        console.log(`  Found ${leaveEntries.length} leave entries to migrate`);

        let migratedCount = 0;
        const failedMigrations = [];

        for (const entry of leaveEntries) {
            try {
                // Check if AttendanceRecord already exists
                const existing = await AttendanceRecord.findOne({
                    supervisor_key: entry.supervisor_key,
                    technician_id: entry.technician_id,
                    date: entry.log_date
                });

                if (!existing) {
                    const date = new Date(entry.log_date);
                    const dayIndex = date.getDay();
                    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                    const dayOfWeek = dayNames[dayIndex];

                    // Only migrate if it's a weekday
                    if (dayIndex === 0 || dayIndex === 6) {
                        continue;
                    }

                    // Determine hours based on day of week
                    const hours_credited = dayIndex === 5 ? 7 : 8;

                    // Create AttendanceRecord
                    await AttendanceRecord.create({
                        supervisor_key: entry.supervisor_key,
                        technician_id: entry.technician_id,
                        technician_name: entry.technician_name || 'Unknown',
                        date: new Date(entry.log_date),
                        day_of_week: dayOfWeek,
                        attendance_type: 'leave',
                        hours_credited: hours_credited,
                        status: 'approved',
                        approved_by: 'system-migration',
                        approved_at: new Date(),
                        notes: 'Migrated from TimeLog'
                    });

                    migratedCount++;
                }
            } catch (error) {
                failedMigrations.push({
                    entry_id: entry._id,
                    error: error.message
                });
                console.error(`  ❌ Error migrating entry ${entry._id}:`, error.message);
            }
        }

        console.log(`  ✅ Successfully migrated ${migratedCount} leave entries`);
        if (failedMigrations.length > 0) {
            console.log(`  ⚠️  Failed to migrate ${failedMigrations.length} entries`);
        }
        console.log();

        // Step 3: Update DayEntry records to include schedule_config_id
        console.log('📋 Step 3: Updating DayEntry records with schedule_config_id...');

        const dayEntries = await DayEntry.find({});
        console.log(`  Found ${dayEntries.length} DayEntry records to update`);

        let dayEntryUpdatedCount = 0;
        for (const dayEntry of dayEntries) {
            try {
                const dayOfWeek = dayEntry.day_of_week || new Date(dayEntry.date).getDay();
                const dayType = dayOfWeek === 5 ? 'friday' : 'monday_thursday';
                const scheduleConfig = await WorkingDayScheduleConfig.findOne({ day_type: dayType });

                if (scheduleConfig) {
                    await DayEntry.updateOne(
                        { _id: dayEntry._id },
                        {
                            schedule_config_id: scheduleConfig._id,
                            system_allocated_non_productive_hours: 1.5
                        }
                    );
                    dayEntryUpdatedCount++;
                }
            } catch (error) {
                console.error(`  ❌ Error updating DayEntry ${dayEntry._id}:`, error.message);
            }
        }

        console.log(`  ✅ Successfully updated ${dayEntryUpdatedCount} DayEntry records\n`);

        // Final summary
        console.log('✨ Migration completed successfully!');
        console.log('📊 Summary:');
        console.log(`  • WorkingDayScheduleConfig entries created: 2`);
        console.log(`  • AttendanceRecords created from leave entries: ${migratedCount}`);
        console.log(`  • DayEntry records updated: ${dayEntryUpdatedCount}`);
        console.log(`  • Failed migrations: ${failedMigrations.length}`);
        console.log('\n✅ All new time allocation models are ready for use!');

        process.exit(0);
    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    }
}

// Run migration if this file is executed directly
if (require.main === module) {
    console.log('Connecting to database...');
    require('../config/database')();
    setTimeout(migrateToNewSchedule, 2000); // Wait for DB connection
}

module.exports = migrateToNewSchedule;
