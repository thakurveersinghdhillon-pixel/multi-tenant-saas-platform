import { PrismaClient, ProjectRole, ProjectStatus, TaskStatus, TaskPriority } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seeding (Phase 5 RBAC)...');

  // 1. Create System Permissions (19 total)
  const permissionsList = [
    { name: 'organization:read', description: 'View organization details' },
    { name: 'organization:update', description: 'Update organization settings' },
    { name: 'organization:delete', description: 'Delete organization' },

    { name: 'member:read', description: 'View organization members' },
    { name: 'member:create', description: 'Add new organization members' },
    { name: 'member:invite', description: 'Invite new organization members' },
    { name: 'member:update', description: 'Update member roles' },
    { name: 'member:remove', description: 'Remove members from organization' },
    { name: 'member:delete', description: 'Delete members from organization' },

    { name: 'project:create', description: 'Create projects' },
    { name: 'project:read', description: 'Read project details' },
    { name: 'project:update', description: 'Update projects' },
    { name: 'project:delete', description: 'Delete projects' },

    { name: 'project_member:read', description: 'View project members' },
    { name: 'project_member:create', description: 'Add project members' },
    { name: 'project_member:update', description: 'Update project member roles' },
    { name: 'project_member:delete', description: 'Remove project members' },

    { name: 'task:create', description: 'Create tasks' },
    { name: 'task:read', description: 'Read task details' },
    { name: 'task:update', description: 'Update tasks' },
    { name: 'task:delete', description: 'Delete tasks' },

    { name: 'comment:create', description: 'Add comments on tasks' },
    { name: 'comment:read', description: 'Read task comments' },
    { name: 'comment:update', description: 'Edit comments' },
    { name: 'comment:delete', description: 'Delete comments' },
  ];

  const permissions: Record<string, string> = {};
  for (const perm of permissionsList) {
    const createdPerm = await prisma.permission.upsert({
      where: { name: perm.name },
      update: { description: perm.description },
      create: perm,
    });
    permissions[perm.name] = createdPerm.id;
  }
  console.log(`✅ ${Object.keys(permissions).length} System Permissions upserted.`);

  // 2. Create System Roles (OWNER, ADMIN, MEMBER, VIEWER with organizationId = null)
  const roleNames = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'];
  const roles: Record<string, string> = {};

  for (const roleName of roleNames) {
    let role = await prisma.role.findFirst({
      where: { name: roleName, organizationId: null },
    });

    if (!role) {
      role = await prisma.role.create({
        data: {
          name: roleName,
          description: `System default ${roleName} role`,
          organizationId: null,
        },
      });
    }
    roles[roleName] = role.id;
  }
  console.log('✅ System Roles created (OWNER, ADMIN, MEMBER, VIEWER).');

  // 3. Assign Permissions to System Roles according to RBAC Matrix
  
  // OWNER gets all 19 permissions
  const ownerPermNames = permissionsList.map((p) => p.name);
  for (const permName of ownerPermNames) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: roles['OWNER'], permissionId: permissions[permName] } },
      update: {},
      create: { roleId: roles['OWNER'], permissionId: permissions[permName] },
    });
  }

  // ADMIN gets 18 permissions (all except organization:delete)
  const adminPermNames = permissionsList.map((p) => p.name).filter((name) => name !== 'organization:delete');
  for (const permName of adminPermNames) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: roles['ADMIN'], permissionId: permissions[permName] } },
      update: {},
      create: { roleId: roles['ADMIN'], permissionId: permissions[permName] },
    });
  }

  // MEMBER gets 12 working permissions
  const memberPermNames = [
    'organization:read',
    'member:read',
    'project:create',
    'project:read',
    'project:update',
    'task:create',
    'task:read',
    'task:update',
    'comment:create',
    'comment:read',
    'comment:update',
    'comment:delete',
  ];
  for (const permName of memberPermNames) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: roles['MEMBER'], permissionId: permissions[permName] } },
      update: {},
      create: { roleId: roles['MEMBER'], permissionId: permissions[permName] },
    });
  }

  // VIEWER gets 5 read-only permissions
  const viewerPermNames = [
    'organization:read',
    'member:read',
    'project:read',
    'task:read',
    'comment:read',
  ];
  for (const permName of viewerPermNames) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: roles['VIEWER'], permissionId: permissions[permName] } },
      update: {},
      create: { roleId: roles['VIEWER'], permissionId: permissions[permName] },
    });
  }
  console.log('✅ Role permissions mapped for OWNER, ADMIN, MEMBER, VIEWER.');

  // 4. Create Development Users
  const defaultPasswordHash = await bcrypt.hash('Password123!', 10);

  const ownerUser = await prisma.user.upsert({
    where: { email: 'owner@acme.com' },
    update: {},
    create: {
      email: 'owner@acme.com',
      passwordHash: defaultPasswordHash,
      firstName: 'Alex',
      lastName: 'Owner',
      avatarUrl: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e',
      isActive: true,
    },
  });

  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@acme.com' },
    update: {},
    create: {
      email: 'admin@acme.com',
      passwordHash: defaultPasswordHash,
      firstName: 'Sarah',
      lastName: 'Admin',
      avatarUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330',
      isActive: true,
    },
  });

  const memberUser = await prisma.user.upsert({
    where: { email: 'member@acme.com' },
    update: {},
    create: {
      email: 'member@acme.com',
      passwordHash: defaultPasswordHash,
      firstName: 'Mike',
      lastName: 'Developer',
      avatarUrl: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7',
      isActive: true,
    },
  });

  const viewerUser = await prisma.user.upsert({
    where: { email: 'viewer@acme.com' },
    update: {},
    create: {
      email: 'viewer@acme.com',
      passwordHash: defaultPasswordHash,
      firstName: 'Victoria',
      lastName: 'Viewer',
      avatarUrl: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80',
      isActive: true,
    },
  });

  console.log('✅ Development users created (Alex Owner, Sarah Admin, Mike Developer, Victoria Viewer).');

  // 5. Create Development Organization
  const org = await prisma.organization.upsert({
    where: { slug: 'acme-corp' },
    update: {},
    create: {
      name: 'Acme Corporation',
      slug: 'acme-corp',
      description: 'Primary tenant organization for development and testing',
    },
  });
  console.log(`✅ Organization created: ${org.name} (${org.slug}).`);

  // 6. Link Organization Memberships
  await prisma.organizationMember.upsert({
    where: { organizationId_userId: { organizationId: org.id, userId: ownerUser.id } },
    update: { roleId: roles['OWNER'] },
    create: {
      organizationId: org.id,
      userId: ownerUser.id,
      roleId: roles['OWNER'],
    },
  });

  await prisma.organizationMember.upsert({
    where: { organizationId_userId: { organizationId: org.id, userId: adminUser.id } },
    update: { roleId: roles['ADMIN'] },
    create: {
      organizationId: org.id,
      userId: adminUser.id,
      roleId: roles['ADMIN'],
    },
  });

  await prisma.organizationMember.upsert({
    where: { organizationId_userId: { organizationId: org.id, userId: memberUser.id } },
    update: { roleId: roles['MEMBER'] },
    create: {
      organizationId: org.id,
      userId: memberUser.id,
      roleId: roles['MEMBER'],
    },
  });

  await prisma.organizationMember.upsert({
    where: { organizationId_userId: { organizationId: org.id, userId: viewerUser.id } },
    update: { roleId: roles['VIEWER'] },
    create: {
      organizationId: org.id,
      userId: viewerUser.id,
      roleId: roles['VIEWER'],
    },
  });
  console.log('✅ Organization members linked with roles.');

  // 7. Create Projects
  let project1 = await prisma.project.findFirst({
    where: { organizationId: org.id, slug: 'mobile-app-redesign' },
  });
  if (!project1) {
    project1 = await prisma.project.create({
      data: {
        organizationId: org.id,
        name: 'Mobile App Redesign',
        slug: 'mobile-app-redesign',
        description: 'Complete UI/UX overhaul of the iOS and Android applications',
        status: ProjectStatus.ACTIVE,
        createdById: ownerUser.id,
      },
    });
  }

  let project2 = await prisma.project.findFirst({
    where: { organizationId: org.id, slug: 'api-integration-platform' },
  });
  if (!project2) {
    project2 = await prisma.project.create({
      data: {
        organizationId: org.id,
        name: 'API Integration Platform',
        slug: 'api-integration-platform',
        description: 'Build external webhook ecosystem and public REST endpoints',
        status: ProjectStatus.ACTIVE,
        createdById: adminUser.id,
      },
    });
  }
  console.log('✅ Development projects created.');

  // 8. Add Project Members
  await prisma.projectMember.upsert({
    where: { projectId_userId: { projectId: project1.id, userId: ownerUser.id } },
    update: { role: ProjectRole.PROJECT_ADMIN },
    create: { projectId: project1.id, userId: ownerUser.id, role: ProjectRole.PROJECT_ADMIN },
  });

  await prisma.projectMember.upsert({
    where: { projectId_userId: { projectId: project1.id, userId: memberUser.id } },
    update: { role: ProjectRole.PROJECT_MEMBER },
    create: { projectId: project1.id, userId: memberUser.id, role: ProjectRole.PROJECT_MEMBER },
  });

  await prisma.projectMember.upsert({
    where: { projectId_userId: { projectId: project2.id, userId: adminUser.id } },
    update: { role: ProjectRole.PROJECT_ADMIN },
    create: { projectId: project2.id, userId: adminUser.id, role: ProjectRole.PROJECT_ADMIN },
  });

  await prisma.projectMember.upsert({
    where: { projectId_userId: { projectId: project2.id, userId: memberUser.id } },
    update: { role: ProjectRole.PROJECT_MEMBER },
    create: { projectId: project2.id, userId: memberUser.id, role: ProjectRole.PROJECT_MEMBER },
  });
  console.log('✅ Project members linked.');

  // 9. Create Tasks
  const task1 = await prisma.task.create({
    data: {
      projectId: project1.id,
      createdById: ownerUser.id,
      assignedToId: memberUser.id,
      title: 'Design Figma wireframes for onboarding flow',
      description: 'Create high-fidelity interactive wireframes for new user signups',
      status: TaskStatus.IN_PROGRESS,
      priority: TaskPriority.HIGH,
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  await prisma.task.create({
    data: {
      projectId: project1.id,
      createdById: ownerUser.id,
      assignedToId: memberUser.id,
      title: 'Implement Dark Mode theme tokens',
      description: 'Add Tailwind CSS custom variables for dark mode support',
      status: TaskStatus.TODO,
      priority: TaskPriority.MEDIUM,
      dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    },
  });

  await prisma.task.create({
    data: {
      projectId: project2.id,
      createdById: adminUser.id,
      assignedToId: adminUser.id,
      title: 'Setup Redis Pub/Sub subscriber service',
      description: 'Listen to event channels for real-time WebSockets dispatching',
      status: TaskStatus.IN_REVIEW,
      priority: TaskPriority.URGENT,
      dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    },
  });
  console.log('✅ Tasks created.');

  // 10. Add Comments
  await prisma.comment.create({
    data: {
      taskId: task1.id,
      userId: ownerUser.id,
      content: 'Please ensure we support OAuth2 social login buttons in the onboarding screen.',
    },
  });

  await prisma.comment.create({
    data: {
      taskId: task1.id,
      userId: memberUser.id,
      content: 'Draft wireframes are uploaded to Figma. Reviewing with UX team tomorrow.',
    },
  });
  console.log('✅ Task comments created.');

  // 11. Add Activity Logs
  await prisma.activityLog.create({
    data: {
      organizationId: org.id,
      userId: ownerUser.id,
      action: 'ORGANIZATION_CREATED',
      metadata: { orgName: org.name, slug: org.slug },
    },
  });

  // 12. Add Notifications
  await prisma.notification.create({
    data: {
      userId: memberUser.id,
      organizationId: org.id,
      type: 'TASK_ASSIGNED',
      title: 'New Task Assigned',
      message: 'You have been assigned to "Design Figma wireframes for onboarding flow".',
      isRead: false,
    },
  });

  console.log('🎉 Database seeding completed successfully.');
}

main()
  .catch((e) => {
    console.error('❌ Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
