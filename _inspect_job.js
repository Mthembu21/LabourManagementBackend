require('dotenv').config();
const mongoose = require('mongoose');
const Job = require('./models/Job');
const TimeLog = require('./models/TimeLog');

const jobNumber = process.argv[2];

async function run() {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/labour_management');

    const fuzzy = await Job.find({ job_number: { $regex: jobNumber } });
    console.log(`Fuzzy match containing "${jobNumber}": ${fuzzy.length}`);

    for (const job of fuzzy) {
        console.log('----');
        console.log('job_number:', job.job_number);
        console.log('supervisor_key:', job.supervisor_key);
        console.log('status:', job.status);
        console.log('manually_completed:', job.manually_completed);
        console.log('allocated_hours:', job.allocated_hours);
        console.log('consumed_hours:', job.consumed_hours);
        console.log('remaining_hours:', job.remaining_hours);
        console.log('progress_percentage:', job.progress_percentage);
        console.log('actual_completion_date:', job.actual_completion_date);
        console.log('createdAt:', job.createdAt, 'updatedAt:', job.updatedAt);
        console.log('technicians:', JSON.stringify((job.technicians || []).map(t => ({ id: t.technician_id, name: t.technician_name, consumed: t.consumed_hours }))));

        const logs = await TimeLog.find({ job_id: job.job_number });
        console.log(`TimeLog entries for this job_id ("${job.job_number}"): ${logs.length}`);
        logs.forEach(l => console.log('  log:', l._id.toString(), 'hours_logged:', l.hours_logged, 'approved_hours:', l.approved_hours, 'approval_status:', l.approval_status, 'is_idle:', l.is_idle, 'supervisor_key:', l.supervisor_key));

        // Also check by job_number without any suffix variants, and by raw job number substring, in case TimeLog.job_id doesn't match exactly
        if (logs.length === 0) {
            const altLogs = await TimeLog.find({ job_id: { $regex: jobNumber } });
            console.log(`  Fallback fuzzy TimeLog match on job_id containing "${jobNumber}": ${altLogs.length}`);
            altLogs.forEach(l => console.log('  altlog job_id:', l.job_id, 'hours_logged:', l.hours_logged, 'approved_hours:', l.approved_hours, 'approval_status:', l.approval_status));
        }
    }

    await mongoose.connection.close();
}

run().catch(e => { console.error(e); process.exit(1); });
