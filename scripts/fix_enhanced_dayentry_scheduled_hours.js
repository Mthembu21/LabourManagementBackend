/**
 * One-off migration script to fix DayEntry.scheduled_hours values
 * created by enhancedTimeEntry.routes.js (defaults currently incorrect).
 *
 * Fix rule (per LMS spec):
 * - Utilization available hours denom: Mon–Thu = 8.5, Friday = 7
 * - Productivity available productive hours denom: Mon–Thu = 7, Friday = 5.5
 *
 * This script updates DayEntry.scheduled_hours to be the utilization denom
 * (8.5 / 7), because kpiCalculator uses scheduled_hours as the availability base.
 *
 * How to run:
 *  node LabourManagementBackend/scripts/fix_enhanced_dayentry_scheduled_hours.js
 */

const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/lms';

async function main() {
  await mongoose.connect(MONGODB_URI);

  const DayEntry = require('../models/DayEntry');

  // Update based on day_of_week when possible; fallback on date day.
  // day_of_week is required in DayEntry schema (Monday..Friday).
  const result = await DayEntry.updateMany(
    {
      scheduled_hours: { $in: [5.5, 7.5, 7.0, 8.5] },
      // Only affect entries that likely came from the buggy enhanced routes.
      // If your dataset includes other values, adjust this filter.
      // Keeping broad but safe: only Monday..Thursday or Friday.
      day_of_week: { $in: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] }
    },
    [
      {
        $set: {
          scheduled_hours: {
            $cond: [
              { $eq: ['$day_of_week', 'Friday'] },
              7,
              8.5
            ]
          }
        }
      }
    ]
  );

  console.log('Migration complete:', {
    matchedCount: result.matchedCount ?? undefined,
    modifiedCount: result.modifiedCount ?? undefined,
    result
  });

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  process.exitCode = 1;
});

