const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';

async function main() {
  console.log('--- LIVE PRODUCTION REST API VERIFICATION ---');

  const timestamp = Date.now();
  const userAEmail = `prod_owner_${timestamp}@example.com`;
  const userBEmail = `prod_member_${timestamp}@example.com`;
  const password = 'Password123!';

  // Helper fetch function
  const apiCall = async (method, path, body = null, token = null, headers = {}) => {
    const reqHeaders = { 'Content-Type': 'application/json', ...headers };
    if (token) reqHeaders['Authorization'] = `Bearer ${token}`;
    const opts = { method, headers: reqHeaders };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(`${BASE_URL}${path}`, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`[${res.status}] ${path} - ${JSON.stringify(data)}`);
    }
    return data;
  };

  // 1. Health check
  console.log('1. Checking Health Check endpoint...');
  const health = await apiCall('GET', '/health');
  console.log('   Health status:', health);

  // 2. Register User A & User B
  console.log('2. Registering User A & User B...');
  const userA = await apiCall('POST', '/auth/register', {
    email: userAEmail,
    password,
    firstName: 'ProdOwner',
    lastName: 'Admin',
  });
  const userB = await apiCall('POST', '/auth/register', {
    email: userBEmail,
    password,
    firstName: 'ProdMember',
    lastName: 'User',
  });
  console.log('   Users registered successfully. User A ID:', userA.user.id, 'User B ID:', userB.user.id);

  const tokenA = userA.accessToken;
  const tokenB = userB.accessToken;

  // 3. Create Organization with User A
  console.log('3. Creating Organization...');
  const org = await apiCall(
    'POST',
    '/organizations',
    { name: `Prod Org ${timestamp}`, slug: `prod-org-${timestamp}` },
    tokenA,
  );
  console.log('   Org created. ID:', org.id);

  // 4. Add User B to Organization
  console.log('4. Adding User B to Organization...');
  await apiCall(
    'POST',
    `/organizations/${org.id}/members`,
    { email: userBEmail, role: 'MEMBER' },
    tokenA,
    { 'x-organization-id': org.id },
  );
  console.log('   User B added to org successfully.');

  // 5. Create Project & Add User B to Project
  console.log('5. Creating Project...');
  const project = await apiCall(
    'POST',
    `/organizations/${org.id}/projects`,
    { name: 'Prod Project', slug: `prod-proj-${timestamp}`, description: 'Testing production stack' },
    tokenA,
    { 'x-organization-id': org.id },
  );
  console.log('   Project created. ID:', project.id);

  // 5b. Add User B to Project
  console.log('5b. Adding User B to Project...');
  await apiCall(
    'POST',
    `/organizations/${org.id}/projects/${project.id}/members`,
    { email: userBEmail, role: 'PROJECT_MEMBER' },
    tokenA,
    { 'x-organization-id': org.id },
  );
  console.log('   User B added to project successfully.');

  // 6. Create Task in Project
  console.log('6. Creating Task...');
  const task = await apiCall(
    'POST',
    `/organizations/${org.id}/projects/${project.id}/tasks`,
    { title: 'Production Verification Task', priority: 'HIGH', assigneeId: userB.user.id },
    tokenA,
    { 'x-organization-id': org.id },
  );
  console.log('   Task created. ID:', task.id);

  // 7. Add Comment on Task
  console.log('7. Adding Comment on Task...');
  const comment = await apiCall(
    'POST',
    `/organizations/${org.id}/projects/${project.id}/tasks/${task.id}/comments`,
    { content: `Production test comment from User A mentioning @${userBEmail}` },
    tokenA,
    { 'x-organization-id': org.id },
  );
  console.log('   Comment added. ID:', comment.id);

  // 8. List Notifications for User B
  console.log('8. Checking Notifications for User B...');
  const notifications = await apiCall(
    'GET',
    `/notifications`,
    null,
    tokenB,
    { 'x-organization-id': org.id },
  );
  console.log('   Notifications count:', notifications.notifications ? notifications.notifications.length : notifications.length);

  console.log('--- ALL LIVE PRODUCTION REST VERIFICATIONS PASSED SUCCESSFULLY ---');
}

main().catch((err) => {
  console.error('LIVE PROD TEST FAILED:', err);
  process.exit(1);
});
