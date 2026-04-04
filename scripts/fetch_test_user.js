const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { supabaseAdmin } = require('../config/database');

async function main() {
    console.log('Fetching test user...');
    const { data: users, error } = await supabaseAdmin.auth.admin.listUsers();

    if (error) {
        console.error('Error fetching users:', error);
        process.exit(1);
    }

    if (users.users.length > 0) {
        const user = users.users[0];
        console.log(`FOUND_USER_ID: ${user.id}`);
        console.log(`FOUND_USER_EMAIL: ${user.email}`);
    } else {
        console.log('No users found.');
    }
}

main();
