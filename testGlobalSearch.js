const mongoose = require('mongoose');
const Technician = require('./models/Technician');
const TemporaryAssignment = require('./models/TemporaryAssignment');

// Database connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/labour_management', {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

async function testGlobalSearchAssignment() {
    try {
        console.log('=== Testing Global Search Assignment Flow ===');
        
        // 1. Simulate PDI supervisor finding a PDI technician
        console.log('1. Simulating PDI supervisor searching for PDI technician...');
        const pdiTechnician = await Technician.findOne({ 
            employee_id: 'E00175209' // Conrad's ID
        });
        
        if (!pdiTechnician) {
            console.log('❌ PDI technician not found in database');
            return;
        }
        
        console.log(`✅ Found PDI technician: ${pdiTechnician.name} (${pdiTechnician.technician_id})`);
        console.log(`  PDI supervisor: ${pdiTechnician.supervisor_key}`);
        console.log(`  Current supervisor: ${process.env.PDI_SUPERVISOR_KEY || 'NOT_SET'}`);
        
        // 2. Simulate temporary assignment creation
        console.log('2. Creating temporary assignment for PDI technician...');
        const tempAssignment = new TemporaryAssignment({
            technician_id: pdiTechnician.technician_id,
            original_supervisor_key: pdiTechnician.supervisor_key,
            temporary_supervisor_key: process.env.PDI_SUPERVISOR_KEY || 'PDI_SUPERVISOR',
            duration_hours: 8,
            reason: 'Test assignment from PDI supervisor',
            assigned_at: new Date(),
            expires_at: new Date(Date.now() + 8 * 60 * 60 * 1000)
        });
        
        const savedAssignment = await tempAssignment.save();
        console.log('✅ Temporary assignment created:', savedAssignment);
        
        // 3. Simulate PDI technician checking their assignments
        console.log('3. Simulating PDI technician checking their dashboard...');
        const pdiAssignments = await TemporaryAssignment.find({
            technician_id: pdiTechnician.technician_id,
            status: 'active',
            expires_at: { $gt: new Date() }
        });
        
        console.log(`✅ PDI technician has ${pdiAssignments.length} active assignments:`, pdiAssignments);
        
        // 4. Check if assignment is properly marked
        if (pdiAssignments.length > 0) {
            console.log('✅ Global search assignment should be working for PDI technicians');
        } else {
            console.log('❌ No assignments found for PDI technician');
        }
        
    } catch (error) {
        console.error('Error testing global search assignment:', error);
    } finally {
        mongoose.connection.close();
    }
}

// Run test
testGlobalSearchAssignment();
