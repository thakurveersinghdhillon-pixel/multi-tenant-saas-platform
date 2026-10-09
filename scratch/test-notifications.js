const io = require('socket.io-client');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';

async function main() {
  console.log('--- STARTING PHASE 12 NOTIFICATION INTEGRATION TEST ---');

  // Helper fetch function
  const apiCall = async (method, path, body = null, token = null, headers = {}) => {
    const reqHeaders = { 'Content-Type': 'application/json', ...headers };
    if (token) {
      reqHeaders['Authorization'] = `Bearer ${token}`;
    }
    const opts = { method, headers: reqHeaders };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(`${BASE_URL}${path}`, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`[${res.status}] ${path} - ${JSON.stringify(data)}`);
    }
    return data;
  };

  const timestamp = Date.now();
  const userAEmail = `notif_owner_${timestamp}@example.com`;
  const userBEmail = `notif_assignee_${timestamp}@example.com`;
  const password = 'Password123!';

  // 1. Register User A (Owner/Actor) & User B (Recipient)
  console.log('1. Registering Users...');
  const userA = await apiCall('POST', '/auth/register', {
    email: userAEmail,
    password,
    firstName: 'Alice',
    lastName: 'Owner',
  });
  const userB = await apiCall('POST', '/auth/register', {
    email: userBEmail,
    password,
    firstName: 'Bob',
    lastName: 'Assignee',
  });

  const tokenA = userA.accessToken;
  const tokenB = userB.accessToken;

  // 2. Create Organization with User A
  console.log('2. Creating Organization...');
  const org = await apiCall(
    'POST',
    '/organizations',
    { name: `Notif Test Org ${timestamp}`, slug: `notif-org-${timestamp}` },
    tokenA,
  );
  const orgId = org.id;

  // 3. Add User B to Organization
  console.log('3. Adding User B to Organization...');
  await apiCall(
    'POST',
    `/organizations/${orgId}/members`,
    { email: userBEmail, role: 'MEMBER' },
    tokenA,
    { 'x-organization-id': orgId },
  );

  // 4. Connect User B to WebSockets
  console.log('4. Connecting User B Socket.IO...');
  const socketB = io(BASE_URL, {
    auth: { token: tokenB },
    transports: ['websocket'],
  });

  const receivedSocketNotifications = [];
  socketB.on('notification:new', (event) => {
    console.log('   [SOCKET EVENT] notification:new received:', event.data?.type, event.data?.title);
    receivedSocketNotifications.push(event);
  });

  await new Promise((resolve) => {
    socketB.on('connect', () => {
      console.log('   Socket connected successfully for User B:', socketB.id);
      resolve();
    });
  });

  // 5. Create Project & Add User B to Project
  console.log('5. Creating Project & Adding User B...');
  const project = await apiCall(
    'POST',
    `/organizations/${orgId}/projects`,
    { name: 'Notification Project', slug: `notif-proj-${timestamp}`, description: 'Testing notifications' },
    tokenA,
    { 'x-organization-id': orgId },
  );
  const projectId = project.id;

  // Add User B as PROJECT_MEMBER -> triggers PROJECT_MEMBER_ADDED
  await apiCall(
    'POST',
    `/organizations/${orgId}/projects/${projectId}/members`,
    { email: userBEmail, role: 'PROJECT_MEMBER' },
    tokenA,
    { 'x-organization-id': orgId },
  );

  // Update User B role -> triggers PROJECT_MEMBER_ROLE_CHANGED
  console.log('6. Changing User B Project Role...');
  await apiCall(
    'PATCH',
    `/organizations/${orgId}/projects/${projectId}/members/${userB.user.id}/role`,
    { role: 'PROJECT_ADMIN' },
    tokenA,
    { 'x-organization-id': orgId },
  );

  // 7. Create Task assigned to User B -> triggers TASK_ASSIGNED
  console.log('7. Creating Task assigned to User B...');
  const task = await apiCall(
    'POST',
    `/organizations/${orgId}/projects/${projectId}/tasks`,
    {
      title: 'Fix Notification Bug',
      description: 'Test task',
      assigneeId: userB.user.id,
      status: 'TODO',
      priority: 'HIGH',
    },
    tokenA,
    { 'x-organization-id': orgId },
  );

  // Update Task Status -> triggers TASK_STATUS_CHANGED
  console.log('8. Updating Task Status...');
  await apiCall(
    'PATCH',
    `/organizations/${orgId}/projects/${projectId}/tasks/${task.id}/status`,
    { status: 'IN_PROGRESS' },
    tokenA,
    { 'x-organization-id': orgId },
  );

  // Add Comment to Task -> triggers TASK_COMMENTED
  console.log('9. Adding Comment to Task...');
  await apiCall(
    'POST',
    `/organizations/${orgId}/projects/${projectId}/tasks/${task.id}/comments`,
    { content: 'Please check this notification test comment!' },
    tokenA,
    { 'x-organization-id': orgId },
  );

  // Wait 1 second for socket broadcasts
  await new Promise((r) => setTimeout(r, 1000));

  // 10. Fetch Notifications via REST API for User B
  console.log('10. Fetching Notifications for User B via REST...');
  const notifs = await apiCall(
    'GET',
    '/notifications?limit=10',
    null,
    tokenB,
    { 'x-organization-id': orgId },
  );
  console.log(`   Found ${notifs.data.length} notifications. Total: ${notifs.meta.total}`);
  notifs.data.forEach((n) => console.log(`   - [${n.type}] ${n.title}: ${n.message}`));

  const unreadCountObj = await apiCall(
    'GET',
    '/notifications/unread-count',
    null,
    tokenB,
    { 'x-organization-id': orgId },
  );
  console.log(`   Unread Count: ${unreadCountObj.count}`);

  if (notifs.data.length === 0) {
    throw new Error('Expected notifications for User B, but none found!');
  }

  // 11. Mark single notification as read
  const firstNotifId = notifs.data[0].id;
  console.log(`11. Marking notification ${firstNotifId} as read...`);
  const updatedNotif = await apiCall(
    'PATCH',
    `/notifications/${firstNotifId}/read`,
    null,
    tokenB,
    { 'x-organization-id': orgId },
  );
  console.log(`   Updated status: isRead=${updatedNotif.isRead}, readAt=${updatedNotif.readAt}`);

  // 12. Mark all as read
  console.log('12. Marking all notifications as read...');
  const markAllResult = await apiCall(
    'PATCH',
    '/notifications/read-all',
    null,
    tokenB,
    { 'x-organization-id': orgId },
  );
  console.log(`   Marked ${markAllResult.count} notifications as read.`);

  const finalUnreadCount = await apiCall(
    'GET',
    '/notifications/unread-count',
    null,
    tokenB,
    { 'x-organization-id': orgId },
  );
  console.log(`   Final Unread Count: ${finalUnreadCount.count}`);

  if (finalUnreadCount.count !== 0) {
    throw new Error(`Expected count 0, got ${finalUnreadCount.count}`);
  }

  console.log(`13. Socket Notifications Received Count: ${receivedSocketNotifications.length}`);
  socketB.disconnect();

  console.log('--- PHASE 12 NOTIFICATION INTEGRATION TEST SUCCESSFUL ---');
}

main().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
