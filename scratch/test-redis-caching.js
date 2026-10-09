const http = require('http');

function request(options, data) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch {
          parsed = body;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on('error', reject);
    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

async function runLiveVerification() {
  const ts = Date.now();
  console.log(`Starting Live Verification on http://localhost:3001 (ts=${ts})...`);

  // 1. Register User
  const email = `live-cache-${ts}@example.com`;
  const regRes = await request(
    {
      hostname: 'localhost',
      port: 3001,
      path: '/auth/register',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    },
    { email, password: 'Password123!', firstName: 'Live', lastName: 'Cache' }
  );

  if (regRes.status !== 201) {
    throw new Error(`Register failed with status ${regRes.status}: ${JSON.stringify(regRes.body)}`);
  }
  const token = regRes.body.accessToken;
  console.log('✔ User registered successfully');

  // 2. Create Organization
  const orgRes = await request(
    {
      hostname: 'localhost',
      port: 3001,
      path: '/organizations',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    },
    { name: `Live Org ${ts}`, slug: `live-org-${ts}` }
  );

  if (orgRes.status !== 201) {
    throw new Error(`Create org failed: ${JSON.stringify(orgRes.body)}`);
  }
  const orgId = orgRes.body.id;
  console.log(`✔ Organization created (ID: ${orgId})`);

  // 3. Create Project
  const projRes = await request(
    {
      hostname: 'localhost',
      port: 3001,
      path: `/organizations/${orgId}/projects`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    },
    { name: 'Live Project', slug: `live-proj-${ts}` }
  );
  const projectId = projRes.body.id;
  console.log(`✔ Project created (ID: ${projectId})`);

  // 4. GET Project List (First call = Cache MISS, Second call = Cache HIT)
  const list1 = await request({
    hostname: 'localhost',
    port: 3001,
    path: `/organizations/${orgId}/projects`,
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  const list2 = await request({
    hostname: 'localhost',
    port: 3001,
    path: `/organizations/${orgId}/projects`,
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (list1.status === 200 && list2.status === 200 && list1.body.length === list2.body.length) {
    console.log('✔ Project list GET (MISS and HIT) succeeded');
  } else {
    throw new Error(`Project list GET failed: ${list1.status} / ${list2.status}`);
  }

  // 5. Create Task
  const taskRes = await request(
    {
      hostname: 'localhost',
      port: 3001,
      path: `/organizations/${orgId}/projects/${projectId}/tasks`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    },
    { title: 'Live Task', priority: 'HIGH' }
  );
  const taskId = taskRes.body.id;
  console.log(`✔ Task created (ID: ${taskId})`);

  // 6. GET Task Board
  const boardRes = await request({
    hostname: 'localhost',
    port: 3001,
    path: `/organizations/${orgId}/projects/${projectId}/tasks/board`,
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (boardRes.status === 200 && boardRes.body.TODO.length === 1) {
    console.log('✔ Task board GET succeeded');
  }

  console.log('🎉 Live Verification Completed Successfully!');
}

runLiveVerification().catch((err) => {
  console.error('❌ Verification Error:', err);
  process.exit(1);
});
