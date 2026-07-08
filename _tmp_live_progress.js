require('dotenv').config({ path: 'c:/PSD-Projects/Labour-Utilazation/LabourManagementBackend/.env' });
const mongoose = require('mongoose');

async function main() {
    await mongoose.connect(process.env.MONGODB_URI);
    const Technician = require('./models/Technician.js');
    const Job = require('./models/Job.js');
    const TimeLog = require('./models/TimeLog.js');

    const tech = await Technician.findOne({ employee_id: 'E98104000' }).lean();
    const techIdStr = String(tech._id);

    const job = await Job.findOne({ job_number: '7000077659' }).lean();
    const paintingSubtask = (job.subtasks || []).find(st => st.title === 'Painting');
    const subtaskId = String(paintingSubtask._id || paintingSubtask.id);
    console.log('Painting subtask id:', subtaskId, '| allocated_hours (job field):', paintingSubtask.allocated_hours);

    const myAssignment = (paintingSubtask.assigned_technicians || []).find(a => String(a.technician_id) === techIdStr);
    console.log('Eugenio allocated_hours on this subtask (assigned_technicians entry):', myAssignment?.allocated_hours);

    // Replicate consumedByJobSubtaskTech aggregation exactly as enrichJobsWithTimeLogProgress does
    const logAgg = await TimeLog.aggregate([
        {
            $match: {
                supervisor_key: job.supervisor_key,
                is_idle: false,
                job_id: { $in: [job.job_number] },
                subtask_id: { $ne: null }
            }
        },
        {
            $group: {
                _id: { job_id: '$job_id', subtask_id: '$subtask_id', technician_id: '$technician_id' },
                consumed: { $sum: { $cond: [{ $gt: ['$approved_hours', 0] }, '$approved_hours', '$hours_logged'] } }
            }
        }
    ]);

    console.log('\nAll TimeLog aggregation rows for this job (any subtask/tech):');
    logAgg.forEach(r => console.log(' ', JSON.stringify(r)));

    const mine = logAgg.find(r => String(r._id.subtask_id) === subtaskId && String(r._id.technician_id) === techIdStr);
    console.log('\nEugenio consumed hours on Painting subtask (live aggregation):', mine?.consumed || 0);

    const techAllocated = Number(myAssignment?.allocated_hours || 0);
    const denomAllocated = techAllocated > 0 ? techAllocated : Number(paintingSubtask.allocated_hours || job.allocated_hours || 0);
    const consumed = mine?.consumed || 0;
    const pct = denomAllocated > 0 ? Math.max(0, Math.min(100, (consumed / denomAllocated) * 100)) : 0;
    console.log('\nComputed LIVE pct (as the API would send to frontend):', pct);
    console.log('storedCompleted flag (raw DB):', paintingSubtask.progress_by_technician?.find(p => String(p.technician_id) === techIdStr)?.completed);
    console.log('=> completed (live) =', pct >= 100 - 1e-9, 'OR storedCompleted');

    // Also list ALL raw TimeLog entries for this tech on this job (any subtask, including subtask_id null)
    const rawLogs = await TimeLog.find({ job_id: job.job_number, technician_id: techIdStr }).lean();
    console.log(`\nAll raw TimeLog docs for Eugenio on job ${job.job_number}: ${rawLogs.length}`);
    rawLogs.forEach(l => console.log(`  date=${l.date || l.log_date} subtask_id=${l.subtask_id} hours_logged=${l.hours_logged} approved_hours=${l.approved_hours} is_idle=${l.is_idle}`));

    await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
