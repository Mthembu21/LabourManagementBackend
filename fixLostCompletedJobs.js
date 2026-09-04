// One-off repair for jobs stuck "lost" between the active and completed lists.
//
// Root cause (fixed in routes/timeEntry.routes.js): logging hours against a job
// updated job.consumed_hours but never recomputed/persisted remaining_hours,
// progress_percentage or status. Any job whose hours ran out this way still reads
// as active in the raw DB status field, so it drops off the supervisor dashboard's
// active list (which uses the live-computed status) but never appears in the
// completed report (which filters on the raw, never-updated status field).
//
// This script recomputes and persists the correct status/progress/remaining hours
// for every job, using the same rules the fixed live code now applies, so
// already-affected jobs become visible again (as completed, reopenable) instead
// of staying lost.
//
// Usage: node fixLostCompletedJobs.js [--apply]
//   (no flag)  dry run - lists jobs that would change, changes nothing
//   --apply    persists the recomputed fields to MongoDB

require('dotenv').config();
const mongoose = require('mongoose');
const Job = require('./models/Job');

const APPLY = process.argv.includes('--apply');

function normalizeDayOnly(d) {
    const dt = new Date(d);
    dt.setHours(0, 0, 0, 0);
    return dt;
}

function computeJobStatus(jobDoc) {
    if (!jobDoc) return 'in_progress';
    if (jobDoc.manually_completed) return 'completed';

    const allocated = Number(jobDoc.allocated_hours || 0);
    const consumed = Number(jobDoc.consumed_hours || 0);
    if (allocated > 0 && consumed > allocated) return 'overrun';

    const derivedPct = Number(jobDoc.aggregated_progress_percentage ?? jobDoc.progress_percentage ?? 0);
    if (derivedPct >= 100 - 1e-9) return 'completed';

    const today = normalizeDayOnly(new Date());
    const target = jobDoc.target_completion_date ? normalizeDayOnly(jobDoc.target_completion_date) : null;
    if (target && today > target) return 'at_risk';
    if (Number(jobDoc.bottleneck_count || 0) >= 2) return 'at_risk';

    if (target && today <= target) {
        const remainingHours = Math.max(0, allocated - consumed);
        let workdaysRemaining = 0;
        const cursor = new Date(today);
        while (cursor <= target) {
            const day = cursor.getDay();
            if (day !== 0 && day !== 6) workdaysRemaining += 1;
            cursor.setDate(cursor.getDate() + 1);
        }
        const avgDaily = workdaysRemaining > 0 ? remainingHours / workdaysRemaining : 0;
        if (avgDaily > 8.5) return 'at_risk';
    }

    return jobDoc.status === 'pending_confirmation' ? 'pending_confirmation' : 'in_progress';
}

async function run() {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/labour_management');
    console.log(`Connected. Mode: ${APPLY ? 'APPLY (writing changes)' : 'DRY RUN (no changes)'}`);

    const jobs = await Job.find({});
    console.log(`Scanning ${jobs.length} jobs...`);

    let changed = 0;
    for (const job of jobs) {
        const allocated = Number(job.allocated_hours || 0);
        const consumed = Number(job.consumed_hours || 0);
        const remaining_hours = Math.max(0, allocated - consumed);
        const overrun_hours = Math.max(0, consumed - allocated);
        const progress_percentage = allocated > 0 ? Math.min(100, (consumed / allocated) * 100) : Number(job.progress_percentage || 0);

        const wasCompleted = job.status === 'completed';
        const newStatus = computeJobStatus({ ...job.toObject(), progress_percentage });

        const needsUpdate =
            job.status !== newStatus ||
            Number(job.remaining_hours || 0) !== remaining_hours ||
            Number(job.overrun_hours || 0) !== overrun_hours ||
            Number(job.progress_percentage || 0) !== progress_percentage;

        if (!needsUpdate) continue;

        changed += 1;
        console.log(
            `${job.job_number}: status ${job.status} -> ${newStatus}, ` +
            `progress ${Number(job.progress_percentage || 0).toFixed(1)}% -> ${progress_percentage.toFixed(1)}%, ` +
            `remaining ${job.remaining_hours} -> ${remaining_hours}`
        );

        if (APPLY) {
            job.remaining_hours = remaining_hours;
            job.overrun_hours = overrun_hours;
            job.progress_percentage = progress_percentage;
            job.status = newStatus;
            if (newStatus === 'completed' && !wasCompleted) {
                job.actual_completion_date = job.actual_completion_date || new Date();
                job.total_hours_utilized = consumed;
            } else if (newStatus !== 'completed' && wasCompleted && !job.manually_completed) {
                job.actual_completion_date = null;
                job.total_hours_utilized = null;
            }
            await job.save();
        }
    }

    console.log(`\n${changed} job(s) ${APPLY ? 'updated' : 'would be updated'}.`);
    if (!APPLY && changed > 0) {
        console.log('Re-run with --apply to persist these changes.');
    }

    await mongoose.connection.close();
}

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
