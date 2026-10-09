const { io } = require('socket.io-client');
const http = require('http');

function post(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(body);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          ...headers,
        },
      },
      (res) => {
        let responseText = '';
        res.on('data', (chunk) => (responseText += chunk));
        res.on('end', () => {
          try {
            resolve({ statusCode: res.statusCode, body: JSON.parse(responseText) });
          } catch (e) {
            resolve({ statusCode: res.statusCode, body: responseText });
          }
        });
      },
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function runLiveTest() {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  console.log(`--- Starting Live WebSocket Verification against ${baseUrl} ---`);

  const timestamp = Date.now();
  const userA = {
    email: `live-ws-a-${timestamp}@example.com`,
    password: 'Password123!',
    firstName: 'Live',
    lastName: 'UserA',
  };
  const userB = {
    email: `live-ws-b-${timestamp}@example.com`,
    password: 'Password123!',
    firstName: 'Live',
    lastName: 'UserB',
  };

  // 1. Register User A
  console.log('[1/7] Registering User A...');
  const regA = await post(`${baseUrl}/auth/register`, userA);
  if (regA.statusCode !== 201) throw new Error(`User A registration failed: ${JSON.stringify(regA.body)}`);
  const tokenA = regA.body.accessToken;

  // 2. Register User B
  console.log('[2/7] Registering User B...');
  const regB = await post(`${baseUrl}/auth/register`, userB);
  if (regB.statusCode !== 201) throw new Error(`User B registration failed: ${JSON.stringify(regB.body)}`);
  const tokenB = regB.body.accessToken;

  // 3. User A creates Organization
  console.log('[3/7] Creating Organization...');
  const orgRes = await post(
    `${baseUrl}/organizations`,
    { name: 'Live WS Test Org', slug: `live-ws-org-${timestamp}` },
    { Authorization: `Bearer ${tokenA}` },
  );
  if (orgRes.statusCode !== 201) throw new Error(`Org creation failed: ${JSON.stringify(orgRes.body)}`);
  const orgId = orgRes.body.id;

  // Add User B to Organization
  await post(
    `${baseUrl}/organizations/${orgId}/members`,
    { email: userB.email, role: 'MEMBER' },
    { Authorization: `Bearer ${tokenA}` },
  );

  // 4. User A creates Project
  console.log('[4/7] Creating Project...');
  const projRes = await post(
    `${baseUrl}/organizations/${orgId}/projects`,
    { name: 'Live WS Project', slug: `live-ws-proj-${timestamp}` },
    { Authorization: `Bearer ${tokenA}` },
  );
  if (projRes.statusCode !== 201) throw new Error(`Project creation failed: ${JSON.stringify(projRes.body)}`);
  const projectId = projRes.body.id;

  // Add User B to Project as PROJECT_MEMBER
  await post(
    `${baseUrl}/organizations/${orgId}/projects/${projectId}/members`,
    { email: userB.email, role: 'PROJECT_MEMBER' },
    { Authorization: `Bearer ${tokenA}` },
  );

  // 5. Connect WebSocket Client (User B)
  console.log('[5/7] Connecting WebSocket Client (User B)...');
  const socketB = io(baseUrl, {
    auth: { token: tokenB },
    transports: ['polling', 'websocket'],
    reconnection: false,
  });

  await new Promise((resolve, reject) => {
    socketB.on('connect', () => {
      console.log('✓ WebSocket connected successfully (Socket ID:', socketB.id, ')');
      resolve();
    });
    socketB.on('connect_error', (err) => reject(new Error(`WebSocket connection failed: ${err.message}`)));
  });

  // 6. Join Project Room
  console.log('[6/7] Joining Project Room...');
  await new Promise((resolve, reject) => {
    socketB.emit('project:join', { organizationId: orgId, projectId }, (res) => {
      if (res && res.success) {
        console.log('✓ Successfully joined project room:', res.room);
        resolve();
      } else {
        reject(new Error(`Join project room failed: ${JSON.stringify(res)}`));
      }
    });
  });

  // 7. Test REST Mutation -> Real-time Broadcast
  console.log('[7/7] Triggering REST mutation & listening for live broadcast...');
  const broadcastReceived = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for task:created broadcast')), 5000);

    socketB.once('task:created', (event) => {
      clearTimeout(timeout);
      console.log('✓ RECEIVED REAL-TIME BROADCAST! Event:', {
        type: event.type,
        eventId: event.eventId,
        timestamp: event.timestamp,
        organizationId: event.organizationId,
        projectId: event.projectId,
        taskTitle: event.data?.title,
      });
      resolve();
    });
  });

  // User A creates a task via REST
  const taskRes = await post(
    `${baseUrl}/organizations/${orgId}/projects/${projectId}/tasks`,
    { title: 'Live Live Broadcast Task', description: 'Testing end-to-end WebSocket flow' },
    { Authorization: `Bearer ${tokenA}`, 'X-Tenant-Id': orgId },
  );
  if (taskRes.statusCode !== 201) throw new Error(`Task creation failed: ${JSON.stringify(taskRes.body)}`);

  await broadcastReceived;
  socketB.disconnect();

  console.log('\n--- 🎉 LIVE WEBSOCKET VERIFICATION COMPLETED SUCCESSFULLY! ---');
}

runLiveTest().catch((err) => {
  console.error('❌ Verification failed:', err.message);
  process.exit(1);
});
